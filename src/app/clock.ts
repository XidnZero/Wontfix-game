/**
 * Fixed-timestep clock.
 *
 * The sim advances in whole ticks at TICK_HZ regardless of frame rate. The
 * renderer interpolates between the last two ticks using `alpha`, which is what
 * makes 20Hz simulation look smooth at 60 or 144 fps.
 *
 * This file is the only place variable frame time exists. Nothing under
 * src/sim ever sees a delta.
 */

import { TICK_MS } from '../sim/config';
import type { SimEvent } from '../sim/io';
import type { Simulation } from '../sim/sim';

/**
 * Cap on ticks per frame. Without it, a backgrounded tab returning after 30
 * seconds tries to simulate 600 ticks in one frame and locks up. Dropping the
 * excess is correct: the sim falls behind wall-clock, which nobody notices in a
 * single-player game, and stays deterministic because tick count is unchanged.
 */
const MAX_TICKS_PER_FRAME = 5;

export type Speed = 0 | 1 | 2 | 3;

export class Clock {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private rafId = 0;

  /** 0 is pause. Both fall out of fixed timestep for free. */
  speed: Speed = 1;

  constructor(
    private sim: Simulation,
    private onEvents: (events: SimEvent[]) => void,
    private onRender: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private frame = (now: number): void => {
    if (!this.running) return;

    const elapsed = now - this.lastTime;
    this.lastTime = now;
    this.accumulator += elapsed * this.speed;

    let ticks = 0;
    while (this.accumulator >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
      const events = this.sim.advance();
      if (events.length > 0) this.onEvents(events);
      this.accumulator -= TICK_MS;
      ticks++;
    }

    // Discard any backlog beyond the cap rather than carrying it forward.
    if (this.accumulator > TICK_MS * MAX_TICKS_PER_FRAME) {
      this.accumulator = 0;
    }

    // Paused: hold alpha at 0 so nothing drifts between the last two ticks.
    // Clamped to 1: the tick loop above can stop at MAX_TICKS_PER_FRAME with
    // accumulator still a full TICK_MS or more outstanding, which would
    // otherwise interpolate past currPos instead of sitting on it.
    const alpha = this.speed === 0 ? 0 : Math.min(1, this.accumulator / TICK_MS);
    this.onRender(alpha);

    this.rafId = requestAnimationFrame(this.frame);
  };
}

/**
 * Headless driver for tests and balance sweeps. No rAF, no timing, no browser.
 * This is the payoff for keeping the sim pure: a full mission runs in
 * milliseconds in Node, so you can sweep a config value across a hundred runs.
 */
export function runHeadless(
  sim: Simulation,
  maxTicks: number,
  onEvents?: (events: SimEvent[]) => void,
): void {
  for (let i = 0; i < maxTicks; i++) {
    const events = sim.advance();
    if (onEvents && events.length > 0) onEvents(events);
    if (sim.state.phase === 'won' || sim.state.phase === 'lost') return;
  }
}
