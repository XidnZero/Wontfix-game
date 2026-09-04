import { describe, it, expect } from 'vitest';

import { createVerticalSliceMission } from './mission';
import { Simulation, dropIntervalFor, rolledBackVersion } from './sim';
import { runHeadless } from '../app/clock';
import { asId, AiVersion } from './types';
import type { Squad, SquadId, Unit, UnitId } from './types';
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
    const state = createVerticalSliceMission(1);
    expect(unitSpeed(state, makeTank('player'))).toBeCloseTo(C.CHASSIS_SPEED.tank * C.GLOBAL_SPEED_MULTIPLIER, 6);
    expect(unitSpeed(state, makeTank('ai'))).toBeCloseTo(C.CHASSIS_SPEED.tank * C.GLOBAL_SPEED_MULTIPLIER, 6);
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
