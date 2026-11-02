-- P2P Escrow Engine schema (PostgreSQL 14+)
-- Money is stored as integer cents. ZAR only in v1.0.0.

CREATE TYPE escrow_state AS ENUM (
  'INITIATED',
  'FUNDED',
  'IN_TRANSIT',
  'DELIVERED',
  'DISPUTED',
  'RELEASED',
  'REFUNDED'
);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id     UUID PRIMARY KEY,
  buyer_id           UUID NOT NULL,
  seller_id          UUID NOT NULL,
  amount_cents       BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents          BIGINT NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  currency           CHAR(3) NOT NULL DEFAULT 'ZAR',
  status             escrow_state NOT NULL DEFAULT 'INITIATED',
  gateway_reference  TEXT UNIQUE,
  funded_at          TIMESTAMPTZ,
  released_at        TIMESTAMPTZ,
  refunded_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fee_not_above_amount CHECK (fee_cents < amount_cents),
  CONSTRAINT distinct_parties CHECK (buyer_id <> seller_id)
);

CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions (status);
CREATE INDEX IF NOT EXISTS transactions_gateway_ref_idx ON transactions (gateway_reference);

-- Append-only audit trail. Every state change writes one row here inside the
-- same database transaction as the state update.
CREATE TABLE IF NOT EXISTS audit_logs (
  id                 BIGSERIAL PRIMARY KEY,
  transaction_id     UUID NOT NULL REFERENCES transactions (transaction_id),
  action             TEXT NOT NULL,
  actor_id           TEXT NOT NULL,
  from_status        escrow_state,
  to_status          escrow_state,
  gateway_reference  TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_transaction_idx ON audit_logs (transaction_id, created_at);

-- Enforce immutability at the database layer rather than relying on application
-- discipline. Updates and deletes become impossible for every role.
CREATE OR REPLACE FUNCTION audit_logs_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_mutation ON audit_logs;
CREATE TRIGGER audit_logs_no_mutation
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
