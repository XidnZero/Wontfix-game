/**
 * Squad reinforcement. `bodies` tracks `hp` as a fraction of `maxHp` every
 * tick — a squad that's taken damage hits back proportionally softer
 * (unitDamage scales with bodies), which is what makes "a squad at 2/5 is
 * still the squad" (types.ts) actually mean something instead of hp being an
 * invisible pool underneath a number that never moves.
 *
 * Only the healing itself is gated on standing near a friendly LZ; the
 * bodies-from-hp sync runs unconditionally so a thinned squad reads as
 * thinned everywhere, not just at home.
 */

import * as C from '../config';
import type { TickContext } from '../sim';

export function stepReinforcement(ctx: TickContext): void {
  for (const unit of ctx.state.units) {
    if (unit.chassis !== null || unit.squadId === null) continue;

    if (unit.hp < unit.maxHp) {
      const nearFriendlyLz = ctx.state.landingZones.some((lz) => {
        if (!lz.active || lz.owner !== unit.owner) return false;
        const dx = lz.pos.x - unit.pos.x;
        const dy = lz.pos.y - unit.pos.y;
        return dx * dx + dy * dy <= C.REINFORCE_RADIUS * C.REINFORCE_RADIUS;
      });

      if (nearFriendlyLz) {
        unit.hp = Math.min(unit.maxHp, unit.hp + unit.maxHp / C.SQUAD_REINFORCE_TICKS);
      }
    }

    const squad = ctx.state.squads.find((s) => s.id === unit.squadId);
    if (!squad) continue;

    const fraction = unit.maxHp > 0 ? unit.hp / unit.maxHp : 0;
    squad.bodies = Math.min(C.SQUAD_SIZE, Math.max(1, Math.round(fraction * C.SQUAD_SIZE)));
  }
}
