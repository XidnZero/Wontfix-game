/**
 * Combat. Only units targeting.ts put into 'engaging' this tick fire —
 * everyone else is still walking their lane. Damage is applied immediately;
 * deaths.ts sweeps zero-hp units afterward so a kill and the capture it
 * enables can land in the same tick.
 */

import * as C from '../config';
import type { TickContext } from '../sim';
import { unitDamage } from './unitStats';

export function stepCombat(ctx: TickContext): void {
  for (const unit of ctx.state.units) {
    if (unit.state !== 'engaging' || unit.targetId === null) continue;

    unit.attackCooldown++;
    if (unit.attackCooldown < C.ATTACK_COOLDOWN_TICKS) continue;
    unit.attackCooldown = 0;

    const target = ctx.grid.byId(unit.targetId);
    if (!target) {
      unit.targetId = null;
      continue;
    }

    target.hp -= unitDamage(ctx.state, unit);
  }
}
