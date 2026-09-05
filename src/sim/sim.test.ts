import { describe, it, expect } from 'vitest';

import { createVerticalSliceMission } from './mission';
import { Simulation, dropIntervalFor, rolledBackVersion } from './sim';
import { runHeadless } from '../app/clock';
import { asId, AiVersion } from './types';
import type { LaneId, Squad, SquadId, Unit, UnitId } from './types';
import { unitDamage, unitSpeed } from './systems/unitStats';
import * as C from './config';

describe('vertical slice mission', () => {
  it('ticks without crashing and both sides produce units', () => {
    const sim = new Simulation(createVerticalSliceMission(12345));
    const eventLog: string[] = [];

    runHeadless(sim, C.secs(60), (events) => {
      for (const e of events) eventLog.push(e.type);
    });

    expect(sim.state.tick).toBeGreaterThan(0);
    expect(sim.state.units.length).toBeGreaterThan(0);
    expect(eventLog).toContain('VehicleProduced');
  });

  it('is deterministic: same seed, same command log, same end state', () => {
    const run = () => {
      const sim = new Simulation(createVerticalSliceMission(999));
      runHeadless(sim, C.secs(90));
      return sim.snapshot();
    };

    expect(run()).toEqual(run());
  });

  it('resolves to a loss via the zero-zone clock', () => {
    const state = createVerticalSliceMission(1);
    state.player.lossClockArmed = true;
    state.player.lossClockTicks = C.LOSS_CLOCK_TICKS - 1;
    const sim = new Simulation(state);

    runHeadless(sim, 5);

    expect(sim.state.phase).toBe('lost');
  });
});

describe('squad reinforcement', () => {
  function addThinnedSquad(pos: { x: number; y: number }): { state: ReturnType<typeof createVerticalSliceMission>; unitId: UnitId } {
    const state = createVerticalSliceMission(7);
    const squadId = asId<SquadId>(state.nextId++);
    const unitId = asId<UnitId>(state.nextId++);
    const maxHp = C.SQUAD_SIZE * C.FOOT_HP_PER_BODY;

    const squad: Squad = { id: squadId, callsign: 'Test', kind: 'rifle', bodies: 2, veterancy: 0, unitId };
    const unit: Unit = {
      id: unitId,
      owner: 'player',
      chassis: null,
      squadId,
      firmware: 'player',
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos,
      vel: { x: 0, y: 0 },
      hp: maxHp * 0.4,
      maxHp,
      laneId: null,
      laneRevision: 0,
      detached: true,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      attackCooldown: 0,
      targetId: null,
      effectiveVersion: AiVersion.V1,
    };

    state.squads.push(squad);
    state.units.push(unit);
    return { state, unitId };
  }

  it('heals and re-thickens a thinned squad standing on its home LZ', () => {
    const { state, unitId } = addThinnedSquad({ x: 60, y: 300 }); // player home LZ
    const sim = new Simulation(state);

    sim.advance();

    const unit = sim.state.units.find((u) => u.id === unitId)!;
    const squad = sim.state.squads.find((s) => s.unitId === unitId)!;
    expect(unit.hp).toBeGreaterThan(unit.maxHp * 0.4);
    expect(squad.bodies).toBeGreaterThanOrEqual(2);
  });

  it('does not heal a thinned squad away from any friendly LZ', () => {
    const { state, unitId } = addThinnedSquad({ x: 500, y: 300 }); // center zone, far from either LZ
    const sim = new Simulation(state);

    sim.advance();

    const unit = sim.state.units.find((u) => u.id === unitId)!;
    expect(unit.hp).toBeCloseTo(unit.maxHp * 0.4, 5);
  });

  it('thins bodies down as a squad takes damage', () => {
    const { state, unitId } = addThinnedSquad({ x: 500, y: 300 });
    const unit = state.units.find((u) => u.id === unitId)!;
    unit.hp = unit.maxHp * 0.1; // nearly dead, should read as a single body

    const sim = new Simulation(state);
    sim.advance();

    const squad = sim.state.squads.find((s) => s.unitId === unitId)!;
    expect(squad.bodies).toBe(1);
  });
});

