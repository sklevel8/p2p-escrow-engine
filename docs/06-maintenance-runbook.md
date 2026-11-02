# 06 — Maintenance Log & Operational Runbook

**Role:** Project Manager / Release Manager
**Applies to:** v1.0.0 (webhook ingestion service)

## 1. Service map

| Component | Role | Failure impact |
| --- | --- | --- |
| `escrow-webhook` (Node) | Verifies and applies gateway notifications | No escrow can be funded |
| PostgreSQL | Ledger, escrow state, audit log | Total outage; no money movement |
| Redis | Idempotency claims | Callbacks return 500; gateway retries; funding stalls |

Redis is **not** optional. Without it the service refuses to proceed, because processing without an
idempotency claim risks double-funding. Treat Redis as a hard dependency.

## 2. Health and monitoring

| Signal | Threshold | Action |
| --- | --- | --- |
| `GET /health` non-200 | 2 consecutive checks, 60s apart | Page on-call |
| Webhook 500 rate | > 3 in 5 minutes | Page on-call; check Postgres and Redis first |
| Webhook 401 rate | > 10 in 5 minutes | Possible forged traffic or a rotated passphrase — page security |
| Webhook 422 rate | > 5 in 15 minutes | Investigate amount or status mismatches; may indicate gateway contract change |
| Redis unreachable | Any | Page on-call; funding is blocked |
| Escrows stuck in `FUNDED` > 7 days | Daily report | Operations follow-up with seller |
| Escrows stuck in `IN_TRANSIT` > 14 days | Daily report | Manual administrative review |
| Escrows stuck in `INITIATED` > 30 days | Daily report | No expiry policy exists — see GAP-04 |
| Audit trigger firing | Any occurrence | Treat as a security incident |

Alerts route to PagerDuty, with a Telegram fallback if PagerDuty is unreachable.

### Logging rules

- Log identifiers, status codes and `error.message`. Never log request bodies or raw error objects.
- A 422 is expected traffic, not an incident; a 500 is never expected.
- Retain application logs 90 days hot, then cold storage.

## 3. Backup and disaster recovery

| Item | Policy |
| --- | --- |
| Postgres snapshots | Daily at 02:00 SAST, 30-day retention, encrypted |
| Point-in-time recovery | Required; verify monthly by restoring to a scratch instance |
| Redis | No backup. Claims are ephemeral by design; a flush is safe because the database is authoritative |
| Audit logs | Streamed to cold storage (S3 Glacier) after 90 days |
| Restore test | Quarterly, recorded with evidence |

**Redis flush procedure.** Safe: the database `gateway_reference` unique constraint and the state
machine both reject a re-applied event. Expect a burst of `422` responses on any in-flight retries,
and verify no escrow shows more than one `FUNDS_CLEARED` audit row afterwards.

## 4. Incident procedures

### 4.1 Suspected forged webhooks

1. Confirm `PAYFAST_PASSPHRASE` matches the merchant dashboard value.
2. Query `audit_logs` for `FUNDS_CLEARED` rows in the window, joined to `gateway_reference`.
3. Cross-check each `gateway_reference` against the PayFast merchant report. Any reference absent
   from the report is fraudulent.
4. Freeze affected escrows by refusing further transitions, and escalate to legal. Do **not** delete
   audit rows; the trigger will prevent it and the attempt must itself be recorded.

### 4.2 Amount mismatch storm

Usually a fee configuration change on the gateway side, or a currency mismatch. Compare
`transactions.amount_cents` with the gateway's `amount_gross` for a sample of 422s. Stop the bleeding
by pausing the callback endpoint only if escrows are being incorrectly funded — a 422 storm blocks
funding but does not lose money.

### 4.3 Passphrase rotation

1. Add the new passphrase to the secret store.
2. Roll the service (zero-downtime, one instance at a time).
3. Rotate in the PayFast dashboard.
4. Confirm no sustained 401s after rotation.

## 5. Routine maintenance

| Cadence | Task |
| --- | --- |
| Daily | Review alert summary and stuck-escrow reports |
| Weekly | Review 422 log for gateway contract drift; check dependency advisories |
| Monthly | Restore-test a snapshot; review access to the database and secret store |
| Quarterly | Rotate the passphrase; restore drill with evidence; revisit open SRS questions |
| Per release | Update this runbook and `05-release-notes` |

## 6. Change log

| Date | Version | Change |
| --- | --- | --- |
| 2026-11-02 | 1.0.0 | Source release: state machine, signature verification, idempotent webhook ingestion, schema with append-only audit trigger. 22 unit tests. Not cleared for production. |
