/**
 * Auto-crew. Mounted lanes only. No allocation logic: first foot squad past
 * the factory takes whatever is parked, the rest walk on — see README.
 *
 * Mounting consumes the squad's foot unit and one parked vehicle, and the
 * vehicle becomes the squad's new body (SQUAD_CONSUMED_ON_MOUNT,
 * CREW_DIES_WITH_VEHICLE — both asserted in config.ts).
 */

import * as C from '../config';
import type { TickContext } from '../sim';
import type { Factory, Unit } from '../types';

function finalizeMount(ctx: TickContext, factory: Factory, footUnit: Unit): void {
  const vehicleId = factory.parked.shift();
  if (vehicleId === undefined) {
    // Lost the race to another squad this tick; go back to walking.
    footUnit.state = 'moving';
    footUnit.stateTimer = 0;
    return;
  }

  const vehicle = ctx.state.units.find((u) => u.id === vehicleId);
  if (!vehicle) return;

  vehicle.squadId = footUnit.squadId;
  vehicle.owner = footUnit.owner;
  vehicle.firmware = footUnit.owner;
  vehicle.laneId = footUnit.laneId;
  vehicle.laneRevision = footUnit.laneRevision;
  vehicle.detached = footUnit.detached;
  vehicle.manualTarget = footUnit.manualTarget;
  vehicle.state = 'moving';
  vehicle.stateTimer = 0;
  vehicle.pos = { ...footUnit.pos };

  const squad = ctx.state.squads.find((s) => s.id === footUnit.squadId);
  if (squad) squad.unitId = vehicle.id;

  const idx = ctx.state.units.indexOf(footUnit);
  if (idx >= 0) ctx.state.units.splice(idx, 1);

  if (footUnit.squadId !== null) {
    ctx.events.push({ type: 'SquadMounted', squadId: footUnit.squadId, unitId: vehicle.id });
  }
}

export function stepMounting(ctx: TickContext): void {
  for (const lane of ctx.state.lanes) {
    if (!lane.mounted || lane.sourceFactoryId === null) continue;
    const factory = ctx.state.factories.find((f) => f.id === lane.sourceFactoryId);
    if (!factory) continue;

    const candidates = ctx.state.units.filter(
      (u) => u.chassis === null && u.squadId !== null && u.laneId === lane.id,
    );

    for (const unit of candidates) {
      if (unit.state === 'mounting') {
        unit.stateTimer--;
        if (unit.stateTimer <= 0) finalizeMount(ctx, factory, unit);
        continue;
      }

      if (factory.parked.length === 0) continue;
      const dx = unit.pos.x - factory.pos.x;
      const dy = unit.pos.y - factory.pos.y;
      if (dx * dx + dy * dy > C.MOUNT_RADIUS * C.MOUNT_RADIUS) continue;

      unit.state = 'mounting';
      unit.stateTimer = C.MOUNT_TICKS;
    }
  }
}