describe('mounting', () => {
  function makeFootSquad(state: ReturnType<typeof createVerticalSliceMission>, pos: { x: number; y: number }) {
    const squadId = asId<SquadId>(state.nextId++);
    const unitId = asId<UnitId>(state.nextId++);
    const maxHp = C.SQUAD_SIZE * C.FOOT_HP_PER_BODY;
    const lane = state.lanes.find((l) => l.owner === 'player')!;

    state.squads.push({ id: squadId, callsign: 'T', kind: 'rifle', bodies: C.SQUAD_SIZE, veterancy: 0, unitId });
    state.units.push({
      id: unitId,
      owner: 'player',
      chassis: null,
      squadId,
      firmware: 'player',
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos,
      vel: { x: 0, y: 0 },
      hp: maxHp,
      maxHp,
      laneId: lane.id,
      laneRevision: lane.revision,
      detached: false,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      attackCooldown: 0,
      targetId: null,
      effectiveVersion: AiVersion.V1,
    });
    return { squadId, unitId };
  }

  it('only lets one of two simultaneously-arriving squads claim a single parked vehicle', () => {
    const state = createVerticalSliceMission(3);
    const factory = state.factories.find((f) => f.owner === 'player')!;

    const vehicleId = asId<UnitId>(state.nextId++);
    const maxHp = C.CHASSIS_HP.tank;
    state.units.push({
      id: vehicleId,
      owner: 'player',
      chassis: 'tank',
      squadId: null,
      firmware: 'player',
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { ...factory.pos },
      vel: { x: 0, y: 0 },
      hp: maxHp,
      maxHp,
      laneId: null,
      laneRevision: 0,
      detached: false,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      attackCooldown: 0,
      targetId: null,
      effectiveVersion: AiVersion.V1,
    });
    factory.parked.push(vehicleId);

    // Two squads, both already within MOUNT_RADIUS of the factory on the
    // same tick — the exact scenario that let both claim the one vehicle.
    const s1 = makeFootSquad(state, { x: factory.pos.x - 5, y: factory.pos.y });
    const s2 = makeFootSquad(state, { x: factory.pos.x + 5, y: factory.pos.y });

    const sim = new Simulation(state);
    sim.advance();

    const mountingCount = [s1, s2].filter(
      (s) => sim.state.units.find((u) => u.id === s.unitId)?.state === 'mounting',
    ).length;
    expect(mountingCount).toBe(1); // not both — that was the bug

    for (let i = 0; i <= C.MOUNT_TICKS + 1; i++) sim.advance();

    const survivedAsFoot = [s1, s2].filter((s) => sim.state.units.some((u) => u.id === s.unitId)).length;
    expect(survivedAsFoot).toBe(1); // the loser goes back to walking, not vanished

    const crewedVehicle = sim.state.units.find((u) => u.id === vehicleId)!;
    expect(crewedVehicle.squadId).not.toBeNull();

    const otherSquadId = crewedVehicle.squadId === s1.squadId ? s2.squadId : s1.squadId;
    const otherSquad = sim.state.squads.find((s) => s.id === otherSquadId);
    expect(otherSquad).toBeDefined();
    expect(otherSquad!.unitId).not.toBe(vehicleId);
  });

  it('only lets one squad claim a vehicle across two mounted lanes sharing a factory', () => {
    const state = createVerticalSliceMission(3);
    const factory = state.factories.find((f) => f.owner === 'player')!;

    // A second mounted lane out of the same factory — the cross-lane case
    // the per-lane unclaimedSlots tally couldn't see.
    const laneBId = asId<LaneId>(state.nextId++);
    state.lanes.push({
      id: laneBId,
      owner: 'player',
      path: [{ ...factory.pos }, { x: factory.pos.x, y: factory.pos.y - 100 }],
      mounted: true,
      revision: 0,
      sourceLzId: null,
      sourceFactoryId: factory.id,
    });

    const vehicleId = asId<UnitId>(state.nextId++);
    const maxHp = C.CHASSIS_HP.tank;
    state.units.push({
      id: vehicleId,
      owner: 'player',
      chassis: 'tank',
      squadId: null,
      firmware: 'player',
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { ...factory.pos },
      vel: { x: 0, y: 0 },
      hp: maxHp,
      maxHp,
      laneId: null,
      laneRevision: 0,
      detached: false,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      attackCooldown: 0,
      targetId: null,
      effectiveVersion: AiVersion.V1,
    });
    factory.parked.push(vehicleId);

    const s1 = makeFootSquad(state, { x: factory.pos.x - 5, y: factory.pos.y });
    // s2 rides laneB instead of the default player lane (laneA).
    const s2 = makeFootSquad(state, { x: factory.pos.x + 5, y: factory.pos.y });
    state.units.find((u) => u.id === s2.unitId)!.laneId = laneBId;

    const sim = new Simulation(state);
    sim.advance();

    const mountingCount = [s1, s2].filter(
      (s) => sim.state.units.find((u) => u.id === s.unitId)?.state === 'mounting',
    ).length;
    expect(mountingCount).toBe(1); // not both, even though they're on different lanes
  });
});

