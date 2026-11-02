/**
 * Pure decision policy for inbound gateway notifications.
 *
 * Kept free of database, HTTP and Redis concerns so the money-moving rules can
 * be unit tested without infrastructure.
 */

export const SUCCESSFUL_GATEWAY_STATUSES: ReadonlySet<string> = new Set(['COMPLETE', 'PAID', 'SUCCESS']);

export interface GatewayEventInput {
  readonly status: string;
  /** Amount the gateway reports as cleared, in integer cents. */
  readonly amountGrossCents: number;
  /** Amount the escrow record was created for, in integer cents. */
  readonly expectedAmountCents: number;
}

export type GatewayDecision =
  | { readonly action: 'fund' }
  | { readonly action: 'ignore'; readonly reason: string }
  | { readonly action: 'reject'; readonly reason: string };

/**
 * A notification may only fund an escrow when the gateway says the payment
 * succeeded *and* the settled amount matches the escrow exactly. Anything else
 * is ignored (no state change, acknowledged) or rejected (alerted, no state
 * change). Silent partial funding is the failure mode this guards against.
 */
export function decideGatewayAction(input: GatewayEventInput): GatewayDecision {
  if (!SUCCESSFUL_GATEWAY_STATUSES.has(input.status.trim().toUpperCase())) {
    return { action: 'ignore', reason: `Non-successful gateway status: ${input.status || '(empty)'}` };
  }

  if (!Number.isInteger(input.amountGrossCents) || input.amountGrossCents <= 0) {
    return { action: 'reject', reason: 'Unparseable or non-positive settled amount' };
  }

  if (input.amountGrossCents !== input.expectedAmountCents) {
    return {
      action: 'reject',
      reason: `Amount mismatch: settled ${input.amountGrossCents} vs expected ${input.expectedAmountCents}`,
    };
  }

  return { action: 'fund' };
}

/**
 * Converts a gateway decimal amount string ("1499.00") into integer cents
 * without floating point multiplication, so 0.1 + 0.2 style drift cannot occur.
 */
export function parseAmountToCents(amount: unknown): number {
  if (typeof amount === 'number') {
    return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
  }
  if (typeof amount !== 'string') return Number.NaN;

  const normalised = amount.trim().replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return Number.NaN;

  const [whole, fraction = ''] = normalised.split('.');
  return Number.parseInt(whole ?? '', 10) * 100 + Number.parseInt(fraction.padEnd(2, '0'), 10);
}
