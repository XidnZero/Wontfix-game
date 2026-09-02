/**
 * The tick pipeline.
 *
 * The ordering below is the load-bearing part of this file. Systems are not
 * independent: auras must resolve before targeting so a rolled-back unit
 * behaves correctly this tick rather than next; deaths must resolve before
 * capture so a squad wiped on a point stops capturing it; territory must
 * resolve before win/lose so the loss clock sees the current zone count.
 *
 * Reordering these is a gameplay change, not a refactor.
 */

import * as C from './config';
import type { Command, SimEvent } from './io';
import type { MissionState, Unit, UnitId } from './types';
import { AiVersion } from './types';

import { applyCommands } from './systems/commands';
import { stepAiUpgradeClock } from './systems/aiUpgradeClock';
import { stepAiPlanning } from './systems/aiPlanning';
import { stepFactories } from './systems/factories';
import { stepDropships } from './systems/dropships';
import { stepLaneAdoption } from './systems/laneAdoption';
import { stepMovement } from './systems/movement';
import { stepMounting } from './systems/mounting';
import { stepReboot } from './systems/reboot';
import { stepAuras } from './systems/auras';
import { stepReclaim } from './systems/reclaim';
import { stepTargeting } from './systems/targeting';
import { stepCombat } from './systems/combat';
import { stepDeaths } from './systems/deaths';
import { stepCapture } from './systems/capture';
import { stepTerritoryTempo } from './systems/territoryTempo';
import { stepWinLose } from './systems/winLose';
import { stepEndOfLifeRipple } from './systems/endOfLife';
import { createSpatialGrid } from './systems/spatial';

// ---------------------------------------------------------------------------
// Tick context — the scratch space a single tick shares between systems
// ---------------------------------------------------------------------------

export interface TickContext {
  state: MissionState;
  events: SimEvent[];
  /** Rebuilt each tick. Uniform grid, not a quadtree. See spatial.ts. */
  grid: SpatialGrid;
}

