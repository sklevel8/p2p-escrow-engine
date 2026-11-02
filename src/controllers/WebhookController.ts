import { Request, Response } from 'express';
import { EscrowStateMachine, EscrowState } from '../services/EscrowStateMachine';
import { parseOrderedPayload, verifyPayFastSignature } from '../services/PayFastSignature';
import { decideGatewayAction, parseAmountToCents } from '../services/GatewayEventPolicy';
import { db } from '../config/database';
import { redisClient } from '../config/redis';
import { env } from '../config/env';

interface RawBodyRequest extends Request {
  rawBody?: string;
}

interface EscrowRow {
  transaction_id: string;
  status: string;
  amount_cents: string | number;
}

/** Raised when a correctly signed notification cannot be reconciled with the escrow. */
class RejectedGatewayEventError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'RejectedGatewayEventError';
  }
}

export class WebhookController {
  /**
   * Handles PayFast ITN style callbacks.
   *
   * Ordering matters:
   *   1. signature check (fail closed, no passphrase => 503)
   *   2. atomic idempotency claim in Redis
   *   3. row-locked DB transaction that funds the escrow and writes the audit row
   *   4. release the claim on failure so the gateway retry can be reprocessed
   */
  public static async handleGatewayCallback(req: Request, res: Response): Promise<Response> {
    const rawBody = (req as RawBodyRequest).rawBody ?? '';
    if (!rawBody) {
      return res.status(400).json({ error: 'Missing request body' });
    }

    const fields = parseOrderedPayload(rawBody);
    const values = new Map(fields);

    const transactionId = (values.get('transaction_id') ?? '').trim();
    const gatewayReference = (values.get('gateway_reference') ?? values.get('pf_payment_id') ?? '').trim();
    const signature = values.get('signature');

    if (!transactionId || !gatewayReference) {
      return res.status(400).json({ error: 'Malformed notification' });
    }

    // Fail closed: never trust an unsigned callback.
    if (!env.payfastPassphrase) {
      console.error('[webhook] PAYFAST_PASSPHRASE is not configured; refusing to process callbacks');
      return res.status(503).json({ error: 'Gateway verification unavailable' });
    }

    if (!verifyPayFastSignature(fields, signature, env.payfastPassphrase)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const idempotencyKey = `webhook:processed:${gatewayReference}`;

    try {
      // Atomic claim: only one caller can win, even across multiple instances.
      const claimed = await redisClient.set(idempotencyKey, 'processing', {
        NX: true,
        EX: env.idempotencyTtlSeconds,
      });

      if (claimed === null) {
        // Already claimed (processed or in flight): acknowledge, never reprocess.
        return res.status(200).send('OK');
      }

      const amountGross = values.get('amount_gross');
      const status = (values.get('payment_status') ?? values.get('status') ?? '').trim();

      await db.transaction(async (trx) => {
        const escrow = await trx<EscrowRow>('transactions')
          .where({ transaction_id: transactionId })
          .forUpdate()
          .first();

        if (!escrow) {
          throw new Error(`Transaction not found: ${transactionId}`);
        }

        const decision = decideGatewayAction({
          status,
          amountGrossCents: parseAmountToCents(amountGross),
          expectedAmountCents: Number(escrow.amount_cents),
        });

        if (decision.action === 'reject') {
          throw new RejectedGatewayEventError(decision.reason);
        }

        if (decision.action === 'ignore') {
          console.warn(`[webhook] ignored ${gatewayReference}: ${decision.reason}`);
          return;
        }

        const newState = EscrowStateMachine.transition(escrow.status as EscrowState, EscrowState.FUNDED);

        const updated = await trx('transactions')
          .where({ transaction_id: transactionId, status: escrow.status })
          .update({
            status: newState,
            gateway_reference: gatewayReference,
            funded_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          });

        if (updated !== 1) {
          throw new Error(`Concurrent state change detected for ${transactionId}`);
        }

        // Append-only audit trail; enforced by trigger in src/db/schema.sql.
        await trx('audit_logs').insert({
          transaction_id: transactionId,
          action: 'FUNDS_CLEARED',
          actor_id: 'SYSTEM_WEBHOOK',
          from_status: escrow.status,
          to_status: newState,
          gateway_reference: gatewayReference,
        });
      });

      await redisClient.set(idempotencyKey, 'processed', { EX: env.idempotencyTtlSeconds });
      return res.status(200).send('OK');
    } catch (error) {
      // Release the claim so a legitimate gateway retry is not blocked forever.
      await redisClient.del(idempotencyKey).catch(() => undefined);

      if (error instanceof RejectedGatewayEventError) {
        console.error(`[webhook] rejected ${gatewayReference} for TX ${transactionId}: ${error.message}`);
        return res.status(422).json({ error: 'Notification rejected' });
      }

      // Log identifiers and messages only: error objects can carry PII.
      const message = error instanceof Error ? error.message : 'unknown error';
      console.error(`[webhook] failure for ${gatewayReference} (TX ${transactionId}): ${message}`);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
