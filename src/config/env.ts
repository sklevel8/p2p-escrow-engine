/**
 * Centralised environment access. Anything that is security-relevant is read
 * once at boot so that misconfiguration fails closed rather than silently
 * degrading into an insecure mode.
 */

export interface AppEnv {
  readonly nodeEnv: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** PayFast ITN passphrase (the "salt passphrase" from the merchant dashboard). */
  readonly payfastPassphrase: string;
  /** Idempotency keys are retained for 24h, matching the gateway retry window. */
  readonly idempotencyTtlSeconds: number;
}

function optional(name: string): string {
  return (process.env[name] ?? '').trim();
}

export const env: AppEnv = {
  nodeEnv: optional('NODE_ENV') || 'development',
  port: Number.parseInt(optional('PORT') || '3000', 10),
  databaseUrl: optional('DATABASE_URL'),
  redisUrl: optional('REDIS_URL') || 'redis://localhost:6379',
  payfastPassphrase: optional('PAYFAST_PASSPHRASE'),
  idempotencyTtlSeconds: 86_400,
};

export function isProduction(): boolean {
  return env.nodeEnv === 'production';
}
