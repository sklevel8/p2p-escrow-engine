import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideGatewayAction, parseAmountToCents } from '../src/services/GatewayEventPolicy';

describe('parseAmountToCents', () => {
  it('parses gateway decimal strings exactly', () => {
    assert.equal(parseAmountToCents('1499.00'), 149900);
    assert.equal(parseAmountToCents('0.05'), 5);
    assert.equal(parseAmountToCents('12.5'), 1250);
    assert.equal(parseAmountToCents('100'), 10000);
    assert.equal(parseAmountToCents(1499), 149900);
  });

  it('rejects garbage instead of coercing it to zero', () => {
    for (const value of ['', 'abc', '1.234', '-5.00', '1e3', null, undefined, {}, Number.NaN]) {
      assert.equal(Number.isNaN(parseAmountToCents(value)), true, `expected NaN for ${String(value)}`);
    }
  });
});

describe('decideGatewayAction', () => {
  it('funds when the payment completed for the exact escrow amount', () => {
    assert.deepEqual(decideGatewayAction({ status: 'COMPLETE', amountGrossCents: 149900, expectedAmountCents: 149900 }), {
      action: 'fund',
    });
  });

  it('accepts alternate success statuses case-insensitively', () => {
    assert.deepEqual(decideGatewayAction({ status: 'paid', amountGrossCents: 100, expectedAmountCents: 100 }), {
      action: 'fund',
    });
  });

  it('ignores pending, cancelled and failed payments', () => {
    for (const status of ['PENDING', 'CANCELLED', 'FAILED', '']) {
      const decision = decideGatewayAction({ status, amountGrossCents: 149900, expectedAmountCents: 149900 });
      assert.equal(decision.action, 'ignore');
    }
  });

  it('rejects an underpayment rather than partially funding the escrow', () => {
    const decision = decideGatewayAction({ status: 'COMPLETE', amountGrossCents: 1499, expectedAmountCents: 149900 });
    assert.equal(decision.action, 'reject');
  });

  it('rejects an overpayment instead of silently accepting it', () => {
    const decision = decideGatewayAction({ status: 'COMPLETE', amountGrossCents: 150000, expectedAmountCents: 149900 });
    assert.equal(decision.action, 'reject');
  });

  it('rejects an unparseable amount even when the status is COMPLETE', () => {
    const decision = decideGatewayAction({
      status: 'COMPLETE',
      amountGrossCents: parseAmountToCents('not-money'),
      expectedAmountCents: 149900,
    });
    assert.equal(decision.action, 'reject');
  });
});
