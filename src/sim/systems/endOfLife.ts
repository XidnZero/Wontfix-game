/**
 * End-of-life ripple. Shutdown plays out over END_OF_LIFE_RIPPLE_TICKS
 * rather than resolving instantly — watching an army go inert is the payoff
 * (README), so this just holds the phase open for that long before the win
 * actually lands.
 */

import * as C from '../config';
import type { TickContext } from '../sim';

export function stepEndOfLifeRipple(ctx: TickContext): void {
  ctx.state.phaseTimer++;
  if (ctx.state.phaseTimer < C.END_OF_LIFE_RIPPLE_TICKS) return;

  ctx.state.phase = 'won';
  ctx.events.push({ type: 'MissionWon' });
}