describe('command surface hygiene', () => {
  it('does not alias the caller-supplied path array into sim state (F4)', () => {
    const state = createVerticalSliceMission(2);
    const sim = new Simulation(state);
    const path = [{ x: 60, y: 300 }, { x: 500, y: 300 }];

    sim.issue({ type: 'CreateLane', sourceLzId: null, sourceFactoryId: null, path, mounted: false });
    sim.advance();

    // Mutating the caller's array after the tick must not change sim state —
    // that would be state changing outside tick(), breaking README rule 3.
    path[0].x = 99999;
    path.push({ x: 1, y: 1 });

    const lane = sim.state.lanes.find((l) => l.owner === 'player' && l.sourceFactoryId === null && l.sourceLzId === null)!;
    expect(lane.path[0].x).toBe(60);
    expect(lane.path).toHaveLength(2);
  });

  it('IssueMove detaches the unit itself, so one right-click is one action (F5)', () => {
    const state = createVerticalSliceMission(3);
    const factory = state.factories.find((f) => f.owner === 'player')!;
    const unitId = asId<UnitId>(state.nextId++);
    state.units.push({
      id: unitId,
      owner: 'player',
      chassis: 'tank',
      squadId: null,
      firmware: 'player',
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { ...factory.pos },
      vel: { x: 0, y: 0 },
      hp: C.CHASSIS_HP.tank,
      maxHp: C.CHASSIS_HP.tank,
      laneId: null,
      laneRevision: 0,
      detached: false,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      attackCooldown: 0,
      targetId: null,
      effectiveVersion: AiVersion.V1,
    });

    const sim = new Simulation(state);
    // The UI issues a single IssueMove per right-click now — no paired
    // GrabUnits — and that alone must detach the unit.
    sim.issue({ type: 'IssueMove', unitIds: [unitId], dest: { x: 999, y: 999 } });
    sim.advance();

    expect(sim.state.units.find((u) => u.id === unitId)!.detached).toBe(true);
    expect(sim.state.playerActionCount).toBe(1);
  });

  it('does not let the player hijack the AI factory output onto their own path (F3)', () => {
    const state = createVerticalSliceMission(4);
    const aiFactory = state.factories.find((f) => f.owner === 'ai')!;
    const aiLane = state.lanes.find((l) => l.owner === 'ai')!;
    const sim = new Simulation(state);

    // The exploit: delete the AI's own outbound lane, then create a new lane
    // "sourced" from the AI factory but drawn along the player's path — this
    // used to make AI-built tanks walk it.
    sim.issue({ type: 'DeleteLane', laneId: aiLane.id });
    sim.issue({
      type: 'CreateLane',
      sourceLzId: null,
      sourceFactoryId: aiFactory.id,
      path: [{ x: 880, y: 300 }, { x: 880, y: 30 }],
      mounted: false,
    });
    sim.advance();

    // DeleteLane and CreateLane's sourceFactoryId are both player-only, so
    // neither takes effect against AI furniture: the AI's lane survives...
    expect(sim.state.lanes.some((l) => l.id === aiLane.id)).toBe(true);
    // ...and the hijack attempt produces a lane with no source, not one wired
    // to the AI factory.
    const hijack = sim.state.lanes.find((l) => l.path.some((p) => p.y === 30));
    expect(hijack?.sourceFactoryId).toBeNull();

    for (let i = 0; i < C.BUILD_TICKS.tank + 5; i++) sim.advance();

    const aiTank = sim.state.units.find((u) => u.owner === 'ai' && u.chassis === 'aiTank');
    expect(aiTank).toBeDefined();
    // Still following the real AI lane toward the front, not yanked up to
    // the hijacked path's y=30.
    expect(aiTank!.laneId).toBe(aiLane.id);
  });
});

