/**
 * Every number settled in the design doc lives here and nowhere else.
 *
 * Rule: no magic numbers in systems code. If a system needs a constant, it goes
 * in this file first. This is what makes balance changes a diff to one file and
 * what lets you run the sim headless in Node against a swept range of values.
 */

import type { Chassis } from './types';

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
export const TICK_S = 1 / TICK_HZ;

/** Convert design-doc seconds into tick counts. */
export const secs = (s: number): number => Math.round(s * TICK_HZ);

// ---------------------------------------------------------------------------
// Territory
// ---------------------------------------------------------------------------

export const CAPTURE_TICKS = secs(3);

/**
 * Capture rate is flat regardless of how many units stand on the point.
 * Scaling it would invite stacking.
 */
export const CAPTURE_RATE_SCALES_WITH_UNITS = false;

/** Capture progress freezes (rather than reverting) while both sides contest. */
export const CONTESTED_FREEZES_PROGRESS = true;

/** Above this share of map control, drop-cadence gains taper. Anti-snowball. */
export const DIMINISHING_RETURNS_THRESHOLD = 0.6;

/** Multiplier applied to territory gains beyond the threshold. */
export const DIMINISHING_RETURNS_FACTOR = 0.35;

/**
 * A factory is captured the same way a zone is: uncontested presence over
 * time. Placeholder balance numbers, like the movement/combat section below —
 * bigger prize than a zone, so both slower and wider until a playtest gives
 * real numbers.
 */
export const FACTORY_CAPTURE_TICKS = secs(6);
export const FACTORY_CAPTURE_RADIUS = 60;

// ---------------------------------------------------------------------------
// Dropships (the player's only source of crews)
// ---------------------------------------------------------------------------

export const DROP_INTERVAL_BASE_TICKS = secs(40);
export const DROP_INTERVAL_MIN_TICKS = secs(14);
export const SQUADS_PER_DROP_MIN = 2;
export const SQUADS_PER_DROP_MAX = 2;

/**
 * The opening's dead air before anything is on the board is its own problem,
 * separate from steady-state cadence — the first drop lands this long after
 * mission start regardless of DROP_INTERVAL_BASE_TICKS. Every drop after it
 * still follows the normal territory-scaled interval.
 */
export const DROP_FIRST_DELAY_TICKS = secs(5);

/** Ticks between a dropship appearing on approach and touching down. */
export const DROPSHIP_APPROACH_TICKS = secs(4);

// ---------------------------------------------------------------------------
// Squads
// ---------------------------------------------------------------------------

export const SQUAD_SIZE = 5;
/** Waiting on whatever promotes a Squad's veterancy field — no system does yet. */
export const MAX_VETERANCY = 3;

/** Ticks to top a thinned squad back up while standing on a friendly LZ. */
export const SQUAD_REINFORCE_TICKS = secs(6);

/** How close to a friendly LZ counts as "standing on it" for reinforcement. */
export const REINFORCE_RADIUS = 100;

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Parked vehicles before a factory idles. Prevents a junkyard. */
export const PARKING_CAP = 1;

/**
 * A parked (uncrewed) vehicle spawns this far above its factory's center
 * instead of exactly on top of it — spawning at the factory's own position
 * reads as the vehicle not existing, since it's fully hidden behind the
 * factory's render footprint.
 */
export const PARKING_OFFSET_Y = -34;

/**
 * Per-chassis build time, in ticks. Keyed by the full Chassis union (not
 * Record<string, ...>) on purpose: a chassis missing an entry here is a
 * compile error, not a silent runtime fallback to some other chassis's time.
 */
export const BUILD_TICKS: Record<Chassis, number> = {
  scout: secs(10),
  tank: secs(18),
  jammer: secs(16),
  repair: secs(14),
  // AI hardware is built on the same production line as the player's
  // (types.ts: "variants of human hardware"). Times climb with version
  // pressure so a v3 vehicle reads as a bigger commitment than a v1 one, not
  // just a reskin.
  aiScout: secs(10),
  aiTank: secs(18),
  boarder: secs(16),
  relay: secs(20),
  airgapped: secs(22),
  assembler: secs(30),
};

