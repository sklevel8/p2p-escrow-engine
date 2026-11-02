# 04 — Bug Reports

**Role:** QA Tester · **Baseline reviewed:** implementation snippet as submitted
**Status key:** `Fixed` = corrected in this repository · `Open` = unfixed, tracked
**Severity:** Critical blocks money safety or authenticity · High blocks correctness at scale ·
Medium is a correctness or compliance weakness · Low is hygiene.

---

## BUG-001 — Webhook signature verification always succeeds

**Severity:** Critical · **Status:** Fixed · **Component:** `WebhookController.verifySignature`

The submitted implementation returned `true` unconditionally:

```ts
private static verifySignature(payload: any, signature: string): boolean {
  return true;
}
```

Anyone able to reach `POST /webhooks/payfast` could POST
`{transaction_id: <any>, status: "COMPLETE"}` and move an escrow to `FUNDED` with no money received.
Because `RELEASED` is reachable from `FUNDED` via `IN_TRANSIT → DELIVERED`, this is a direct path to
paying out funds that were never collected.

**Fix:** `src/services/PayFastSignature.ts` implements the documented PayFast algorithm — ordered
body fields, PHP-compatible `urlencode`, passphrase salt, MD5, `timingSafeEqual` comparison. Missing
signature, wrong passphrase or unconfigured passphrase all return `false`, and the controller answers
`503` when no passphrase is configured rather than accepting traffic.

**Verification:** SG-01…SG-08 in `03-test-plan.md`.

---

## BUG-002 — Idempotency check is not atomic (race condition)

**Severity:** Critical · **Status:** Fixed · **Component:** `WebhookController` steps 2 and 4

The submitted code performed a read (`GET`) before the work and a `SETEX` after the database commit:

```ts
const alreadyProcessed = await redisClient.get(idempotencyKey);
if (alreadyProcessed) return res.status(200).send('OK');
// ... work ...
await redisClient.setex(idempotencyKey, 86400, 'true');
```

Two problems:

1. Two concurrent deliveries both read `null` and both enter the work path — the check does not
   exclude anything.
2. The key is written only after the commit. A process crash between commit and `SETEX` leaves no
   record, so the next retry reprocesses the event.

The v1.0.0 release notes claimed "Redis `SETNX` atomic locks" while the code used `GET`/`SETEX`. The
documentation described an implementation that did not exist.

**Fix:** claim first with `SET key NX EX 86400`; only the winner proceeds. The claim is released on
failure so a legitimate retry still works, and marked `processed` on success.

**Residual risk:** the claim and the commit are not one atomic unit. See `02-design-notes.md` §2 for
the remaining crash window and the recommended dedupe-table fix.

---

## BUG-003 — Notification with any amount funds the escrow

**Severity:** Critical · **Status:** Fixed · **Component:** `WebhookController` status handling

The submitted code branched solely on the gateway status:

```ts
if (status === 'COMPLETE') { /* fund */ }
```

A R1 settlement against a R15 000 escrow would mark it `FUNDED`. There was no comparison against the
escrow amount and no validation that the amount parsed at all. Underpayment is the cheapest attack on
an escrow engine.

**Fix:** `decideGatewayAction` requires a successful status **and** exact equality between settled
and expected amounts, in integer cents. Mismatches return HTTP 422 and change nothing. Amount parsing
is string-based so `1499.99` cannot drift to `149998` through float multiplication.

**Verification:** GP-01…GP-08.

---

## BUG-004 — No row lock or optimistic guard on the state update

**Severity:** High · **Status:** Fixed · **Component:** `WebhookController` DB transaction

The transaction read `status`, computed the next state in application code, and then updated by
`transaction_id` only:

```sql
UPDATE transactions SET status = 'FUNDED', ... WHERE transaction_id = $1;
```

Under `READ COMMITTED`, two concurrent transactions can both read `INITIATED`, both pass the state
machine, and both write. The audit log then records two `FUNDS_CLEARED` rows for one payment.

**Fix:** `SELECT … FOR UPDATE` to serialise on the row, plus
`UPDATE … WHERE transaction_id = $1 AND status = <status read under lock>` and an explicit
`rowCount !== 1` failure. The conditional write means even a caller that bypasses the lock cannot
clobber a newer state.

---

## BUG-005 — "Immutable" audit log is mutable

**Severity:** High · **Status:** Fixed · **Component:** database schema

NFR-1 requires a tamper-proof trail, but nothing prevented `UPDATE` or `DELETE` on `audit_logs`. Any
operator with write access, or any application bug, could rewrite history. The claim was procedural,
not enforced.

**Fix:** `src/db/schema.sql` adds a `BEFORE UPDATE OR DELETE` trigger that raises an exception, and
the audit row now records `from_status`/`to_status` so history is reconstructable.

---

## BUG-006 — Non-`COMPLETE` statuses produce silent success