describe('zone contest events', () => {
  function addStandoffUnit(state: ReturnType<typeof createVerticalSliceMission>, owner: 'player' | 'ai', pos: { x: number; y: number }): void {
    const unitId = asId<UnitId>(state.nextId++);
    // Zero-damage chassis so the two units never fight — an unbroken contest,
    // not one interrupted by a death.
    const maxHp = C.CHASSIS_HP.jammer;
    state.units.push({
      id: unitId,
      owner,
      chassis: 'jammer',
      squadId: null,
      firmware: owner,
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { ...pos },
      vel: { x: 0, y: 0 },
      hp: maxHp,
      maxHp,
      laneId: null,
      laneRevision: 0,
      detached: true,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      attackCooldown: 0,
      targetId: null,
      effectiveVersion: AiVersion.V1,
    });
  }

  it('emits ZoneContested once per contest, not once per tick (F2)', () => {
    const state = createVerticalSliceMission(6);
    const zone = state.zones[0];
    addStandoffUnit(state, 'player', zone.center);
    addStandoffUnit(state, 'ai', zone.center);

    const sim = new Simulation(state);
    const eventLog: string[] = [];
    for (let i = 0; i < 18; i++) {
      for (const e of sim.advance()) eventLog.push(e.type);
    }

    expect(eventLog.filter((t) => t === 'ZoneContested')).toHaveLength(1);
    expect(sim.state.zones.find((z) => z.id === zone.id)!.contested).toBe(true);
  });

  it('emits ZoneContested on the tick a contest actually begins, not a tick late', () => {
    const state = createVerticalSliceMission(6);
    const zone = state.zones[0];
    // Player alone first, uncontested, accruing progress.
    addStandoffUnit(state, 'player', zone.center);
    const sim = new Simulation(state);
    sim.advance();
    sim.advance();

    // Now the AI arrives — this is the tick the contest actually starts.
    addStandoffUnit(sim.state, 'ai', zone.center);
    const events = sim.advance();

    expect(events.map((e) => e.type)).toContain('ZoneContested');
  });
});

describe('spatial grid freshness', () => {
  it('counts a unit produced this tick toward capture the same tick', () => {
    const state = createVerticalSliceMission(9);
    const zoneEast = state.zones[2];
    zoneEast.owner = 'player';

    const aiFactory = state.factories.find((f) => f.owner === 'ai')!;
    // Relocate the factory on top of the zone and put it one tick from
    // producing, so the freshly spawned unit's very first tick is the one
    // capture.ts evaluates.
    aiFactory.pos = { ...zoneEast.center };
    aiFactory.producing = 'aiTank';
    aiFactory.buildTimer = C.BUILD_TICKS.tank - 1;

    const sim = new Simulation(state);
    sim.advance();

    expect(sim.state.units.some((u) => u.owner === 'ai' && u.chassis === 'aiTank')).toBe(true);
    const zone = sim.state.zones.find((z) => z.id === zoneEast.id)!;
    // Would still be 0 (and contender null) if the grid built before
    // production couldn't see the unit spawned this tick.
    expect(zone.contender).toBe('ai');
    expect(zone.captureProgress).toBe(1);
  });
});

