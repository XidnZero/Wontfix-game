/**
 * Uniform grid for proximity queries. Not a quadtree — see the README.
 *
 * Rebuilt from scratch every tick (`sim.ts` step 1) rather than mutated
 * incrementally. At vertical-slice unit counts that is cheaper than the
 * bookkeeping an incremental grid would need, and it removes an entire class
 * of stale-bucket bugs.
 */

import { SPATIAL_CELL_SIZE } from '../config';
import type { Unit, UnitId } from '../types';
import type { SpatialGrid } from '../sim';

function cellKey(x: number, y: number): string {
  const cx = Math.floor(x / SPATIAL_CELL_SIZE);
  const cy = Math.floor(y / SPATIAL_CELL_SIZE);
  return `${cx},${cy}`;
}

export function createSpatialGrid(): SpatialGrid {
  let cells = new Map<string, UnitId[]>();
  let unitsById = new Map<UnitId, Unit>();

  return {
    rebuild(units: Unit[]): void {
      cells = new Map();
      unitsById = new Map();
      for (const unit of units) {
        unitsById.set(unit.id, unit);
        const key = cellKey(unit.pos.x, unit.pos.y);
        const bucket = cells.get(key);
        if (bucket) bucket.push(unit.id);
        else cells.set(key, [unit.id]);
      }
    },

    near(x: number, y: number, radius: number): Unit[] {
      const result: Unit[] = [];
      const r2 = radius * radius;
      const minCx = Math.floor((x - radius) / SPATIAL_CELL_SIZE);
      const maxCx = Math.floor((x + radius) / SPATIAL_CELL_SIZE);
      const minCy = Math.floor((y - radius) / SPATIAL_CELL_SIZE);
      const maxCy = Math.floor((y + radius) / SPATIAL_CELL_SIZE);

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const bucket = cells.get(`${cx},${cy}`);
          if (!bucket) continue;
          for (const id of bucket) {
            // Missing here means the id was forgotten (unit removed mid-tick
            // by deaths.ts/mounting.ts) — same effect as the stale bucket
            // entry it leaves behind never being cleaned up.
            const unit = unitsById.get(id);
            if (!unit) continue;
            const dx = unit.pos.x - x;
            const dy = unit.pos.y - y;
            if (dx * dx + dy * dy <= r2) result.push(unit);
          }
        }
      }
      return result;
    },

    byId(id: UnitId): Unit | undefined {
      return unitsById.get(id);
    },

    forget(id: UnitId): void {
      unitsById.delete(id);
    },
  };
}
