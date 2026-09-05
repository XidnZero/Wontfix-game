/**
 * Capture — the tempo loop the vertical slice exists to test.
 *
 * Flat rate regardless of headcount (`CAPTURE_RATE_SCALES_WITH_UNITS` is
 * false, on purpose: scaling it would invite stacking). Progress freezes
 * rather than reverts while both sides contest a point. Runs after deaths, so
 * a squad wiped standing on a point stops capturing it the same tick it dies.
 */

import * as C from '../config';
import type { TickContext } from '../sim';
import type { Owner, Zone } from '../types';

function contenderAt(ctx: TickContext, zone: Zone): { contender: Owner | null; contested: boolean } {
  const nearby = ctx.grid.near(zone.center.x, zone.center.y, zone.radius);
  let hasPlayer = false;
  let hasAi = false;

  for (const id of nearby) {
    const unit = ctx.state.units.find((u) => u.id === id);
    if (!unit) continue;
    if (unit.owner === 'player') hasPlayer = true;
    else if (unit.owner === 'ai') hasAi = true;
  }

  if (hasPlayer && hasAi) return { contender: null, contested: true };
  if (hasPlayer) return { contender: 'player', contested: false };
  if (hasAi) return { contender: 'ai', contested: false };
  return { contender: null, contested: false };
}

export function stepCapture(ctx: TickContext): void {
  for (const zone of ctx.state.zones) {
    // Captured before `contested` is overwritten below: `zone.contender` is
    // nulled the instant a contest starts (two lines down), so it can't be
    // used as the edge detector — that combination used to fire ZoneContested
    // every tick of a contest instead of once at the start.
    const wasContested = zone.contested;
    const { contender, contested } = contenderAt(ctx, zone);
    zone.contested = contested;

    if (contested) {
      if (!wasContested) ctx.events.push({ type: 'ZoneContested', zoneId: zone.id });
      zone.contender = null;
      continue; // CONTESTED_FREEZES_PROGRESS — hold, don't revert.
    }

    if (contender === null || contender === zone.owner) {
      zone.contender = null;
      zone.captureProgress = 0;
      continue;
    }

    zone.contender = contender;
    zone.captureProgress += 1;

    if (zone.captureProgress >= C.CAPTURE_TICKS) {
      const from = zone.owner;
      zone.owner = contender;
      zone.contender = null;
      zone.captureProgress = 0;
      ctx.events.push({ type: 'ZoneCaptured', zoneId: zone.id, by: contender, from });

      // The zero-zone loss clock arms on the player's first capture ever —
      // the opening stays unpressured until then.
      if (contender === 'player' && !ctx.state.player.lossClockArmed) {
        ctx.state.player.lossClockArmed = true;
        ctx.events.push({ type: 'LossClockArmed' });
      }

      if (zone.lzId !== null) {
        const lz = ctx.state.landingZones.find((l) => l.id === zone.lzId);
        if (lz && !lz.active) {
          lz.active = true;
          lz.owner = contender;
          ctx.events.push({ type: 'ForwardLzOpened', lzId: lz.id });
        }
      }
    }
  }
}