describe('spatial grid resolves entities without going stale (F10)', () => {
  it('does not let a unit killed in combat this tick count toward capture the same tick', () => {
    const state = createVerticalSliceMission(10);
    const zone = state.zones[0];

    const playerId = asId<UnitId>(state.nextId++);
    const aiId = asId<UnitId>(state.nextId++);

    // Player is already mid-engagement, one tick from firing — targeting.ts
    // re-affirms 'engaging' this tick (still in range) without resetting the
    // cooldown, so combat.ts fires this same tick.
    state.units.push({
      id: playerId,
      owner: 'player',
      chassis: 'tank',
      squadId: null,
      firmware: 'player',
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { ...zone.center },
      vel: { x: 0, y: 0 },
      hp: C.CHASSIS_HP.tank,
      maxHp: C.CHASSIS_HP.tank,
      laneId: null,
      laneRevision: 0,
      detached: true,
      manualTarget: null,
      state: 'engaging',
      stateTimer: 0,
      attackCooldown: C.ATTACK_COOLDOWN_TICKS - 1,
      targetId: aiId,
      effectiveVersion: AiVersion.V1,
    });

    // One hit of player tank damage is lethal.
    state.units.push({
      id: aiId,
      owner: 'ai',
      chassis: 'aiTank',
      squadId: null,
      firmware: 'ai',
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { ...zone.center },
      vel: { x: 0, y: 0 },
      hp: 1,
      maxHp: C.CHASSIS_HP.aiTank,
      laneId: null,
      laneRevision: 0,
      detached: true,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      attackCooldown: 0,
      targetId: null,
      effectiveVersion: AiVersion.V1,
    });

    const sim = new Simulation(state);
    const events = sim.advance();

    expect(events.map((e) => e.type)).toContain('UnitDestroyed');
    expect(sim.state.units.some((u) => u.id === aiId)).toBe(false);

    const capturedZone = sim.state.zones.find((z) => z.id === zone.id)!;
    // If the dead ai unit were still visible to capture.ts via a stale grid
    // entry, this zone would read as contested with contender null instead
    // of uncontested progress toward the player.
    expect(capturedZone.contested).toBe(false);
    expect(capturedZone.contender).toBe('player');
    expect(capturedZone.captureProgress).toBe(1);
  });
});

describe('mission is winnable (F1)', () => {
  it('reaches won after a player unit holds the AI factory uncontested', () => {
    const state = createVerticalSliceMission(8);
    const aiFactory = state.factories.find((f) => f.owner === 'ai')!;

    // Harmless AI output for the duration: this test is about the capture/win
    // mechanic, not about surviving AI tank fire, and capture easily
    // outruns the AI's first production cycle anyway (FACTORY_CAPTURE_TICKS
    // well under BUILD_TICKS.tank) — this just keeps the test independent of
    // that timing relationship.
    aiFactory.producing = 'jammer';

    const capturerId = asId<UnitId>(state.nextId++);
    const maxHp = C.CHASSIS_HP.tank;
    state.units.push({
      id: capturerId,
      owner: 'player',
      chassis: 'tank',
      squadId: null,
      firmware: 'player',
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { ...aiFactory.pos },
      vel: { x: 0, y: 0 },
      hp: maxHp,
      maxHp,
      laneId: null,
      laneRevision: 0,
      detached: true,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      attackCooldown: 0,
      targetId: null,
      effectiveVersion: AiVersion.V1,
    });

    const sim = new Simulation(state);
    const eventLog: string[] = [];
    runHeadless(sim, C.FACTORY_CAPTURE_TICKS + C.END_OF_LIFE_RIPPLE_TICKS + 100, (events) => {
      for (const e of events) eventLog.push(e.type);
    });

    expect(eventLog).toContain('FactoryCaptured');
    expect(eventLog).toContain('EndOfLifeIssued');
    expect(eventLog).toContain('MissionWon');
    expect(sim.state.phase).toBe('won');
    expect(sim.state.factories.every((f) => f.owner === 'player')).toBe(true);
  });
});

