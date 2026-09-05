/**
 * Applies player intent at the top of the tick, before anything else runs —
 * see sim.ts step 0. This is the only place `Command` values are read.
 */

import type { TickContext } from '../sim';
import type { Command } from '../io';
import { asId } from '../types';
import type { LaneId } from '../types';

export function applyCommands(ctx: TickContext, commands: Command[]): void {
  for (const command of commands) {
    switch (command.type) {
      case 'CreateLane': {
        const id = asId<LaneId>(ctx.state.nextId++);
        // A source naming furniture the player doesn't own is nulled rather
        // than rejecting the whole command: the lane itself is harmless (it's
        // always created owner:'player'), it's only the free ride on someone
        // else's factory/LZ output that's the exploit. This is what closed
        // off routing enemy production down a player-drawn path — see the
        // matching check in factories.ts.
        const sourceFactory = ctx.state.factories.find((f) => f.id === command.sourceFactoryId);
        const sourceLz = ctx.state.landingZones.find((l) => l.id === command.sourceLzId);
        ctx.state.lanes.push({
          id,
          owner: 'player',
          // Deep-copy: keeping the caller's array/Vec2 objects would let code
          // outside the sim mutate state.lanes after the tick returns, with
          // no tick() call in sight — see the README's rule 3.
          path: command.path.map((p) => ({ x: p.x, y: p.y })),
          mounted: command.mounted,
          revision: 0,
          sourceLzId: sourceLz?.owner === 'player' ? command.sourceLzId : null,
          sourceFactoryId: sourceFactory?.owner === 'player' ? command.sourceFactoryId : null,
        });
        break;
      }

      case 'RedrawLane': {
        const lane = ctx.state.lanes.find((l) => l.id === command.laneId);
        if (!lane || lane.owner !== 'player') break;
        lane.path = command.path.map((p) => ({ x: p.x, y: p.y }));
        lane.revision++;
        break;
      }

      case 'SetLaneMounted': {
        const lane = ctx.state.lanes.find((l) => l.id === command.laneId);
        if (lane && lane.owner === 'player') lane.mounted = command.mounted;
        break;
      }

      case 'DeleteLane': {
        const idx = ctx.state.lanes.findIndex((l) => l.id === command.laneId);
        if (idx < 0 || ctx.state.lanes[idx].owner !== 'player') break;
        ctx.state.lanes.splice(idx, 1);
        for (const unit of ctx.state.units) {
          if (unit.laneId === command.laneId) unit.laneId = null;
        }
        break;
      }

      case 'GrabUnits': {
        for (const unit of ctx.state.units) {
          if (unit.owner === 'player' && command.unitIds.includes(unit.id)) unit.detached = true;
        }
        break;
      }

      case 'IssueMove': {
        for (const unit of ctx.state.units) {
          if (unit.owner === 'player' && command.unitIds.includes(unit.id)) unit.manualTarget = { ...command.dest };
        }
        break;
      }

      case 'ReleaseUnits': {
        for (const unit of ctx.state.units) {
          if (unit.owner === 'player' && command.unitIds.includes(unit.id)) {
            unit.detached = false;
            unit.manualTarget = null;
          }
        }
        break;
      }

      case 'SetFactoryProduction': {
        const factory = ctx.state.factories.find((f) => f.id === command.factoryId);
        if (!factory || factory.owner !== 'player') break;
        factory.producing = command.chassis;
        factory.buildTimer = 0;
        break;
      }
    }
  }
}
