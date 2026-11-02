import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * PayFast ITN signature verification.
 *
 * Algorithm (as published by PayFast):
 *   1. Take the fields exactly in the order they appear in the POST body.
 *   2. Drop the `signature` field.
 *   3. Build `key=phpUrlEncode(value)` pairs joined by `&`.
 *   4. Append `&passphrase=phpUrlEncode(passphrase)`.
 *   5. MD5 the resulting string as hex.
 *
 * PHP's `urlencode` differs from JavaScript's `encodeURIComponent`, so the
 * encoding below is deliberately reimplemented rather than approximated.
 */

export type PayFastFields = ReadonlyArray<readonly [string, string]>;

/** Equivalent of PHP `urlencode()`: space becomes `+`, unreserved set is stricter than JS. */
export function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

/**
 * Parses a raw `application/x-www-form-urlencoded` body while preserving field
 * order. `URLSearchParams` is used because plain object keys that look numeric
 * are reordered by JavaScript engines, which would break the signature.
 */
export function parseOrderedPayload(rawBody: string): PayFastFields {
  return [...new URLSearchParams(rawBody).entries()];
}

export function buildPayFastSignature(fields: PayFastFields, passphrase: string): string {
  const pairs = fields
    .filter(([key]) => key !== 'signature')
    .map(([key, value]) => `${key}=${phpUrlEncode(value)}`);

  const payload = passphrase ? `${pairs.join('&')}&passphrase=${phpUrlEncode(passphrase)}` : pairs.join('&');

  return createHash('md5').update(payload, 'utf8').digest('hex');
}

/**
 * Constant-time comparison against the signature supplied by the gateway.
 * Returns false for missing or malformed signatures.
 */
export function verifyPayFastSignature(
  fields: PayFastFields,
  providedSignature: string | undefined,
  passphrase: string,
): boolean {
  if (!providedSignature) return false;
  if (!passphrase) return false;

  const expected = Buffer.from(buildPayFastSignature(fields, passphrase), 'utf8');
  const supplied = Buffer.from(providedSignature.trim().toLowerCase(), 'utf8');

  if (expected.length !== supplied.length) return false;
  return timingSafeEqual(expected, supplied);
}