describe('movement holds at uncaptured zones', () => {
  it('halts a unit standing in an unowned zone, then releases it once captured', () => {
    const state = createVerticalSliceMission(5);
    const zone = state.zones[0]; // zoneWest: neutral, only on the player's lane
    const lane = state.lanes.find((l) => l.owner === 'player')!;

    const unitId = asId<UnitId>(state.nextId++);
    const maxHp = C.CHASSIS_HP.tank;
    state.units.push({
      id: unitId,
      owner: 'player',
      chassis: 'tank',
      squadId: null,
      firmware: 'player',
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { ...zone.center },
      vel: { x: 0, y: 0 },
      hp: maxHp,
      maxHp,
      laneId: lane.id,
      laneRevision: lane.revision,
      detached: false,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      attackCooldown: 0,
      targetId: null,
      effectiveVersion: AiVersion.V1,
    });

    const sim = new Simulation(state);

    for (let i = 0; i < C.CAPTURE_TICKS - 5; i++) sim.advance();
    expect(sim.state.units.find((u) => u.id === unitId)!.pos).toEqual(zone.center);
    expect(sim.state.zones.find((z) => z.id === zone.id)!.owner).not.toBe('player');

    for (let i = 0; i < 40; i++) sim.advance();
    expect(sim.state.zones.find((z) => z.id === zone.id)!.owner).toBe('player');
    expect(sim.state.units.find((u) => u.id === unitId)!.pos.x).toBeGreaterThan(zone.center.x);
  });
});

describe('replay and quickload hygiene (F8/F9)', () => {
  it('replay() carries the original seed even after rngState has moved on', () => {
    const sim = new Simulation(createVerticalSliceMission(4242));
    runHeadless(sim, C.secs(30));

    expect(sim.state.rngState).not.toBe(4242); // moved on after the first random() call
    const replay = sim.replay();
    expect(replay.seed).toBe(4242);
    expect(replay.mapId).toBe(C.MAP_ID);
    expect(replay.log).toBe(sim.log);
  });

  it('loadState replaces state and clears queued/log from the discarded run', () => {
    const sim = new Simulation(createVerticalSliceMission(1));
    const playerFactoryId = sim.state.factories.find((f) => f.owner === 'player')!.id;
    // Queued but not yet applied — advance() hasn't run since.
    sim.issue({ type: 'SetFactoryProduction', factoryId: playerFactoryId, chassis: 'jammer' });
    expect(sim.log.length).toBe(1);

    // A second mission from mission.ts allocates ids identically, so its
    // player factory has the same numeric id — the scenario where a leftover
    // queued command would silently land on the wrong run's state.
    const otherState = createVerticalSliceMission(2);
    otherState.tick = 999;
    sim.loadState(JSON.stringify(otherState));

    expect(sim.state.tick).toBe(999);
    expect(sim.log.length).toBe(0);

    sim.advance();
    const factory = sim.state.factories.find((f) => f.id === playerFactoryId)!;
    expect(factory.producing).not.toBe('jammer');
  });
});

describe('forward landing zone (F6)', () => {
  it('opens the forward LZ when the centre zone is captured', () => {
    const state = createVerticalSliceMission(12);
    const centerZone = state.zones.find((z) => z.center.x === 500)!;
    expect(centerZone.lzId).not.toBeNull();

    const forwardLz = state.landingZones.find((lz) => lz.id === centerZone.lzId)!;
    expect(forwardLz.active).toBe(false);

    const unitId = asId<UnitId>(state.nextId++);
    state.units.push({
      id: unitId,
      owner: 'player',
      chassis: 'tank',
      squadId: null,
      firmware: 'player',
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { ...centerZone.center },
      vel: { x: 0, y: 0 },
      hp: C.CHASSIS_HP.tank,
      maxHp: C.CHASSIS_HP.tank,
      laneId: null,
      laneRevision: 0,
      detached: true,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      attackCooldown: 0,
      targetId: null,
      effectiveVersion: AiVersion.V1,
    });

    const sim = new Simulation(state);
    const eventLog: string[] = [];
    for (let i = 0; i < C.CAPTURE_TICKS + 1; i++) {
      for (const e of sim.advance()) eventLog.push(e.type);
    }

    expect(eventLog).toContain('ForwardLzOpened');
    const opened = sim.state.landingZones.find((lz) => lz.id === centerZone.lzId)!;
    expect(opened.active).toBe(true);
    expect(opened.owner).toBe('player');
  });
});