**Severity:** Medium · **Status:** Fixed · **Component:** `WebhookController`

Because only `COMPLETE` was handled, every other status still returned `200 OK` with no branch taken
and no record kept — including statuses that indicate a failed or cancelled payment. Operations had
no way to distinguish "ignored because pending" from "ignored because we do not handle it".

**Fix:** the decision policy is explicit (`fund` / `ignore` / `reject`) and `ignore` emits a structured
warning with the reference and reason.

---

## BUG-007 — Failure path returns 500, guaranteeing a retry storm

**Severity:** Medium · **Status:** Partially fixed · **Component:** `WebhookController` catch block

Every error — including `Transaction not found` and invalid transitions — returned `500`. Gateways
retry 500s, so a permanently invalid event (for example a replay of an already-funded escrow) would be
retried until the window closed, generating noise and load, and re-entering the processing path each
time.

**Fix:** errors are classified. Unreconcilable but correctly signed events return `422` and are logged
once. Genuine transient failures still return `500` so the gateway retries, as it should.

**Remaining:** there is no dead-letter queue for events that exhaust retries. Tracked as GAP-05.

---

## BUG-008 — Error logging can leak PII

**Severity:** Medium · **Status:** Fixed · **Component:** `WebhookController` catch block

The submitted code logged the raw error object:

```ts
console.error(`Webhook Error for TX ${transaction_id}:`, error);
```

Database driver and validation errors routinely embed parameter values, which for this system include
ID numbers and bank account numbers. That violates SR-1's "anonymised in logs" requirement.

**Fix:** only identifiers and `error.message` are logged; raw payloads and error objects never reach
the log. The Redis client handler does the same.

---

## BUG-009 — Release notes describe behaviour the code does not have

**Severity:** High · **Status:** Fixed (documentation) · **Component:** release notes

The v1.0.0 notes asserted four things that were not true of the submitted code:

| Claim | Reality |
| --- | --- |
| "Redis `SETNX` atomic locks" | `GET` then `SETEX` (BUG-002) |
| "Invalid transitions return standard HTTP 400" | Every error returned `500` (BUG-007) |
| "AES-256 encryption enabled for ID numbers and banking details" | No encryption code exists anywhere in the implementation |
| "Dispute Resolution Channel: secure admin endpoints are live" | No admin or dispute endpoint exists |

Shipping these notes to stakeholders as an accurate record of production state is a governance
defect, not a cosmetic one. Corrected in `05-release-notes-1.0.0.md`.

---

## BUG-010 — `status` field name does not match the PayFast ITN contract

**Severity:** Medium · **Status:** Fixed · **Component:** `WebhookController`

The controller destructured `status` from the body, but PayFast sends `payment_status`. With a real
ITN, `status` is `undefined`, so no funding path would ever execute — a silent, total failure of the
core feature that unit tests on the state machine alone would never catch.

**Fix:** `payment_status` is read with a fallback to `status`, and the integration case IN-01 is
specified to prove it against the real gateway.

---

## BUG-011 — No input size limit or malformed-body handling

**Severity:** Low · **Status:** Fixed · **Component:** `src/app.ts`

The submitted snippet had no body limits and no 404/error handlers, so unbounded bodies were accepted
and malformed input produced framework default error pages.

**Fix:** `64kb` limits on both parsers, an explicit 404, and an error handler that returns `400`
without a stack trace. Oversized uploads for KYC are separately capped at 5 MB (not implemented yet).

---

## Scope gaps (not defects in submitted code — absent features)

| ID | Gap | Requirement | Notes |
| --- | --- | --- | --- |
| GAP-01 | No seller payout / disbursement service | FR-3 | `RELEASED` is a state only. Fee calculation and bank disbursement are unimplemented. |
| GAP-02 | No KYC/FICA upload pipeline | SR-2 | No storage, no verification, no withdrawal gate. |
| GAP-03 | No currency handling | — | `currency` is `ZAR` by default but no validation rejects other values. |
| GAP-04 | No `CANCELLED`/`EXPIRED` state | FR-1 | An `INITIATED` escrow that is never paid sits forever; nothing expires it. |
| GAP-05 | No dead-letter queue | NFR-2 | Failed events are released for retry but never quarantined. |
| GAP-06 | No dispute console or evidence storage | FR-4 | `DISPUTED` is reachable, but there is no admin workflow behind it. |
| GAP-07 | No POPIA column-level encryption | SR-1 | Depends on managed Postgres; not wired in application code. |
| GAP-08 | No trust account reconciliation | SR-3 | Ledger totals are not reconciled against bank statements. |

## Defect summary

| Severity | Fixed | Open |
| --- | --- | --- |
| Critical | 3 | 0 |
| High | 3 | 0 |
| Medium | 4 | 0 |
| Low | 1 | 0 |
| Scope gaps | — | 8 |
