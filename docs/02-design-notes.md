# 02 — Design Notes (retrospective)

**Status:** reconstructed after implementation, not a signed-off SDD.

The implementation phase was reached without a System Design Document being produced. This file
documents what was actually built so that the QA phase and future maintainers have something to test
against. It should be replaced by a real SDD before the next major version.

## 1. Components

```
             ┌──────────────────────────────┐
 PayFast ───▶│ POST /webhooks/payfast       │
   ITN       │  (Express, raw body kept)    │
             └──────────────┬───────────────┘
                            │
             ┌──────────────▼───────────────┐
             │ WebhookController            │
             │  1 verify signature          │
             │  2 claim idempotency key     │
             │  3 reconcile + transition    │
             └───┬──────────────────┬───────┘
                 │                  │
        ┌────────▼──────┐   ┌───────▼──────────┐
        │ Redis         │   │ PostgreSQL       │
        │ NX claim, 24h │   │ transactions     │
        │               │   │ audit_logs       │
        └───────────────┘   └──────────────────┘
```

Pure decision logic lives outside the controller:

- `EscrowStateMachine` — allowed transitions, terminal states.
- `GatewayEventPolicy` — should this notification fund, be ignored, or be rejected.
- `PayFastSignature` — encoding and constant-time comparison.

This separation is what makes the money rules unit-testable without Postgres or Redis.

## 2. Consistency model

| Concern | Mechanism |
| --- | --- |
| Duplicate webhook | `SET key NX EX 86400` in Redis |
| Concurrent webhooks for one escrow | `SELECT … FOR UPDATE` inside the DB transaction |
| Lost update during state change | `UPDATE … WHERE status = <previously read status>`; `rowCount !== 1` is an error |
| Audit and state divergence | Both written in one transaction |
| Audit tampering | `BEFORE UPDATE OR DELETE` trigger raises an exception |

Known limitation: the Redis claim and the database commit are not a single distributed transaction.
The failure window is handled by releasing the claim on error, but a crash *after* commit and *before*
the claim is marked `processed` means the retry sees a locked row in `FUNDED` and is rejected by the
state machine. It returns HTTP 422 rather than 200, which is noisy but not money-losing. A dedupe table
keyed on `gateway_reference` inside the same DB transaction would remove the noise and is the
recommended v1.1.0 change.

## 3. Data model

See `src/db/schema.sql`. Notable choices:

- `amount_cents BIGINT` — integer money, no floats.
- `status escrow_state` — database enum mirrors the TypeScript enum, so an unknown state cannot be
  persisted even by a buggy writer.
- `gateway_reference TEXT UNIQUE` — second line of defence against duplicate funding.
- `audit_logs.from_status / to_status` — required to reconstruct history; the original snippet only
  recorded the action name.
- `CHECK (buyer_id <> seller_id)` — self-dealing is blocked at the schema level.

## 4. Trust boundaries

| Boundary | Assumption |
| --- | --- |
| Gateway → webhook endpoint | PayFast is the only source; authenticity by MD5 signature over the ordered body |
| Webhook → database | Application is trusted; DB enforces state enum, amount checks and audit immutability |
| Operator → audit log | Not trusted. Trigger denies mutation |
| Application → logs | Logs are a POPIA exposure surface; only identifiers and messages are emitted |

## 5. What is deliberately absent

Payout orchestration, KYC storage, POPIA encryption at rest, the dispute UI and the seller onboarding
flow. Their absence is recorded in `04-bug-reports.md` as scope gaps rather than pretended as done.
