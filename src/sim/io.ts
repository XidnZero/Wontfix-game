/**
 * The sim's entire input and output surface.
 *
 * Commands in, events out. Nothing else crosses the boundary. The renderer
 * reads state directly (read-only) but never writes to it, and never calls a
 * system function.
 */

import type {
  FactoryId,
  LaneId,
  LzId,
  Owner,
  PlayerChassis,
  SquadId,
  UnitId,
  Vec2,
  ZoneId,
  AiVersion,
} from './types';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Note what is absent: mouse coordinates, screen space, selection.
 *
 * Selection is UI state and lives in the UI layer. The sim only hears about
 * units once something is actually done to them. That separation is what makes
 * gamepad support a new input source later rather than a rewrite.
 */
export type Command =
  /** Tier 1 — lanes. Free to redraw at any time; propagation lag is in the sim. */
  | {
      type: 'CreateLane';
      sourceLzId: LzId | null;
      sourceFactoryId: FactoryId | null;
      path: Vec2[];
      mounted: boolean;
    }
  | { type: 'RedrawLane'; laneId: LaneId; path: Vec2[] }
  | { type: 'SetLaneMounted'; laneId: LaneId; mounted: boolean }
  | { type: 'DeleteLane'; laneId: LaneId }

  /** Tier 2 — squad grabs. Detach, reposition, release. */
  | { type: 'GrabUnits'; unitIds: UnitId[] }
  | { type: 'IssueMove'; unitIds: UnitId[]; dest: Vec2 }
  | { type: 'ReleaseUnits'; unitIds: UnitId[] }

  /** Factory composition. Set once, changed rarely. */
  | { type: 'SetFactoryProduction'; factoryId: FactoryId; chassis: PlayerChassis };

/**
 * There is no tier 3. If a command for individual unit control, formations, or
 * stances is ever added here, the autopilot is not good enough yet — fix that
 * instead. See design pillar 3.
 */

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type SimEvent =
  | { type: 'ZoneCaptured'; zoneId: ZoneId; by: Owner; from: Owner }
  | { type: 'ZoneContested'; zoneId: ZoneId }
  | { type: 'ForwardLzOpened'; lzId: LzId }

  | { type: 'VehicleProduced'; factoryId: FactoryId; unitId: UnitId }
  | { type: 'FactoryIdle'; factoryId: FactoryId } // parking cap reached
  | { type: 'FactoryCaptured'; factoryId: FactoryId; by: Owner }

  | { type: 'DropshipInbound'; lzId: LzId; etaTicks: number }
  | { type: 'DropshipLanded'; lzId: LzId; squadIds: SquadId[] }
  | { type: 'DropCadenceChanged'; intervalTicks: number }

  | { type: 'SquadMounted'; squadId: SquadId; unitId: UnitId }
  /** Fires whenever a crewed vehicle dies. The squad is gone with it. */
  | { type: 'CrewLost'; squadId: SquadId; unitId: UnitId }
  | { type: 'UnitDestroyed'; unitId: UnitId; owner: Owner }

  | { type: 'VehicleReclaimed'; unitId: UnitId; by: Owner }
  | { type: 'FirmwareWiped'; unitId: UnitId }
  | { type: 'DerelictRebooted'; unitId: UnitId }

  | { type: 'AiVersionUpgraded'; version: AiVersion }
  | { type: 'JammerRollbackApplied'; unitIds: UnitId[]; to: AiVersion }

  | { type: 'LossClockArmed' }
  | { type: 'LossClockStarted' }
  | { type: 'LossClockWarning'; ticksRemaining: number }
  | { type: 'LossClockCleared' }

  | { type: 'EndOfLifeIssued' }
  | { type: 'MissionWon' }
  | { type: 'MissionLost' }

  /**
   * Named achievement events, fired from the sim even though the web build has
   * no achievements. Steam wants stable string IDs, and you only learn which
   * ones matter by playing.
   */
  | { type: 'Achievement'; id: string };

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * A deterministic sim plus a seed plus this log fully reconstructs a mission.
 * That is the save/resume system and the clip-sharing feature, for free.
 */
export interface CommandLogEntry {
  tick: number;
  command: Command;
}

export interface Replay {
  seed: number;
  mapId: string;
  log: CommandLogEntry[];
}
