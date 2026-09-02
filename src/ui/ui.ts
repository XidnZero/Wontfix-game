/**
 * Plain HTML/CSS over the canvas — see the README's layout rules. Reads
 * state and issues Commands through `Simulation.issue`; nothing here reaches
 * into the sim directly.
 *
 * Interaction is intentionally minimal for now: drag anywhere to redraw the
 * player's one starting lane (straight line from drag-start to drag-end),
 * so the capture-feel/tempo questions the vertical slice exists to answer
 * are testable by hand. Squad grab/move (Tier 2 commands) isn't wired up
 * yet — see the follow-up note in the repo history.
 */

import type { Application } from 'pixi.js';
import * as C from '../sim/config';
import type { Clock } from '../app/clock';
import type { Simulation } from '../sim/sim';
import type { SimEvent } from '../sim/io';
import type { MissionState } from '../sim/types';

export interface UiHandle {
  update(state: MissionState): void;
  handleEvents(events: SimEvent[]): void;
  destroy(): void;
}

function fmtSeconds(ticks: number): string {
  const s = Math.max(0, Math.round(ticks / C.TICK_HZ));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createUi(app: Application, sim: Simulation, clock: Clock): UiHandle {
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;inset:0;pointer-events:none;color:#e6e8eb;' +
    'font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;';
  document.body.appendChild(root);

  const hud = document.createElement('div');
  hud.style.cssText =
    'position:absolute;top:12px;left:12px;background:#00000066;' +
    'padding:8px 12px;border-radius:6px;white-space:nowrap;';
  root.appendChild(hud);

  const banner = document.createElement('div');
  banner.style.cssText =
    'position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);' +
    'font-size:44px;font-weight:700;letter-spacing:4px;display:none;';
  root.appendChild(banner);

  const hint = document.createElement('div');
  hint.style.cssText =
    'position:absolute;bottom:12px;left:12px;background:#00000066;' +
    'padding:6px 10px;border-radius:6px;font-size:12px;opacity:0.8;';
  hint.textContent = 'drag to redraw your lane · space: pause · 1/2/3: speed';
  root.appendChild(hint);

  const canvas = app.canvas;
  canvas.style.pointerEvents = 'auto';
  canvas.style.touchAction = 'none';

  function worldPoint(ev: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  let dragFrom: { x: number; y: number } | null = null;

  const onPointerDown = (ev: PointerEvent): void => {
    if (ev.button !== 0) return;
    dragFrom = worldPoint(ev);
  };
  const onPointerUp = (ev: PointerEvent): void => {
    if (!dragFrom) return;
    const to = worldPoint(ev);
    const from = dragFrom;
    dragFrom = null;

    const lane = sim.state.lanes.find((l) => l.owner === 'player');
    if (lane) sim.issue({ type: 'RedrawLane', laneId: lane.id, path: [from, to] });
  };
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.code === 'Space') {
      clock.speed = clock.speed === 0 ? 1 : 0;
      ev.preventDefault();
    } else if (ev.code === 'Digit1') clock.speed = 1;
    else if (ev.code === 'Digit2') clock.speed = 2;
    else if (ev.code === 'Digit3') clock.speed = 3;
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);

  return {
    update(state: MissionState): void {
      const zonesTotal = state.zones.length;
      const dropEta = fmtSeconds(state.player.dropIntervalTicks - state.player.dropTimer);
      const lossWarning =
        state.player.lossClockTicks > 0
          ? ` · loss clock ${fmtSeconds(C.LOSS_CLOCK_TICKS - state.player.lossClockTicks)}`
          : '';

      hud.innerHTML =
        `<div>${fmtSeconds(state.tick)} · tick ${state.tick} · speed ${clock.speed}x</div>` +
        `<div>zones ${state.player.zonesHeld}/${zonesTotal} · next drop ${dropEta}${lossWarning}</div>` +
        `<div>actions ${state.playerActionCount} / floor ${C.ACTION_FLOOR_PER_MISSION}</div>`;

      if (state.phase === 'won' || state.phase === 'lost') {
        banner.style.display = 'block';
        banner.style.color = state.phase === 'won' ? '#4fd1ff' : '#ff5c5c';
        banner.textContent = state.phase === 'won' ? 'MISSION COMPLETE' : 'MISSION FAILED';
      }
    },

    handleEvents(_events: SimEvent[]): void {
      // Reserved for a toast/log feed later.
    },

    destroy(): void {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };
}
