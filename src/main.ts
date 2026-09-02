import { Application } from 'pixi.js';
import { Clock } from './app/clock';
import { createVerticalSliceMission } from './sim/mission';
import { Simulation } from './sim/sim';
import { createRenderer } from './render/render';
import { createUi, type UiHandle } from './ui/ui';
import { BrowserPlatform } from './platform/platform';

async function main(): Promise<void> {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('missing #app mount point');

  const app = new Application();
  await app.init({ resizeTo: window, background: 0x0b0d10, antialias: true });
  mount.appendChild(app.canvas);

  const platform = new BrowserPlatform();
  const sim = new Simulation(createVerticalSliceMission(Date.now() >>> 0));
  const renderer = createRenderer(app);

  // `ui` needs `clock` to wire pause/speed keys, and `clock`'s render
  // callback needs `ui` to draw the HUD — constructed in this order, the
  // callback just can't fire before `ui` exists, which it can't (nothing
  // ticks until clock.start() below).
  let ui: UiHandle;
  const clock = new Clock(
    sim,
    (events) => ui.handleEvents(events),
    (alpha) => {
      renderer.render(sim.state, alpha, ui.getSelection(), ui.getDragRect());
      ui.update(sim.state);
    },
  );
  ui = createUi(app, sim, clock, platform);

  clock.start();
}

void main();
