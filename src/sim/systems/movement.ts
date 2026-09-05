/**
 * Movement — flow fields, one per lane destination. Not per-unit A*.
 *
 * There is no terrain in `MissionState` (the vertical-slice map is open
 * rectangles — see the README), so a lane's "flow field" reduces to its
 * polyline: a unit's desired direction is always toward the next waypoint
 * ahead of its closest point on that polyline. That is what keeps this a
 * flat per-unit projection instead of a pathfind, and why no per-unit
 * "how far along the lane am I" field needs to live in `Unit` — it is
 * recomputed cheaply from position every tick, so a mid-mission snapshot
 * restores it for free.
 *
 * Separation is layered on top of the flow direction so units pushing down
 * the same lane don't stack on each other.
 */

import * as C from '../config';
import type { TickContext } from '../sim';
import type { Lane, Unit, Vec2 } from '../types';
import { unitSpeed } from './unitStats';

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function len(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function normalize(v: Vec2): Vec2 {
  const l = len(v);
  return l < 1e-6 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}

/**
 * The waypoint a unit should be heading toward: the end of the segment
 * closest to its current position. On the last segment that's the lane's
 * final waypoint, which is what makes arrival fall out naturally.
 */
function nextWaypoint(path: Vec2[], pos: Vec2): Vec2 | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0];

  let bestDist = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const ab = sub(b, a);
    const abLen2 = ab.x * ab.x + ab.y * ab.y;
    const t = abLen2 < 1e-6 ? 0 : Math.max(0, Math.min(1, (
      (pos.x - a.x) * ab.x + (pos.y - a.y) * ab.y
    ) / abLen2));
    const closest = { x: a.x + ab.x * t, y: a.y + ab.y * t };
    const d = len(sub(pos, closest));
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  // The nearest segment's far end is the natural next target, but if the
  // unit is already standing on top of it (having just arrived, or having
  // overshot on a fast tick) that end is a stale waypoint, not the
  // destination — keep walking forward until we find one that's actually
  // ahead, stopping only at the path's true end.
  let targetIdx = bestIdx + 1;
  while (
    targetIdx < path.length - 1 &&
    len(sub(path[targetIdx], pos)) <= C.WAYPOINT_ARRIVAL_RADIUS
  ) {
    targetIdx++;
  }
  return path[targetIdx];
}

function destinationFor(ctx: TickContext, unit: Unit): Vec2 | null {
  if (unit.detached) return unit.manualTarget;

  if (unit.laneId === null) return null;
  const lane = ctx.state.lanes.find((l: Lane) => l.id === unit.laneId);
  if (!lane || lane.path.length === 0) return null;
  return nextWaypoint(lane.path, unit.pos);
}

/**
 * A unit standing inside a zone someone else owns (or nobody does yet)
 * holds there instead of walking through it — capturing the point takes
 * priority over reaching whatever's next on the lane. Recomputed fresh every
 * tick from position rather than a stored flag, so it self-corrects the
 * instant capture.ts flips the zone: no event to consume, nothing to reset.
 */
export function inUnownedZone(ctx: TickContext, unit: Unit): boolean {
  if (unit.owner === 'neutral') return false;
  for (const zone of ctx.state.zones) {
    if (zone.owner === unit.owner) continue;
    const dx = zone.center.x - unit.pos.x;
    const dy = zone.center.y - unit.pos.y;
    if (dx * dx + dy * dy <= zone.radius * zone.radius) return true;
  }
  return false;
}

export function stepMovement(ctx: TickContext): void {
  for (const unit of ctx.state.units) {
    if (unit.state === 'engaging' || unit.state === 'mounting' || unit.state === 'rebooting') {
      unit.vel = { x: 0, y: 0 };
      continue;
    }

    if (inUnownedZone(ctx, unit)) {
      unit.vel = { x: 0, y: 0 };
      unit.state = 'capturing';
      continue;
    }

    const dest = destinationFor(ctx, unit);
    if (!dest) {
      unit.vel = { x: 0, y: 0 };
      continue;
    }

    const toDest = sub(dest, unit.pos);
    const distToDest = len(toDest);

    if (distToDest <= C.WAYPOINT_ARRIVAL_RADIUS) {
      unit.vel = { x: 0, y: 0 };
      if (unit.detached) unit.manualTarget = null;
      continue;
    }

    const speed = unitSpeed(unit);
    const desired = normalize(toDest);

    let sepX = 0;
    let sepY = 0;
    const neighbours = ctx.grid.near(unit.pos.x, unit.pos.y, C.SEPARATION_RADIUS);
    for (const other of neighbours) {
      if (other.id === unit.id) continue;
      const away = sub(unit.pos, other.pos);
      const d = len(away);
      if (d < 1e-6 || d >= C.SEPARATION_RADIUS) continue;
      const push = (1 - d / C.SEPARATION_RADIUS) * C.SEPARATION_FORCE;
      sepX += (away.x / d) * push;
      sepY += (away.y / d) * push;
    }

    const vx = desired.x * speed + sepX;
    const vy = desired.y * speed + sepY;
    const vLen = Math.sqrt(vx * vx + vy * vy);
    const scale = vLen > speed && vLen > 1e-6 ? speed / vLen : 1;

    unit.vel = { x: vx * scale, y: vy * scale };
    unit.pos = {
      x: unit.pos.x + unit.vel.x * C.TICK_S,
      y: unit.pos.y + unit.vel.y * C.TICK_S,
    };
    if (unit.state !== 'capturing') unit.state = 'moving';
  }
}
