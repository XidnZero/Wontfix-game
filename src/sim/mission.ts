/**
 * Vertical-slice map: one rectangle, two factories, three zones in a row.
 * See the README — this is the setup the "does a 3-second capture feel
 * right / is the mounted-vs-foot bet worth taking / does drop cadence read
 * as tempo" questions get tested against.
 *
 * The player's one starting lane deliberately routes LZ -> factory -> front:
 * a dropped squad walks past the factory and auto-crews there if a vehicle
 * is parked (stepMounting), or keeps walking on foot if not. That is the
 * mounted-vs-foot bet playing out from the default lane, not a special case.
 */

import * as C from './config';
import { asId, AiVersion } from './types';
import type {
  AiState,
  Factory,
  FactoryId,
  Lane,
  LaneId,
  LandingZone,
  LzId,
  MissionState,
  SideState,
  Zone,
  ZoneId,
} from './types';

export function createVerticalSliceMission(seed: number): MissionState {
  let nextId = 0;
  const alloc = <T extends number>(): T => asId<T>(nextId++);

  const playerFactoryId = alloc<FactoryId>();
  const aiFactoryId = alloc<FactoryId>();
  const playerLzId = alloc<LzId>();
  const aiLzId = alloc<LzId>();
  const zoneWestId = alloc<ZoneId>();
  const zoneCenterId = alloc<ZoneId>();
  const zoneEastId = alloc<ZoneId>();
  const playerLaneId = alloc<LaneId>();
  const aiLaneId = alloc<LaneId>();

  const factories: Factory[] = [
    { id: playerFactoryId, pos: { x: 120, y: 300 }, owner: 'player', producing: 'tank', buildTimer: 0, parked: [], captureProgress: 0, contender: null },
    { id: aiFactoryId, pos: { x: 880, y: 300 }, owner: 'ai', producing: 'aiTank', buildTimer: 0, parked: [], captureProgress: 0, contender: null },
  ];

  const landingZones: LandingZone[] = [
    { id: playerLzId, pos: { x: 60, y: 300 }, owner: 'player', active: true },
    { id: aiLzId, pos: { x: 940, y: 300 }, owner: 'ai', active: true },
  ];

  const zones: Zone[] = [
    { id: zoneWestId, center: { x: 320, y: 300 }, radius: 45, owner: 'neutral', captureProgress: 0, contender: null, contested: false, lzId: null },
    { id: zoneCenterId, center: { x: 500, y: 300 }, radius: 53, owner: 'neutral', captureProgress: 0, contender: null, contested: false, lzId: null },
    { id: zoneEastId, center: { x: 680, y: 300 }, radius: 45, owner: 'neutral', captureProgress: 0, contender: null, contested: false, lzId: null },
  ];

  const lanes: Lane[] = [
    {
      id: playerLaneId,
      owner: 'player',
      path: [{ x: 60, y: 300 }, { x: 120, y: 300 }, { x: 320, y: 300 }, { x: 500, y: 300 }],
      mounted: true,
      revision: 0,
      sourceLzId: playerLzId,
      sourceFactoryId: playerFactoryId,
    },
    {
      id: aiLaneId,
      owner: 'ai',
      path: [{ x: 880, y: 300 }, { x: 680, y: 300 }, { x: 500, y: 300 }],
      mounted: false,
      revision: 0,
      sourceLzId: null,
      sourceFactoryId: aiFactoryId,
    },
  ];

  const player: SideState = {
    owner: 'player',
    zonesHeld: 0,
    dropIntervalTicks: C.DROP_INTERVAL_BASE_TICKS,
    // Pre-loaded so the first drop lands DROP_FIRST_DELAY_TICKS after mission
    // start rather than waiting out a full DROP_INTERVAL_BASE_TICKS with
    // nothing on the board — see the constant's doc comment.
    dropTimer: Math.max(0, C.DROP_INTERVAL_BASE_TICKS - C.DROP_FIRST_DELAY_TICKS),
    lossClockArmed: false,
    lossClockTicks: 0,
    lossClockWarned: false,
  };

  const ai: AiState = { version: AiVersion.V1, upgradeTimer: 0, counterLoadout: null };

  return {
    tick: 0,
    rngState: seed,
    phase: 'playing',
    phaseTimer: 0,
    units: [],
    squads: [],
    zones,
    factories,
    landingZones,
    lanes,
    player,
    ai,
    nextId,
    playerActionCount: 0,
  };
}
