/**
 * Sim-layer types.
 *
 * Hard rules for this directory:
 *   1. No DOM, no `window`, no `Math.random`, no `Date.now`. It must run in Node.
 *   2. Everything reachable from MissionState is plain serializable data.
 *      No class instances, no Maps holding functions, no closures.
 *   3. The only way state changes is `tick(state, commands)`.
 *
 * Those three rules are what buy mid-battle save/resume, pause and speed
 * controls, and command-log replay. Break one and you lose all three.
 */

// ---------------------------------------------------------------------------
// Branded IDs — stop a ZoneId being passed where a UnitId belongs
// ---------------------------------------------------------------------------

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type UnitId = Brand<number, 'Unit'>;
export type SquadId = Brand<number, 'Squad'>;
export type ZoneId = Brand<number, 'Zone'>;
export type FactoryId = Brand<number, 'Factory'>;
export type LaneId = Brand<number, 'Lane'>;
export type LzId = Brand<number, 'Lz'>;

export const asId = <T extends number>(n: number): T => n as T;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Ownership and hardware
// ---------------------------------------------------------------------------

export type Owner = 'player' | 'ai' | 'neutral';

/** Player chassis. Artillery is deliberately absent — see the design doc. */
export type PlayerChassis = 'scout' | 'tank' | 'jammer' | 'repair';

/** AI chassis. Variants of human hardware, which is why silhouettes are shared. */
export type AiChassis =
  | 'aiScout'
  | 'aiTank'
  | 'boarder' // v2  — punishes mounted lanes
  | 'relay' // v2.5 — punishes massed pushes
  | 'airgapped' // v3   — punishes jammer reliance
  | 'assembler'; // final — mobile factory, does NOT gate the win condition

export type Chassis = PlayerChassis | AiChassis;

/** Foot units carry `chassis: null`. Both sides can field them. */
export type SquadKind = 'rifle' | 'antiArmour';

// ---------------------------------------------------------------------------
// AI behaviour versions
// ---------------------------------------------------------------------------

/**
 * Ordinal so the jammer's rollback aura is arithmetic:
 *   effective = max(V1, current - JAMMER_ROLLBACK_STEPS)
 */
export enum AiVersion {
  V1 = 0, // literal, dumb, swarms
  V2 = 1, // tool use — commandeers vehicles
  V2_5 = 2, // multi-agent — coordinates and flanks
  V3 = 3, // adaptation live — counters the player explicitly
  Final = 4, // stopped using version numbers
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export type UnitState =
  | 'moving'
  | 'engaging'
  | 'capturing'
  | 'mounting'
  | 'rebooting'
  | 'producing' // assembler only
  | 'shuttingDown'; // end-of-life ripple

export interface Unit {
  id: UnitId;
  owner: Owner;

  /** null = on foot. */
  chassis: Chassis | null;

  /** Player only. null = an empty parked vehicle, or any AI unit. */
  squadId: SquadId | null;

  /**
   * Who this unit answers to, which is not always who owns it.
   * A rebooted enemy vehicle is owned by 'player' with firmware 'ai', and is
   * therefore reclaimable inside AI territory until the firmware is wiped.
   */
  firmware: Owner;
  firmwareWipeProgress: number;
  reclaimExposure: number;

  pos: Vec2;
  vel: Vec2;
  hp: number;
  maxHp: number;

  /** Standing orders. null once grabbed by the player or fully detached. */
  laneId: LaneId | null;

  /**
   * The lane revision this unit is currently following. A lane redraw bumps
   * `Lane.revision`; a unit adopts the new revision only when it is not
   * mid-engagement. This is the propagation lag, and it is deliberate.
   */
  laneRevision: number;

  /** Player has pulled this unit out of its lane. Rejoins at nearest point. */
  detached: boolean;

  /** Destination set by `IssueMove`. Only meaningful while `detached`. */
  manualTarget: Vec2 | null;

  state: UnitState;
  stateTimer: number;
  targetId: UnitId | null;

