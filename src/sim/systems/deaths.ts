/**
 * Deaths — swept after combat, before capture, so a squad wiped standing on
 * a point stops capturing it the same tick (see the README's tick-ordering
 * section).
 *
 * CREW_DIES_WITH_VEHICLE (config.ts) resolves here: a destroyed crewed
 * vehicle emits both UnitDestroyed and CrewLost, and the squad is gone with
 * it — no wounded-in-reserve state, per SQUAD_CONSUMED_ON_MOUNT.
 */

import type { TickContext } from '../sim';

export function stepDeaths(ctx: TickContext): void {
  const dead = ctx.state.units.filter((u) => u.hp <= 0);
  if (dead.length === 0) return;

  const deadIds = new Set(dead.map((u) => u.id));

  for (const unit of dead) {
    ctx.events.push({ type: 'UnitDestroyed', unitId: unit.id, owner: unit.owner });

    if (unit.squadId !== null) {
      ctx.events.push({ type: 'CrewLost', squadId: unit.squadId, unitId: unit.id });
      const squadIdx = ctx.state.squads.findIndex((s) => s.id === unit.squadId);
      if (squadIdx >= 0) ctx.state.squads.splice(squadIdx, 1);
    }
  }

  ctx.state.units = ctx.state.units.filter((u) => !deadIds.has(u.id));
  for (const factory of ctx.state.factories) {
    factory.parked = factory.parked.filter((id) => !deadIds.has(id));
  }
}