// ---------------------------------------------------------------------------
// Crewing
// ---------------------------------------------------------------------------

/**
 * A squad is consumed entirely on mounting, and dies with the vehicle.
 * These are assertions about the design, not switches — flipping them would
 * require reworking the systems that depend on them.
 */
export const SQUAD_CONSUMED_ON_MOUNT = true;
export const CREW_DIES_WITH_VEHICLE = true;

/** Ticks a squad spends boarding, exposed and unable to fire. */
export const MOUNT_TICKS = secs(1.5);

/** How close a foot squad must be to its factory to start mounting. */
export const MOUNT_RADIUS = 40;

/**
 * Target: a crewed tank should be worth roughly this many on-foot squads in
 * combat power, or nobody takes the bet. The single biggest balance dial.
 * Currently a design target only — nothing in unitStats.ts checks fielded
 * tanks against it yet.
 */
export const TANK_POWER_RATIO = 2.0;

/**
 * Fraction of maxHp below which a vehicle reads as visibly damaged. Waiting
 * on render.ts drawing that state — the render layer currently only fades
 * alpha continuously with hpFrac, nothing reads this threshold.
 */
export const DAMAGED_THRESHOLD = 0.4;

// ---------------------------------------------------------------------------
// Derelicts and borrowed hardware
// ---------------------------------------------------------------------------

export const REBOOT_TICKS = secs(8);

/**
 * Ticks of continuous exposure inside enemy territory before reclaim fires.
 * Waiting on stepReclaim (systems/reclaim.ts), stubbed for the vertical
 * slice — nothing sets Unit.reclaimExposure yet for this to act on.
 */
export const RECLAIM_TICKS = secs(5);

/**
 * Ticks to wipe borrowed firmware, making a vehicle permanently yours.
 * Waiting on the same stub as RECLAIM_TICKS above — see unitStats.ts's
 * unitDamage doc comment for where WIPED_VEHICLE_PENALTY gets wired in once
 * reboot/reclaim/firmware-wipe exist.
 */
export const FIRMWARE_WIPE_TICKS = secs(12);

/** Combat penalty applied to a wiped (owned) ex-enemy vehicle. */
export const WIPED_VEHICLE_PENALTY = 0.8;

// ---------------------------------------------------------------------------
// Jammer
// ---------------------------------------------------------------------------

/**
 * Shrink this before weakening the effects. A small radius makes placement a
 * real decision; a weak effect makes the unit pointless.
 */
export const JAMMER_RADIUS = 140;

/** How many versions the rollback aura knocks enemy behaviour back. */
export const JAMMER_ROLLBACK_STEPS = 2;

// ---------------------------------------------------------------------------
// AI version pressure
// ---------------------------------------------------------------------------

export const AI_UPGRADE_GRACE_TICKS = secs(240);
export const AI_UPGRADE_INTERVAL_TICKS = secs(180);

// ---------------------------------------------------------------------------
// Win / lose
// ---------------------------------------------------------------------------

/**
 * Zero-zone loss clock. Armed only after the first capture, ticks only while
 * zone count is zero, resets the instant anything is held.
 */
export const LOSS_CLOCK_TICKS = secs(120);
export const LOSS_CLOCK_WARN_AT = secs(72); // ~60% of the window

/** End-of-life shutdown ripples across the map rather than resolving instantly. */
export const END_OF_LIFE_RIPPLE_TICKS = secs(12);

// ---------------------------------------------------------------------------
// Spatial
// ---------------------------------------------------------------------------

/** Uniform grid cell size for proximity queries. Not a quadtree. */
export const SPATIAL_CELL_SIZE = 64;

/**
 * Flow field resolution, in world units per cell. Waiting on movement.ts
 * actually building a discretized flow field — the vertical slice's open,
 * terrain-free map (README) lets it get away with a polyline projection
 * instead, per movement.ts's file doc comment.
 */
