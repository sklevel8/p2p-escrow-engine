# 01 — Software Requirements Specification (v0.1)

**Role:** Business Analyst · **Status:** Draft, pending formal sign-off
**Project:** P2P Digital Escrow Engine (South Africa)

## 1. Purpose and scope

A neutral third-party escrow engine for South African online marketplaces, social commerce and
freelance platforms. The engine holds buyer funds via local payment gateways until delivery of goods
or services is verified, mitigating fraud and non-payment risk.

Out of scope for v1.0.0: card acquiring of its own (gateways only), cross-border payouts,
multi-currency, credit/instalment facilities, and holding funds in a bank account the platform itself
operates.

## 2. Functional requirements

| ID | Requirement |
| --- | --- |
| FR-1 | Enforce an immutable lifecycle: `Initiated → Funded → In Transit → Delivered → Disputed (optional) → Released / Refunded`. |
| FR-2 | Ingest funds through local aggregators: PayFast (card and Instant EFT), Yoco (payment links), Ozow (direct EFT). |
| FR-3 | On buyer approval, calculate the platform escrow fee and disburse the remainder to the seller's verified South African bank account. |
| FR-4 | On buyer rejection, freeze funds in `Disputed` and open a secure channel for administrators to review evidence before routing funds manually. |

## 3. Security and regulatory compliance

| ID | Requirement |
| --- | --- |
| SR-1 | POPIA: all buyer and seller PII encrypted at rest and anonymised in logs. |
| SR-2 | FICA/KYC: sellers upload verifiable identification and proof of a valid local bank account before withdrawal. |
| SR-3 | Trust account separation: transaction funds route into a dedicated escrow/client account, never the operating account. |

## 4. Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | Auditability: every state change logged permanently with timestamp and actor ID, tamper-evident. |
| NFR-2 | Webhook resilience: asynchronous callbacks handled with idempotency keys so retries cannot double-fund or double-payout. |

## 5. Decision log

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| D-1 | Is escrow state authoritative, or the gateway? | Escrow state is authoritative; gateway events are *proposals* that must be reconciled against it. | Prevents a replayed or forged callback from moving money. |
| D-2 | How is a duplicate callback handled? | Atomically claimed in Redis before processing, released on failure. | A post-commit claim leaves a crash window that double-processes. |
| D-3 | What if the settled amount differs from the escrow amount? | Reject the notification (HTTP 422), never partially fund. | Partial funding creates an unreconcilable ledger. |
| D-4 | Do we trust `status == COMPLETE` alone? | No — status and amount must both reconcile. | Guards against underpayment attacks. |
| D-5 | Is the audit log mutable by an operator? | No. Enforced by a PostgreSQL trigger that blocks UPDATE and DELETE. | Compliance requires tamper evidence, not policy. |
| D-6 | What happens if the signature secret is missing at boot? | Refuse callbacks with 503; never accept unsigned traffic. | Fail closed. |

## 6. Open questions (blocking or near-blocking)

1. **Custody model.** Is the platform a registered third-party payment provider with an actual trust
   account, or does it rely on the gateway's split-payment facility? This changes the entire
   disbursement design and has licensing consequences. *Owner: legal.*
2. **Fee model.** Who bears the escrow fee — buyer, seller, or split? Deducted from settlement or
   invoiced separately?
3. **Settlement timing.** Are payouts instant, T+1, or batched? What happens if the seller's bank
   rejects the payout?
4. **Abandoned escrows.** What is the expiry policy for an `INITIATED` escrow that is never funded?
   A `CANCELLED`/`EXPIRED` state does not exist yet.
5. **Partial refunds.** Explicitly deferred to v1.1.0, but the dispute workflow may require it sooner.
6. **Dispute SLA.** Who adjudicates, within what period, and what is the appeal path?

## 7. Traceability

FR-1 → `EscrowStateMachine` · FR-2 → `WebhookController` + `PayFastSignature` · NFR-2 →
idempotency claim. FR-3, FR-4, SR-1, SR-2, SR-3 are **not yet implemented**; see
`04-bug-reports.md` and the "Known gaps" section of the README.