describe('capturing state (F7)', () => {
  it('reports capturing, not moving, while holding an unowned zone', () => {
    const state = createVerticalSliceMission(11);
    const zone = state.zones[0];
    const lane = state.lanes.find((l) => l.owner === 'player')!;

    const unitId = asId<UnitId>(state.nextId++);
    state.units.push({
      id: unitId,
      owner: 'player',
      chassis: 'tank',
      squadId: null,
      firmware: 'player',
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { ...zone.center },
      vel: { x: 0, y: 0 },
      hp: C.CHASSIS_HP.tank,
      maxHp: C.CHASSIS_HP.tank,
      laneId: lane.id,
      laneRevision: lane.revision,
      detached: false,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      attackCooldown: 0,
      targetId: null,
      effectiveVersion: AiVersion.V1,
    });

    const sim = new Simulation(state);
    sim.advance();

    // Both movement.ts and targeting.ts touch state this tick — targeting
    // runs later and used to hard-write 'moving' over movement's 'capturing'.
    expect(sim.state.units.find((u) => u.id === unitId)!.state).toBe('capturing');
  });
});

describe('balance multipliers', () => {
  function makeTank(owner: 'player' | 'ai'): Unit {
    const maxHp = C.CHASSIS_HP.tank;
    return {
      id: asId<UnitId>(999),
      owner,
      chassis: 'tank',
      squadId: null,
      firmware: owner,
      firmwareWipeProgress: 0,
      reclaimExposure: 0,
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      hp: maxHp,
      maxHp,
      laneId: null,
      laneRevision: 0,
      detached: false,
      manualTarget: null,
      state: 'moving',
      stateTimer: 0,
      attackCooldown: 0,
      targetId: null,
      effectiveVersion: AiVersion.V1,
    };
  }

  it('applies AI_DAMAGE_MULTIPLIER only to AI-owned units', () => {
    const state = createVerticalSliceMission(1);
    const playerDamage = unitDamage(state, makeTank('player'));
    const aiDamage = unitDamage(state, makeTank('ai'));

    expect(playerDamage).toBe(C.CHASSIS_DAMAGE.tank);
    expect(aiDamage).toBeCloseTo(C.CHASSIS_DAMAGE.tank * C.AI_DAMAGE_MULTIPLIER, 6);
  });

  it('applies GLOBAL_SPEED_MULTIPLIER to every unit regardless of side', () => {
    expect(unitSpeed(makeTank('player'))).toBeCloseTo(C.CHASSIS_SPEED.tank * C.GLOBAL_SPEED_MULTIPLIER, 6);
    expect(unitSpeed(makeTank('ai'))).toBeCloseTo(C.CHASSIS_SPEED.tank * C.GLOBAL_SPEED_MULTIPLIER, 6);
  });
});

describe('pure helpers', () => {
  it('dropIntervalFor tapers past the diminishing-returns threshold', () => {
    const atThreshold = dropIntervalFor(6, 10); // 60%
    const beyond = dropIntervalFor(10, 10); // 100%
    expect(beyond).toBeLessThan(atThreshold);
    expect(beyond).toBeGreaterThan(C.DROP_INTERVAL_MIN_TICKS);
  });

  it('rolledBackVersion clamps at V1 and no-ops when not jammed', () => {
    expect(rolledBackVersion(AiVersion.Final, false)).toBe(AiVersion.Final);
    expect(rolledBackVersion(AiVersion.V2, true)).toBe(AiVersion.V1);
  });
});