export interface SpatialGrid {
  /** Bucket every unit into fixed cells, then query the 9 neighbouring cells. */
  rebuild(units: Unit[]): void;
  near(x: number, y: number, radius: number): UnitId[];
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export function tick(state: MissionState, commands: Command[]): SimEvent[] {
  const ctx: TickContext = { state, events: [], grid: createSpatialGrid() };

  // 0. Player intent. Applied before anything else so a redraw issued this
  //    frame is visible to every system below it.
  applyCommands(ctx, commands);

  // 1. Spatial index. Everything downstream queries this, so it must reflect
  //    last tick's final positions.
  ctx.grid.rebuild(state.units);

  if (state.phase === 'playing') {
    // 2. Pressure. Ships a version upgrade every AI_UPGRADE_INTERVAL_TICKS
    //    after the grace period. Never causes a loss directly.
    stepAiUpgradeClock(ctx);

    // 3. AI planning. Redraws enemy lanes according to the current version.
    //    v1 walks straight; v2.5 splits and flanks; v3 applies the counter.
    stepAiPlanning(ctx);

    // 4. Production. Factories build continuously, then idle at PARKING_CAP.
    stepFactories(ctx);

    // 5. Crews. Territory-scaled cadence, diminishing past the threshold.
    stepDropships(ctx);

    // 6. Lane adoption. A unit picks up its lane's new revision only when it
    //    is not mid-engagement. This is the propagation lag, deliberately.
    stepLaneAdoption(ctx);

    // 7. Movement. Flow fields, one per lane destination — not per-unit A*.
    stepMovement(ctx);

    // 8. Auto-crew. Mounted lanes only. No allocation logic: first past the
    //    factory takes what is parked, the rest walk on.
    stepMounting(ctx);

    // 9. Derelicts. REBOOT_TICKS of exposure to bring one online.
    stepReboot(ctx);

    // 10. Auras. Recomputes every unit's effectiveVersion and reclaim
    //     eligibility from jammer coverage. Must precede targeting so the
    //     rollback takes effect on this tick's decisions.
    stepAuras(ctx);

    // 11. Reclaim. Borrowed hardware sitting in enemy territory without jammer
    //     cover reverts to its firmware owner.
    stepReclaim(ctx);

    // 12–13. Combat.
    stepTargeting(ctx);
    stepCombat(ctx);

    // 14. Deaths. CREW_DIES_WITH_VEHICLE resolves here — a destroyed crewed
    //     vehicle emits both UnitDestroyed and CrewLost.
    stepDeaths(ctx);

    // 15. Capture. CAPTURE_TICKS, flat rate, frozen while contested.
    stepCapture(ctx);

    // 16. Tempo. zonesHeld -> dropIntervalTicks, with diminishing returns.
    stepTerritoryTempo(ctx);

    // 17. Resolution. Win on all factories; lose on the zero-zone clock.
    stepWinLose(ctx);
  } else if (state.phase === 'endOfLife') {
    // The shutdown ripples over END_OF_LIFE_RIPPLE_TICKS rather than resolving
    // instantly. Watching an army go inert is the payoff, so let it play.
    stepEndOfLifeRipple(ctx);
  }

  state.tick++;
  return ctx.events;
}

// ---------------------------------------------------------------------------
// Two rules worth writing down as code, because they are easy to get wrong
// ---------------------------------------------------------------------------
// Two rules worth writing down as code, because they are easy to get wrong
// ---------------------------------------------------------------------------

/**
 * Drop cadence from territory, with anti-snowball taper.
 *
 * Below the threshold, gains are linear and the player feels every capture.
 * Above it, gains are scaled down so a runaway lead stops compounding. One
 * multiplier, no new systems, nothing to explain in UI.
 */
export function dropIntervalFor(zonesHeld: number, zonesTotal: number): number {
  const share = zonesTotal === 0 ? 0 : zonesHeld / zonesTotal;
  const linear = Math.min(share, C.DIMINISHING_RETURNS_THRESHOLD);
  const excess = Math.max(0, share - C.DIMINISHING_RETURNS_THRESHOLD);
  const effective = linear + excess * C.DIMINISHING_RETURNS_FACTOR;

  const span = C.DROP_INTERVAL_BASE_TICKS - C.DROP_INTERVAL_MIN_TICKS;
  return Math.round(C.DROP_INTERVAL_BASE_TICKS - span * effective);
}

/**
 * Jammer rollback. Arithmetic on the version ordinal, clamped at V1.
 *
 * Its value grows across the campaign: at Final, knocking a pocket of the enemy
 * army back to V2 is enormous; at V1 it does nothing at all. That is intended.
 */
export function rolledBackVersion(current: AiVersion, jammed: boolean): AiVersion {
  if (!jammed) return current;
  return Math.max(AiVersion.V1, current - C.JAMMER_ROLLBACK_STEPS) as AiVersion;
}

/**
 * Zero-zone loss clock.
 *
 * Armed only after the first capture, so the opening is unpressured. Ticks only
 * while zone count is zero, and resets the instant anything is held. Because a
 * player mopping up cannot be at zero zones, this can never fire on someone who
 * is winning — no suspension logic needed.
 */
export function stepLossClock(
  side: MissionState['player'],
  events: SimEvent[],
): void {
  if (!side.lossClockArmed) return;

  if (side.zonesHeld > 0) {
    if (side.lossClockTicks > 0) events.push({ type: 'LossClockCleared' });
    side.lossClockTicks = 0;
    side.lossClockWarned = false;
    return;
  }

  if (side.lossClockTicks === 0) events.push({ type: 'LossClockStarted' });
  side.lossClockTicks++;

  if (!side.lossClockWarned && side.lossClockTicks >= C.LOSS_CLOCK_WARN_AT) {
    side.lossClockWarned = true;
    events.push({
      type: 'LossClockWarning',
      ticksRemaining: C.LOSS_CLOCK_TICKS - side.lossClockTicks,
    });
  }
}

// ---------------------------------------------------------------------------
// Facade
// ---------------------------------------------------------------------------

/**
 * Wraps the pure tick function with the command queue and replay log.
 * Deliberately thin: all the logic is in `tick`, which is testable in Node
 * without constructing one of these.
 */
export class Simulation {
  private queued: Command[] = [];
  readonly log: Array<{ tick: number; command: Command }> = [];

  constructor(public state: MissionState) {}

  /** Queued, not applied. Applied at the top of the next tick. */
  issue(command: Command): void {
    this.queued.push(command);
    this.log.push({ tick: this.state.tick, command });
    this.state.playerActionCount++;
  }

  advance(): SimEvent[] {
    const cmds = this.queued;
    this.queued = [];
    return tick(this.state, cmds);
  }

  snapshot(): string {
    return JSON.stringify(this.state);
  }

  static restore(json: string): Simulation {
    return new Simulation(JSON.parse(json) as MissionState);
  }
}
