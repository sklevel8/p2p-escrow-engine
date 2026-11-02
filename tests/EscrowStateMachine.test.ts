import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EscrowStateMachine, EscrowState, InvalidTransitionError } from '../src/services/EscrowStateMachine';

describe('EscrowStateMachine', () => {
  it('accepts every transition in the documented lifecycle', () => {
    assert.equal(EscrowStateMachine.transition(EscrowState.INITIATED, EscrowState.FUNDED), EscrowState.FUNDED);
    assert.equal(EscrowStateMachine.transition(EscrowState.FUNDED, EscrowState.IN_TRANSIT), EscrowState.IN_TRANSIT);
    assert.equal(EscrowStateMachine.transition(EscrowState.IN_TRANSIT, EscrowState.DELIVERED), EscrowState.DELIVERED);
    assert.equal(EscrowStateMachine.transition(EscrowState.DELIVERED, EscrowState.RELEASED), EscrowState.RELEASED);
  });

  it('allows the disputed branch from IN_TRANSIT and DELIVERED', () => {
    assert.equal(EscrowStateMachine.transition(EscrowState.IN_TRANSIT, EscrowState.DISPUTED), EscrowState.DISPUTED);
    assert.equal(EscrowStateMachine.transition(EscrowState.DELIVERED, EscrowState.DISPUTED), EscrowState.DISPUTED);
    assert.equal(EscrowStateMachine.transition(EscrowState.DISPUTED, EscrowState.REFUNDED), EscrowState.REFUNDED);
    assert.equal(EscrowStateMachine.transition(EscrowState.DISPUTED, EscrowState.RELEASED), EscrowState.RELEASED);
  });

  it('prevents skipping states (INITIATED straight to RELEASED)', () => {
    assert.throws(
      () => EscrowStateMachine.transition(EscrowState.INITIATED, EscrowState.RELEASED),
      InvalidTransitionError,
    );
  });

  it('prevents re-funding an already funded escrow', () => {
    assert.throws(
      () => EscrowStateMachine.transition(EscrowState.FUNDED, EscrowState.FUNDED),
      /Invalid state transition: cannot move from FUNDED to FUNDED/,
    );
  });

  it('treats RELEASED and REFUNDED as terminal', () => {
    for (const terminal of [EscrowState.RELEASED, EscrowState.REFUNDED]) {
      assert.equal(EscrowStateMachine.isTerminal(terminal), true);
      for (const target of Object.values(EscrowState)) {
        assert.throws(() => EscrowStateMachine.transition(terminal, target), InvalidTransitionError);
      }
    }
  });

  it('exposes the current and attempted states on the error', () => {
    try {
      EscrowStateMachine.transition(EscrowState.INITIATED, EscrowState.DISPUTED);
      assert.fail('expected a throw');
    } catch (error) {
      assert.ok(error instanceof InvalidTransitionError);
      assert.equal(error.currentState, EscrowState.INITIATED);
      assert.equal(error.nextState, EscrowState.DISPUTED);
    }
  });
});
