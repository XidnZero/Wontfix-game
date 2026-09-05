/**
 * Targeting — nearest enemy in range, recomputed fresh every tick rather than
 * remembered. That keeps a lost or killed target a non-event instead of a
 * dangling reference to chase down.
 *
 * Must run before combat, and its state transitions must land before
 * movement's next tick: a unit switches to 'engaging' (movement.ts holds it
 * still) the instant an enemy is in range, and drops back to 'moving' the
 * instant it isn't.
 */

import * as C from '../config';
import type { TickContext } from '../sim';
import type { Owner, Unit } from '../types';
import { unitDamage, unitRange } from './unitStats';
import { inUnownedZone } from './movement';

function enemyOf(owner: Owner): Owner | null {
  if (owner === 'player') return 'ai';
  if (owner === 'ai') return 'player';
  return null;
}

export function stepTargeting(ctx: TickContext): void {
  for (const unit of ctx.state.units) {
    if (unit.state === 'mounting' || unit.state === 'rebooting') continue;
    if (unitDamage(ctx.state, unit) <= 0) continue;

    const enemyOwner = enemyOf(unit.owner);
    if (!enemyOwner) continue;

    const range = unitRange(ctx.state, unit);
    const nearby = ctx.grid.near(unit.pos.x, unit.pos.y, C.AGGRO_RANGE);

    let bestId: Unit['id'] | null = null;
    let bestDist2 = Infinity;

    for (const other of nearby) {
      if (other.id === unit.id || other.owner !== enemyOwner) continue;
      const dx = other.pos.x - unit.pos.x;
      const dy = other.pos.y - unit.pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestId = other.id;
      }
    }

    unit.targetId = bestId;
    const nowEngaging = bestId !== null && bestDist2 <= range * range;
    if (nowEngaging && unit.state !== 'engaging') unit.stateTimer = 0;
    // Runs after movement.ts's own 'capturing' assignment (see stepMovement)
    // and would otherwise clobber it every tick — a unit holding a point
    // deliberately would read as 'moving' while standing still.
    unit.state = nowEngaging ? 'engaging' : inUnownedZone(ctx, unit) ? 'capturing' : 'moving';
  }
}
