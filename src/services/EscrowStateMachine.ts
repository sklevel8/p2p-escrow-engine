export enum EscrowState {
  INITIATED = 'INITIATED',
  FUNDED = 'FUNDED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  DISPUTED = 'DISPUTED',
  RELEASED = 'RELEASED',
  REFUNDED = 'REFUNDED',
}

export class InvalidTransitionError extends Error {
  public readonly currentState: EscrowState;
  public readonly nextState: EscrowState;

  constructor(currentState: EscrowState, nextState: EscrowState) {
    super(`Invalid state transition: cannot move from ${currentState} to ${nextState}`);
    this.name = 'InvalidTransitionError';
    this.currentState = currentState;
    this.nextState = nextState;
  }
}

/**
 * The escrow lifecycle. Every money-moving operation is gated by this table:
 * a callback cannot jump straight from INITIATED to RELEASED, and terminal
 * states accept no further movement.
 */
export class EscrowStateMachine {
  private static readonly ALLOWED_TRANSITIONS: Record<EscrowState, readonly EscrowState[]> = {
    [EscrowState.INITIATED]: [EscrowState.FUNDED],
    [EscrowState.FUNDED]: [EscrowState.IN_TRANSIT, EscrowState.REFUNDED],
    [EscrowState.IN_TRANSIT]: [EscrowState.DELIVERED, EscrowState.DISPUTED],
    [EscrowState.DELIVERED]: [EscrowState.RELEASED, EscrowState.DISPUTED],
    [EscrowState.DISPUTED]: [EscrowState.RELEASED, EscrowState.REFUNDED],
    [EscrowState.RELEASED]: [],
    [EscrowState.REFUNDED]: [],
  };

  public static isTerminal(state: EscrowState): boolean {
    return this.ALLOWED_TRANSITIONS[state].length === 0;
  }

  public static canTransition(currentState: EscrowState, nextState: EscrowState): boolean {
    return this.ALLOWED_TRANSITIONS[currentState]?.includes(nextState) ?? false;
  }

  /**
   * Validates a transition and returns the resulting state. Pure function: it
   * does not persist anything, which keeps the rules testable in isolation.
   */
  public static transition(currentState: EscrowState, nextState: EscrowState): EscrowState {
    if (!this.canTransition(currentState, nextState)) {
      throw new InvalidTransitionError(currentState, nextState);
    }
    return nextState;
  }
}
