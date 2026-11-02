import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayFastSignature,
  parseOrderedPayload,
  phpUrlEncode,
  verifyPayFastSignature,
} from '../src/services/PayFastSignature';

const PASSPHRASE = 'test-passphrase';

const ITN_BODY =
  'm_payment_id=TX-1001&pf_payment_id=PF-778899&payment_status=COMPLETE' +
  '&amount_gross=1499.00&item_name=Escrow%3A+Nikon+D750+%26+24-70mm';

// Regression vector generated once from the documented PayFast algorithm.
// Must be re-validated against the PayFast sandbox before go-live.
const EXPECTED_SIGNATURE = '2356e94fa5509a152bb71da214ea37eb';

describe('PayFast signature', () => {
  it('encodes values the way PHP urlencode() does', () => {
    assert.equal(phpUrlEncode('a b'), 'a+b');
    assert.equal(phpUrlEncode("it's (fine)*~"), 'it%27s+%28fine%29%2A%7E');
    assert.equal(phpUrlEncode('R&D'), 'R%26D');
    assert.equal(phpUrlEncode('a.b-c_d'), 'a.b-c_d');
  });

  it('preserves field order from the raw body', () => {
    const fields = parseOrderedPayload('b=2&a=1&10=ten&2=two');
    assert.deepEqual(fields.map(([key]) => key), ['b', 'a', '10', '2']);
  });

  it('produces the documented signature for a known ITN payload', () => {
    const fields = parseOrderedPayload(`${ITN_BODY}&signature=${EXPECTED_SIGNATURE}`);
    assert.equal(buildPayFastSignature(fields, PASSPHRASE), EXPECTED_SIGNATURE);
  });

  it('verifies a correct signature', () => {
    const fields = parseOrderedPayload(`${ITN_BODY}&signature=${EXPECTED_SIGNATURE}`);
    assert.equal(verifyPayFastSignature(fields, EXPECTED_SIGNATURE, PASSPHRASE), true);
    assert.equal(verifyPayFastSignature(fields, EXPECTED_SIGNATURE.toUpperCase(), PASSPHRASE), true);
  });

  it('rejects a tampered amount', () => {
    const tampered = `${ITN_BODY.replace('1499.00', '14.99')}&signature=${EXPECTED_SIGNATURE}`;
    assert.equal(verifyPayFastSignature(parseOrderedPayload(tampered), EXPECTED_SIGNATURE, PASSPHRASE), false);
  });

  it('rejects a wrong passphrase', () => {
    const fields = parseOrderedPayload(`${ITN_BODY}&signature=${EXPECTED_SIGNATURE}`);
    assert.equal(verifyPayFastSignature(fields, EXPECTED_SIGNATURE, 'wrong-passphrase'), false);
  });

  it('rejects missing, empty or malformed signatures instead of throwing', () => {
    const fields = parseOrderedPayload(ITN_BODY);
    assert.equal(verifyPayFastSignature(fields, undefined, PASSPHRASE), false);
    assert.equal(verifyPayFastSignature(fields, '', PASSPHRASE), false);
    assert.equal(verifyPayFastSignature(fields, 'not-a-digest', PASSPHRASE), false);
  });

  it('fails closed when no passphrase is configured', () => {
    const fields = parseOrderedPayload(`${ITN_BODY}&signature=${EXPECTED_SIGNATURE}`);
    assert.equal(verifyPayFastSignature(fields, EXPECTED_SIGNATURE, ''), false);
  });
});
