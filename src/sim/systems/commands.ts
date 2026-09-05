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
        ctx.state.lanes.push({
          id,
          owner: 'player',
          // Deep-copy: keeping the caller's array/Vec2 objects would let code
          // outside the sim mutate state.lanes after the tick returns, with
          // no tick() call in sight — see the README's rule 3.
          path: command.path.map((p) => ({ x: p.x, y: p.y })),
          mounted: command.mounted,
          revision: 0,
          sourceLzId: command.sourceLzId,
          sourceFactoryId: command.sourceFactoryId,
        });
        break;
      }

      case 'RedrawLane': {
        const lane = ctx.state.lanes.find((l) => l.id === command.laneId);
        if (!lane) break;
        lane.path = command.path.map((p) => ({ x: p.x, y: p.y }));
        lane.revision++;
        break;
      }

      case 'SetLaneMounted': {
        const lane = ctx.state.lanes.find((l) => l.id === command.laneId);
        if (lane) lane.mounted = command.mounted;
        break;
      }

      case 'DeleteLane': {
        const idx = ctx.state.lanes.findIndex((l) => l.id === command.laneId);
        if (idx < 0) break;
        ctx.state.lanes.splice(idx, 1);
        for (const unit of ctx.state.units) {
          if (unit.laneId === command.laneId) unit.laneId = null;
        }
        break;
      }

      case 'GrabUnits': {
        for (const unit of ctx.state.units) {
          if (command.unitIds.includes(unit.id)) unit.detached = true;
        }
        break;
      }

      case 'IssueMove': {
        for (const unit of ctx.state.units) {
          if (command.unitIds.includes(unit.id)) unit.manualTarget = { ...command.dest };
        }
        break;
      }

      case 'ReleaseUnits': {
        for (const unit of ctx.state.units) {
          if (command.unitIds.includes(unit.id)) {
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
