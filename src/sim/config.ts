/**
 * Every number settled in the design doc lives here and nowhere else.
 *
 * Rule: no magic numbers in systems code. If a system needs a constant, it goes
 * in this file first. This is what makes balance changes a diff to one file and
 * what lets you run the sim headless in Node against a swept range of values.
 */

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

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

// ---------------------------------------------------------------------------
// Dropships (the player's only source of crews)
// ---------------------------------------------------------------------------

export const DROP_INTERVAL_BASE_TICKS = secs(40);
export const DROP_INTERVAL_MIN_TICKS = secs(14);
export const SQUADS_PER_DROP_MIN = 2;
export const SQUADS_PER_DROP_MAX = 3;

/** Ticks between a dropship appearing on approach and touching down. */
export const DROPSHIP_APPROACH_TICKS = secs(4);

// ---------------------------------------------------------------------------
// Squads
// ---------------------------------------------------------------------------

export const SQUAD_SIZE = 5;
export const MAX_VETERANCY = 3;

/** Ticks to top a thinned squad back up while standing on a friendly LZ. */
export const SQUAD_REINFORCE_TICKS = secs(6);

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Parked vehicles before a factory idles. Prevents a junkyard. */
export const PARKING_CAP = 3;

/** Per-chassis build time, in ticks. */
export const BUILD_TICKS: Record<string, number> = {
  scout: secs(10),
  tank: secs(18),
  jammer: secs(16),
  repair: secs(14),
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

/**
 * Target: a crewed tank should be worth roughly this many on-foot squads in
 * combat power, or nobody takes the bet. The single biggest balance dial.
 */
export const TANK_POWER_RATIO = 2.0;

/** Fraction of maxHp below which a vehicle reads as visibly damaged. */
export const DAMAGED_THRESHOLD = 0.4;

// ---------------------------------------------------------------------------
// Derelicts and borrowed hardware
// ---------------------------------------------------------------------------

export const REBOOT_TICKS = secs(8);

/** Ticks of continuous exposure inside enemy territory before reclaim fires. */
export const RECLAIM_TICKS = secs(5);

/** Ticks to wipe borrowed firmware, making a vehicle permanently yours. */
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

/** Flow field resolution, in world units per cell. */
export const FLOW_CELL_SIZE = 16;

// ---------------------------------------------------------------------------
// Design constraints, checked by instrumentation rather than enforced by code
// ---------------------------------------------------------------------------

/**
 * Action-floor test (Clash Royale risk 3). If a mission is winnable with fewer
 * player actions than this, the autopilot is doing too much and the player is
 * a spectator. Instrument, do not enforce.
 */
export const ACTION_FLOOR_PER_MISSION = 12;
