/**
 * GameState — Application state machine.
 * loading -> menu -> driving <-> paused / garage / photo / replay
 */

import { EventBus, Events } from '../core/EventBus';

export type GameState =
  | 'loading'
  | 'menu'
  | 'driving'
  | 'paused'
  | 'garage'
  | 'photo'
  | 'replay'
  | 'settings'
  | 'stats'
  | 'achievements'
  | 'controls'
  | 'credits';

export class GameStateMachine {
  private bus = EventBus.get();
  private current: GameState = 'loading';
  private previous: GameState = 'loading';

  get state(): GameState {
    return this.current;
  }

  get last(): GameState {
    return this.previous;
  }

  is(...states: GameState[]): boolean {
    return states.includes(this.current);
  }

  transition(next: GameState): void {
    if (next === this.current) return;
    this.previous = this.current;
    this.current = next;
    this.bus.emit(Events.STATE_CHANGE, { from: this.previous, to: next });
  }

  /** Return to the state before opening an overlay (settings etc.). */
  back(): void {
    const target = this.previous === this.current ? 'menu' : this.previous;
    this.transition(target);
  }
}