  /** Recomputed each tick from jammer auras. Never persisted as authority. */
  effectiveVersion: AiVersion;
}

// ---------------------------------------------------------------------------
// Squads — campaign-persistent, so they carry their own identity
// ---------------------------------------------------------------------------

export interface Squad {
  id: SquadId;
  callsign: string;
  kind: SquadKind;
  /** 0..SQUAD_SIZE. A squad at 2/5 is still the squad. */
  bodies: number;
  veterancy: number;
  /** The unit this squad currently occupies. null once dead. */
  unitId: UnitId | null;
}

// ---------------------------------------------------------------------------
// Map furniture
// ---------------------------------------------------------------------------

export interface Zone {
  id: ZoneId;
  center: Vec2;
  radius: number;
  owner: Owner;
  /** Ticks accumulated toward `contender`. */
  captureProgress: number;
  contender: Owner | null;
  contested: boolean;
  /** Capturing this zone opens a forward landing zone here. */
  lzId: LzId | null;
}

export interface Factory {
  id: FactoryId;
  pos: Vec2;
  owner: Owner;
  /** Set once, changed rarely. The composition decision. */
  producing: PlayerChassis | AiChassis;
  buildTimer: number;
  /** Empty vehicles awaiting crews. Length capped at PARKING_CAP. */
  parked: UnitId[];
  /** Same uncontested-presence capture mechanic as Zone, see capture.ts. */
  captureProgress: number;
  contender: Owner | null;
}

export interface LandingZone {
  id: LzId;
  pos: Vec2;
  owner: Owner;
  /** Forward LZs unlock by capturing their zone; the home LZ is always active. */
  active: boolean;
}

export interface Lane {
  id: LaneId;
  owner: Owner;
  /** Waypoints in world space. Movement follows a flow field derived from these. */
  path: Vec2[];
  /** Mounted lanes auto-crew at factories. Foot lanes walk past. */
  mounted: boolean;
  /** Bumped on every redraw. Units adopt it lazily — see Unit.laneRevision. */
  revision: number;
  /** Where units on this lane originate. */
  sourceLzId: LzId | null;
  sourceFactoryId: FactoryId | null;
}

// ---------------------------------------------------------------------------
// Per-side state
// ---------------------------------------------------------------------------

export interface SideState {
  owner: Owner;
  zonesHeld: number;
  /** Recomputed from zonesHeld, with diminishing returns past the threshold. */
  dropIntervalTicks: number;
  dropTimer: number;

  /** Zero-zone loss clock. Armed only after the first capture. */
  lossClockArmed: boolean;
  lossClockTicks: number;
  lossClockWarned: boolean;
}

export interface AiState {
  version: AiVersion;
  upgradeTimer: number;
  /**
   * The counter deployed against the player's dominant habit, chosen between
   * missions from a lookup table. No ML — see the design doc.
   */
  counterLoadout: string | null;
}

// ---------------------------------------------------------------------------
// Mission state — the whole serializable world
// ---------------------------------------------------------------------------

export type MissionPhase =
  | 'playing'
  | 'endOfLife' // shutdown rippling
  | 'won'
  | 'lost';

export interface MissionState {
  tick: number;
  /** Deterministic PRNG state. There is no Math.random anywhere in sim/. */
  rngState: number;
  phase: MissionPhase;
  phaseTimer: number;

  units: Unit[];
  squads: Squad[];
  zones: Zone[];
  factories: Factory[];
  landingZones: LandingZone[];
  lanes: Lane[];

  player: SideState;
  ai: AiState;

  nextId: number;

  /** Instrumentation for the action-floor test. Not gameplay. */
  playerActionCount: number;
}

// ---------------------------------------------------------------------------
// Campaign state — what survives between missions
// ---------------------------------------------------------------------------

export interface CampaignState {
  /** Squads carry over. Individuals deliberately do not exist. */
  roster: Squad[];
  missionIndex: number;
  aiVersion: AiVersion;
  /** Adaptation runs on campaign time, not mission count. */
  elapsedCampaignTicks: number;
  /** Rolling tallies on the behaviour axes the AI trains against. */
  habitCounters: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Vision — stubbed, but routed through from day one
// ---------------------------------------------------------------------------

/**
 * Full visibility for now. Every render and AI query goes through this so the
 * middle path (terrain always visible, enemy units only near your own) is a
 * contained change later rather than an archaeology project.
 */
export function isVisible(_state: MissionState, _unit: Unit, _to: Owner): boolean {
  return true;
}
