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
import type { Owner, Vec2 } from '../types';

function contenderNear(ctx: TickContext, center: Vec2, radius: number): { contender: Owner | null; contested: boolean } {
  const nearby = ctx.grid.near(center.x, center.y, radius);
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

function stepZoneCapture(ctx: TickContext): void {
  for (const zone of ctx.state.zones) {
    // Captured before `contested` is overwritten below: `zone.contender` is
    // nulled the instant a contest starts (two lines down), so it can't be
    // used as the edge detector — that combination used to fire ZoneContested
    // every tick of a contest instead of once at the start.
    const wasContested = zone.contested;
    const { contender, contested } = contenderNear(ctx, zone.center, zone.radius);
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

/**
 * Factories flip the same way zones do: uncontested presence over
 * FACTORY_CAPTURE_TICKS. This is what makes the mission winnable at all — see
 * winLose.ts, which has always required every factory to be player-owned but
 * had nothing that could ever change Factory.owner.
 */
function stepFactoryCapture(ctx: TickContext): void {
  for (const factory of ctx.state.factories) {
    const { contender, contested } = contenderNear(ctx, factory.pos, C.FACTORY_CAPTURE_RADIUS);

    if (contested) {
      factory.contender = null;
      continue; // Same freeze-while-contested rule as zones.
    }

    if (contender === null || contender === factory.owner) {
      factory.contender = null;
      factory.captureProgress = 0;
      continue;
    }

    factory.contender = contender;
    factory.captureProgress += 1;

    if (factory.captureProgress >= C.FACTORY_CAPTURE_TICKS) {
      factory.owner = contender;
      factory.contender = null;
      factory.captureProgress = 0;
      // The previous owner's uncrewed vehicles must not become the captor's
      // to mount — the units themselves are left alone as derelicts (see
      // reboot.ts), only the parking claim on them is dropped.
      factory.parked = [];
      ctx.events.push({ type: 'FactoryCaptured', factoryId: factory.id, by: contender });
    }
  }
}

export function stepCapture(ctx: TickContext): void {
  stepZoneCapture(ctx);
  stepFactoryCapture(ctx);
}
