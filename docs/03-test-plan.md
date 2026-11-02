# 03 — Test Plan

**Role:** QA Tester · **Target:** P2P Escrow Engine v1.0.0
**Last run:** 2026-11-02 — 22/22 automated tests passing (`npm test`)

## 1. Scope

**In scope:** escrow state machine, gateway notification reconciliation, PayFast signature
verification, idempotency behaviour, HTTP contract.

**Out of scope (not implemented, therefore untestable):** seller payout, KYC upload, POPIA
encryption at rest, dispute console, trust account reconciliation. These are tracked as gaps in
`04-bug-reports.md`, not as passing tests.

## 2. Strategy

| Level | Tooling | Coverage |
| --- | --- | --- |
| Unit | `node:test` + `node:assert/strict` | State machine, amount parsing, decision policy, signature encoding |
| Integration | Postgres + Redis (to be added) | Webhook end-to-end, concurrency, crash windows |
| Contract | PayFast sandbox (manual) | Real ITN interoperability |
| Non-functional | Load generator (to be added) | Duplicate-storm, retry behaviour |

## 3. Unit test cases

### 3.1 Escrow state machine (`tests/EscrowStateMachine.test.ts`)

| ID | Case | Expected |
| --- | --- | --- |
| SM-01 | Happy path INITIATED→FUNDED→IN_TRANSIT→DELIVERED→RELEASED | All transitions accepted |
| SM-02 | Disputed branch from IN_TRANSIT and DELIVERED | Accepted |
| SM-03 | DISPUTED → RELEASED and DISPUTED → REFUNDED | Accepted |
| SM-04 | INITIATED → RELEASED (skipping states) | `InvalidTransitionError` |
| SM-05 | FUNDED → FUNDED (re-funding) | `InvalidTransitionError` |
| SM-06 | Every transition out of RELEASED / REFUNDED | Rejected; both terminal |
| SM-07 | Error exposes `currentState` and `nextState` | Correct values for logging/alerting |

### 3.2 Gateway decision policy (`tests/GatewayEventPolicy.test.ts`)

| ID | Case | Expected |
| --- | --- | --- |
| GP-01 | COMPLETE, exact amount | `fund` |
| GP-02 | `paid` lowercase | `fund` |
| GP-03 | PENDING / CANCELLED / FAILED / empty | `ignore` (no state change, 200) |
| GP-04 | Underpayment | `reject` (422) |
| GP-05 | Overpayment | `reject` (422) |
| GP-06 | Unparseable amount with COMPLETE | `reject` |
| GP-07 | Decimal string → cents (`1499.00` → `149900`) | Exact, no float drift |
| GP-08 | Garbage amounts (`''`, `abc`, `1.234`, `-5.00`, `1e3`, `null`) | `NaN`, never `0` |

### 3.3 PayFast signature (`tests/PayFastSignature.test.ts`)

| ID | Case | Expected |
| --- | --- | --- |
| SG-01 | PHP `urlencode` parity (` `→`+`, `'`→`%27`, `(`→`%28`, `*`→`%2A`, `~`→`%7E`) | Matches PHP |
| SG-02 | Field order preserved, including numeric-looking keys | Order as posted |
| SG-03 | Known ITN payload | Matches stored vector |
| SG-04 | Uppercase supplied signature | Accepted (case-insensitive hex) |
| SG-05 | Tampered `amount_gross` | Rejected |
| SG-06 | Wrong passphrase | Rejected |
| SG-07 | Missing / empty / malformed signature | `false`, no throw |
| SG-08 | No passphrase configured | `false` (fail closed) |

## 4. Integration cases (written, not yet automated)

| ID | Case | Expected |
| --- | --- | --- |
| IN-01 | Same `pf_payment_id` delivered twice sequentially | 200 / 200, one `audit_logs` row, one state change |
| IN-02 | Same notification delivered concurrently ×20 | Exactly one funding; 19 × 200 no-op |
| IN-03 | Two different `pf_payment_id` values for the same escrow | Second attempt 422; state stays `FUNDED` |
| IN-04 | Postgres down mid-transaction | 500, claim released, retry succeeds, no partial write |
| IN-05 | Redis down | 500 to gateway (retryable); alarm raised; no unfunded acceptance |
| IN-06 | Redis flushed after funding, webhook retried | 422 or 200, never a second funding (DB unique + state guard) |
| IN-07 | Audit row attempted UPDATE by an operator | Trigger raises, change refused |
| IN-08 | Body larger than 64 kB | 400, no processing |
| IN-09 | Signature valid but `transaction_id` unknown | 500/404 path, claim released, no partial write |
| IN-10 | Non-ZAR payload | Currently ignored — see GAP-03 |

## 5. Contract validation (manual, before go-live)

1. Register a PayFast sandbox merchant with a passphrase.
2. Send a real ITN and confirm `verifyPayFastSignature` returns true.
3. Confirm the sandbox signature is **not** accepted when `amount_gross` is altered.
4. Confirm behaviour with a field containing a non-ASCII description and a literal backslash.

The stored signature vector is a regression guard produced by our own implementation; it does not
prove interoperability. Step 2 is mandatory.

## 6. Exit criteria for v1.1.0

- All IN-xx cases automated and green in CI against disposable Postgres and Redis containers.
- Manual PayFast sandbox validation recorded with evidence.
- Zero open `Critical` or `High` defects in `04-bug-reports.md`.
- Load test: 50 concurrent duplicate deliveries per escrow, zero double-funding.

## 7. Result summary

| Suite | Tests | Pass | Fail |
| --- | --- | --- | --- |
| EscrowStateMachine | 6 | 6 | 0 |
| GatewayEventPolicy | 8 | 8 | 0 |
| PayFast signature | 8 | 8 | 0 |
| **Total** | **22** | **22** | **0** |

Integration coverage is 0% and is the single largest quality risk in this release.
