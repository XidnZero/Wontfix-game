/**
 * Lane adoption. A unit picks up its lane's new revision only when it is not
 * mid-engagement — the propagation lag described in the README, deliberate
 * so a redraw doesn't yank a unit out of a fight it's already in.
 */

import type { TickContext } from '../sim';

export function stepLaneAdoption(ctx: TickContext): void {
  for (const unit of ctx.state.units) {
    if (unit.laneId === null || unit.state === 'engaging') continue;

    const lane = ctx.state.lanes.find((l) => l.id === unit.laneId);
    if (!lane) {
      unit.laneId = null;
      continue;
    }

    unit.laneRevision = lane.revision;
  }
}
