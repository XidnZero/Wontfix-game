/**
 * Territory tempo — zonesHeld drives dropIntervalFor (see sim.ts), with
 * diminishing returns past DIMINISHING_RETURNS_THRESHOLD so a runaway lead
 * stops compounding. Runs right after capture so the interval a drop uses
 * this tick reflects this tick's territory, not last tick's.
 */

import type { TickContext } from '../sim';
import { dropIntervalFor } from '../sim';

export function stepTerritoryTempo(ctx: TickContext): void {
  const side = ctx.state.player;
  const zonesTotal = ctx.state.zones.length;
  const zonesHeld = ctx.state.zones.filter((z) => z.owner === 'player').length;
  side.zonesHeld = zonesHeld;

  const interval = dropIntervalFor(zonesHeld, zonesTotal);
  if (interval !== side.dropIntervalTicks) {
    side.dropIntervalTicks = interval;
    ctx.events.push({ type: 'DropCadenceChanged', intervalTicks: interval });
  }
}
