/**
 * Resolution. Win on all factories, lose on the zero-zone loss clock.
 *
 * Only evaluated while `playing` — once the ripple starts, endOfLife.ts owns
 * the phase transition to `won`.
 */

import * as C from '../config';
import type { TickContext } from '../sim';
import { stepLossClock } from '../sim';

export function stepWinLose(ctx: TickContext): void {
  if (ctx.state.phase !== 'playing') return;

  stepLossClock(ctx.state.player, ctx.events);
  if (ctx.state.player.lossClockTicks >= C.LOSS_CLOCK_TICKS) {
    ctx.state.phase = 'lost';
    ctx.events.push({ type: 'MissionLost' });
    return;
  }

  if (ctx.state.factories.length > 0 && ctx.state.factories.every((f) => f.owner === 'player')) {
    ctx.state.phase = 'endOfLife';
    ctx.state.phaseTimer = 0;
    ctx.events.push({ type: 'EndOfLifeIssued' });
  }
}
