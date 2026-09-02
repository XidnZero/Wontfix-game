import { describe, it, expect } from 'vitest';

import { createVerticalSliceMission } from './mission';
import { Simulation, dropIntervalFor, rolledBackVersion } from './sim';
import { runHeadless } from '../app/clock';
import { AiVersion } from './types';
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
