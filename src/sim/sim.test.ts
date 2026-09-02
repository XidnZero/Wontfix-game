import { describe, it, expect } from 'vitest';

import { createVerticalSliceMission } from './mission';
import { Simulation, dropIntervalFor, rolledBackVersion } from './sim';
import { runHeadless } from '../app/clock';
import { asId, AiVersion } from './types';
import type { Squad, SquadId, Unit, UnitId } from './types';
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
