/**
 * Factories build continuously and idle at PARKING_CAP rather than queuing —
 * there is no queue to manage, which is the point (see design pillar 3).
 *
 * Parking only applies to player output: `Unit.squadId` is player-only (any
 * AI unit is always uncrewed, per types.ts), so an AI vehicle has nothing to
 * wait for. It rolls straight onto its factory's outbound lane instead of
 * sitting in `parked` — that lane assignment is what makes v1 read as "walks
 * straight, swarms" even with stepAiPlanning stubbed out.
 */

import * as C from '../config';
import type { TickContext } from '../sim';
import { asId } from '../types';
import type { UnitId } from '../types';
import { maxHpFor } from './unitStats';

export function stepFactories(ctx: TickContext): void {
  for (const factory of ctx.state.factories) {
    if (factory.owner === 'neutral') continue;

    const isPlayer = factory.owner === 'player';
    if (isPlayer && factory.parked.length >= C.PARKING_CAP) continue;

    factory.buildTimer++;
    const buildTime = C.BUILD_TICKS[factory.producing] ?? C.BUILD_TICKS.tank;
    if (factory.buildTimer < buildTime) continue;

    factory.buildTimer = 0;

    const outboundLane = isPlayer
      ? null
      : ctx.state.lanes.find((l) => l.sourceFactoryId === factory.id) ?? null;

    const id = asId<UnitId>(ctx.state.nextId++);
    const maxHp = maxHpFor(factory.producing, 0);
    ctx.state.units.push({
      id,
      owner: factory.owner,
      chassis: factory.producing,
      squadId: null,
      firmware: factory.owner,
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { ...factory.pos },
      vel: { x: 0, y: 0 },
      hp: maxHp,
      maxHp,
      laneId: outboundLane?.id ?? null,
      laneRevision: outboundLane?.revision ?? 0,
      detached: false,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      targetId: null,
      effectiveVersion: ctx.state.ai.version,
    });

    ctx.events.push({ type: 'VehicleProduced', factoryId: factory.id, unitId: id });

    if (isPlayer) {
      factory.parked.push(id);
      if (factory.parked.length >= C.PARKING_CAP) {
        ctx.events.push({ type: 'FactoryIdle', factoryId: factory.id });
      }
    }
  }
}
