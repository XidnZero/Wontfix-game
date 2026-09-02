/**
 * Dropships — the player's only source of crews. Cadence comes from
 * territoryTempo (already applied to `dropIntervalTicks` this tick).
 *
 * No approach telegraph yet: `DropshipInbound`/`DROPSHIP_APPROACH_TICKS`
 * exist in the io/config surface for the render layer to consume later, but
 * wiring an approach delay needs nothing new in `MissionState` (dropTimer
 * already carries it) so it is left for whoever builds the landing-zone
 * render telegraph rather than guessed at here.
 */

import * as C from '../config';
import { randomInt, randomPick } from '../rng';
import type { TickContext } from '../sim';
import { asId } from '../types';
import type { SquadId, UnitId } from '../types';
import { maxHpFor } from './unitStats';

export function stepDropships(ctx: TickContext): void {
  const side = ctx.state.player;
  side.dropTimer++;
  if (side.dropTimer < side.dropIntervalTicks) return;
  side.dropTimer = 0;

  const activeLzs = ctx.state.landingZones.filter((lz) => lz.owner === 'player' && lz.active);
  if (activeLzs.length === 0) return;
  const lz = randomPick(ctx.state, activeLzs);

  const lane = ctx.state.lanes.find((l) => l.sourceLzId === lz.id);
  const squadCount = randomInt(ctx.state, C.SQUADS_PER_DROP_MIN, C.SQUADS_PER_DROP_MAX);
  const squadIds: SquadId[] = [];

  for (let i = 0; i < squadCount; i++) {
    const unitId = asId<UnitId>(ctx.state.nextId++);
    const squadId = asId<SquadId>(ctx.state.nextId++);
    const kind = randomPick(ctx.state, ['rifle', 'antiArmour'] as const);
    const bodies = C.SQUAD_SIZE;
    const maxHp = maxHpFor(null, bodies);

    ctx.state.squads.push({
      id: squadId,
      callsign: `S-${squadId}`,
      kind,
      bodies,
      veterancy: 0,
      unitId,
    });

    ctx.state.units.push({
      id: unitId,
      owner: 'player',
      chassis: null,
      squadId,
      firmware: 'player',
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { x: lz.pos.x + (i - squadCount / 2) * 24, y: lz.pos.y },
      vel: { x: 0, y: 0 },
      hp: maxHp,
      maxHp,
      laneId: lane?.id ?? null,
      laneRevision: lane?.revision ?? 0,
      detached: false,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      targetId: null,
      effectiveVersion: ctx.state.ai.version,
    });

    squadIds.push(squadId);
  }

  ctx.events.push({ type: 'DropshipLanded', lzId: lz.id, squadIds });
}
