# 05 — Release Notes v1.0.0

**Role:** Project Manager / Release Manager
**Status:** Source release. **Not cleared for production traffic.**
**Date:** 2026-11-02

This document supersedes the earlier draft release notes, which described several capabilities that
were not present in the code (see BUG-009 in `04-bug-reports.md`). Everything below has been verified
against the repository contents.

## 1. What is actually in this release

### Escrow state machine — delivered

Immutable lifecycle from `INITIATED` to `RELEASED`/`REFUNDED`, with `DISPUTED` reachable from
`IN_TRANSIT` and `DELIVERED`. Invalid movements throw `InvalidTransitionError` and are surfaced as
HTTP `422`, not `400` as previously stated — a signed but unreconcilable notification is not a
malformed request, and the distinction matters when reading gateway retry logs.

### Webhook ingestion — delivered

- PayFast ITN signature verification using the documented ordered-field MD5 algorithm, with
  constant-time comparison.
- Atomic idempotency claim (`SET NX EX 86400`) taken **before** processing and released on failure.
- Row-locked database transaction with conditional update, so concurrent deliveries cannot
  double-apply a movement.
- Amount reconciliation: a `COMPLETE` notification only funds the escrow when the settled amount
  equals the escrow amount exactly.
- Append-only audit trail enforced by a database trigger.

### HTTP surface — delivered

`GET /health` and `POST /webhooks/payfast` only.

## 2. What is **not** in this release

The earlier notes claimed these were live. They are not:

| Claimed | Actual |
| --- | --- |
| Dispute resolution channel with evidence upload | Not implemented. `DISPUTED` is a state with no admin workflow. |
| AES-256 encryption of ID numbers and banking details | No encryption code exists in the repository. |
| Multi-party disbursement with fee calculation to seller bank accounts | Not implemented. No payout service. |
| FICA/KYC upload with 5 MB limit | Not implemented. No upload endpoint, so no limit to enforce. |

These are tracked as GAP-01 through GAP-08 in `04-bug-reports.md`.

## 3. Verification performed

| Check | Result |
| --- | --- |
| TypeScript strict build | Pass |
| Unit tests (`npm test`) | 22/22 pass |
| Static review of submitted source | 11 defects raised, 11 fixed |
| Integration tests against Postgres/Redis | **Not run** |
| PayFast sandbox interoperability | **Not run** |
| Load / concurrency test | **Not run** |
| Penetration test | **Not run** |

## 4. Pre-production checklist (mandatory)

- [ ] Run `npm run migrate` against a staging database and verify the audit trigger blocks UPDATE.
- [ ] Automate IN-01…IN-10 and get them green in CI with disposable Postgres and Redis.
- [ ] Validate signatures against the PayFast sandbox with a real ITN, including a tampered replay.
- [ ] Decide the custody model (SRS open question 1) with legal before any payout code is written.
- [ ] Confirm Postgres at-rest encryption and backup encryption settings with the hosting provider.
- [ ] Seed secrets in the platform secret store; confirm `PAYFAST_PASSPHRASE` is present in staging.
- [ ] Load test: 50 concurrent duplicate deliveries per escrow, assert zero double-funding.
- [ ] Agree the abandoned-escrow policy and add `CANCELLED`/`EXPIRED`.

## 5. Known limitations

1. Abandoned `INITIATED` escrows never expire.
2. Full refunds only; partial refunds are deferred.
3. ZAR only, and non-ZAR values are not explicitly rejected at the API boundary.
4. Redis and the database are not atomically coordinated; the crash window is documented and
   currently surfaces as a `422` on retry rather than a duplicate funding.
5. No dead-letter queue for events that exhaust retries.

## 6. Rollback

This release is additive: one new endpoint and one new schema. Rollback is redeploying the previous
image. The schema is backward compatible; `audit_logs_no_mutation` may be dropped if an operator
needs to correct data, but doing so should be treated as an audit incident and recorded out of band.

## 7. Next milestone — v1.1.0

Priority order, driven by risk rather than feature appeal:

1. Integration test suite with disposable infrastructure (removes the largest unknown).
2. Dedupe table in Postgres to close the remaining crash window.
3. Seller payout service with fee calculation and bank rejection handling.
4. KYC upload and withdrawal gating.
5. `CANCELLED`/`EXPIRED` states and an expiry sweeper.
6. Partial refunds.