export const FLOW_CELL_SIZE = 16;

// ---------------------------------------------------------------------------
// Movement — placeholder balance numbers, not yet settled in a design doc.
// Chosen so the vertical slice is playable; expect these to move once the
// capture-feel / mounted-vs-foot / drop-cadence questions get real answers.
// ---------------------------------------------------------------------------

export const FOOT_SPEED = 40; // world units/sec

export const CHASSIS_SPEED: Record<string, number> = {
  scout: 90,
  tank: 55,
  jammer: 60,
  repair: 60,
  aiScout: 90,
  aiTank: 55,
  boarder: 70,
  relay: 55,
  airgapped: 55,
  assembler: 40,
};

/** Distance at which a unit is considered to have arrived at its destination. */
export const WAYPOINT_ARRIVAL_RADIUS = 12;

/** How far apart units push to avoid stacking on top of each other. */
export const SEPARATION_RADIUS = 18;
export const SEPARATION_FORCE = 30;

/**
 * Playtest feedback knob: scales every unit's speed (unitSpeed reads
 * FOOT_SPEED/CHASSIS_SPEED through this), so tuning overall pace doesn't
 * mean hand-editing every entry in the speed tables above.
 */
export const GLOBAL_SPEED_MULTIPLIER = 0.8;

// ---------------------------------------------------------------------------
// Combat — same placeholder caveat as movement.
// ---------------------------------------------------------------------------

export const FOOT_HP_PER_BODY = 20;

export const CHASSIS_HP: Record<string, number> = {
  scout: 80,
  tank: 260,
  jammer: 90,
  repair: 100,
  aiScout: 80,
  aiTank: 260,
  boarder: 150,
  relay: 140,
  airgapped: 180,
  assembler: 400,
};

/** Per-body damage. A crewed tank should read as ~TANK_POWER_RATIO squads. */
export const FOOT_DAMAGE_PER_BODY: Record<'rifle' | 'antiArmour', number> = {
  rifle: 3,
  antiArmour: 6,
};

export const CHASSIS_DAMAGE: Record<string, number> = {
  scout: 8,
  tank: 30,
  jammer: 0,
  repair: 0,
  aiScout: 8,
  aiTank: 30,
  boarder: 14,
  relay: 10,
  airgapped: 12,
  assembler: 0,
};

/**
 * Playtest feedback knob: "the enemy feels strong." Applied to every
 * AI-owned unit's damage in unitDamage (chassis or foot squad, whichever
 * they're fielding), not baked into CHASSIS_DAMAGE, so it stays a single
 * adjustable dial rather than a hand-edit across every AI chassis entry.
 */
export const AI_DAMAGE_MULTIPLIER = 0.9;

export const FOOT_RANGE = 70;

export const CHASSIS_RANGE: Record<string, number> = {
  scout: 90,
  tank: 120,
  jammer: 0,
  repair: 0,
  aiScout: 90,
  aiTank: 120,
  boarder: 90,
  relay: 110,
  airgapped: 100,
  assembler: 0,
};

/** How far a unit will notice an enemy worth engaging while it moves. */
export const AGGRO_RANGE = 160;

export const ATTACK_COOLDOWN_TICKS = secs(1);

/**
 * Waiting on the repair chassis actually healing nearby allies — it exists in
 * types.ts/config.ts (CHASSIS_HP.repair etc.) but no system reads this yet.
 */
export const REPAIR_RATE_PER_TICK = 2;

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * There is only one map in the vertical slice. Real map selection can replace
 * this with a lookup once there's more than one Replay.mapId to choose from.
 */
export const MAP_ID = 'vertical-slice';

// ---------------------------------------------------------------------------
// Design constraints, checked by instrumentation rather than enforced by code
// ---------------------------------------------------------------------------

/**
 * Action-floor test (Clash Royale risk 3). If a mission is winnable with fewer
 * player actions than this, the autopilot is doing too much and the player is
 * a spectator. Instrument, do not enforce.
 */
export const ACTION_FLOOR_PER_MISSION = 12;
