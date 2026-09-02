# WONTFIX — sim layer skeleton

Real-time strategy, browser-first. TypeScript + Vite + PixiJS.

This is the sim-layer scaffold: types, the tick pipeline, the fixed-timestep
clock, and the platform boundary. Systems are declared with signatures but not
implemented — the ordering and the boundaries are the part worth getting right
before writing behaviour code.

## Layout

```
src/
  sim/          pure TypeScript, runs in Node, no DOM
    config.ts   every tunable number, in one place
    types.ts    entities and the serializable MissionState
    io.ts       Command and SimEvent — the only boundary crossings
    rng.ts      deterministic PRNG (no Math.random, ever)
    sim.ts      the tick pipeline
    systems/    one file per step, to be written
  app/
    clock.ts    fixed timestep, pause, speed, render interpolation
  render/       Pixi. Reads state, writes nothing.
  ui/           plain HTML/CSS over the canvas.
  platform/     the only file that touches storage or the DOM chrome
```

## The three rules

1. **`src/sim` has no DOM, no `Math.random`, no `Date.now`.** It must run in
   Node.
2. **Everything reachable from `MissionState` is plain serializable data.** No
   class instances, no closures, no Maps holding functions.
3. **State changes only through `tick(state, commands)`.**

Those three buy mid-battle save/resume, pause and speed controls, and
command-log replay. Replay is also the clip-sharing feature later. Break one
rule and you lose all of it.

## Tick ordering is a gameplay decision

The pipeline in `sim.ts` is ordered deliberately:

- **Auras before targeting** — a jammer rollback must affect this tick's
  decisions, not next tick's.
- **Deaths before capture** — a squad wiped standing on a point must stop
  capturing it immediately.
- **Territory before win/lose** — the loss clock has to see the current zone
  count.
- **Commands first** — a lane redrawn this frame is visible to every system
  below it.

Reordering these changes how the game plays. Treat it as such.

## Running headless

`runHeadless()` in `app/clock.ts` drives a full mission with no browser, no
rAF, no timing. A mission completes in milliseconds, so a config value can be
swept across a hundred runs in a unit test. This is the main reason for keeping
the sim pure and it is worth protecting.

## Build order

1. `systems/movement.ts` — flow fields, one per lane destination. Not per-unit
   A*: that drowns the moment sixty units path to the same place.
2. `systems/spatial.ts` — uniform grid, ~50 lines. Not a quadtree.
3. `systems/capture.ts` + `systems/territoryTempo.ts` — the tempo loop, which
   is the thing the vertical slice exists to test.
4. `systems/factories.ts` + `systems/dropships.ts` + `systems/mounting.ts` —
   the two supply streams meeting.
5. `systems/targeting.ts` + `systems/combat.ts` + `systems/deaths.ts` — combat,
   including crew-dies-with-vehicle.
6. Everything else.

Auras, reclaim, AI versioning and end-of-life can stay stubbed through the
whole vertical slice. None of them are needed to answer the three questions the
slice exists to answer.

## What the vertical slice is testing

One map, two factories, five minutes, rectangles.

1. Does a 3-second capture feel right?
2. Is the mounted-vs-foot bet worth taking?
3. Does drop cadence read as a tempo system, or as waiting?

Plus one instrumented check: `state.playerActionCount` against
`ACTION_FLOOR_PER_MISSION`. If a mission can be won with fewer actions than the
floor, the autopilot is doing too much and the player is a spectator. That is
the failure mode this control scheme is most exposed to, and counting actions
is a far better signal than asking whether it "feels" engaging.
