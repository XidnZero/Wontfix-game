/**
 * Plain HTML/CSS over the canvas — see the README's layout rules. Reads
 * state and issues Commands through `Simulation.issue`; nothing here reaches
 * into the sim directly.
 *
 * Controls, RTS-standard: left-drag box-selects player units, right-click
 * grabs the selection and sends it to the click point (Tier 2: GrabUnits +
 * IssueMove), 'R' releases the selection back to lane control. Shift+drag
 * redraws the player's one starting lane as a straight line — a stand-in for
 * proper multi-waypoint lane drawing, good enough to test capture feel by
 * hand.
 */

import type { Application } from 'pixi.js';
import * as C from '../sim/config';
import type { Clock } from '../app/clock';
import type { Simulation } from '../sim/sim';
import type { SimEvent } from '../sim/io';
import type { MissionState, UnitId } from '../sim/types';
import type { DragRect } from '../render/render';

export interface UiHandle {
  update(state: MissionState): void;
  handleEvents(events: SimEvent[]): void;
  getSelection(): ReadonlySet<UnitId>;
  getDragRect(): DragRect | null;
  destroy(): void;
}

function fmtSeconds(ticks: number): string {
  const s = Math.max(0, Math.round(ticks / C.TICK_HZ));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Slack added around a box-select rect so a plain click still hits a unit. */
const CLICK_TOLERANCE = 6;

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
  hint.textContent =
    'drag: select · right-click: move · R: release · shift+drag: redraw lane · space: pause · 1/2/3: speed';
  root.appendChild(hint);

  const canvas = app.canvas;
  canvas.style.pointerEvents = 'auto';
  canvas.style.touchAction = 'none';

  function worldPoint(ev: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function unitsInRect(state: MissionState, a: { x: number; y: number }, b: { x: number; y: number }): Set<UnitId> {
    const minX = Math.min(a.x, b.x) - CLICK_TOLERANCE;
    const maxX = Math.max(a.x, b.x) + CLICK_TOLERANCE;
    const minY = Math.min(a.y, b.y) - CLICK_TOLERANCE;
    const maxY = Math.max(a.y, b.y) + CLICK_TOLERANCE;
    const ids = state.units
      .filter((u) => u.owner === 'player' && u.pos.x >= minX && u.pos.x <= maxX && u.pos.y >= minY && u.pos.y <= maxY)
      .map((u) => u.id);
    return new Set(ids);
  }

  let selected = new Set<UnitId>();
  let dragStart: { x: number; y: number } | null = null;
  let dragCurrent: { x: number; y: number } | null = null;
  let dragIsLaneRedraw = false;

  const onContextMenu = (ev: MouseEvent): void => ev.preventDefault();

  const onPointerDown = (ev: PointerEvent): void => {
    if (ev.button === 0) {
      dragStart = worldPoint(ev);
      dragCurrent = dragStart;
      dragIsLaneRedraw = ev.shiftKey;
    } else if (ev.button === 2) {
      if (selected.size === 0) return;
      const dest = worldPoint(ev);
      const unitIds = [...selected];
      sim.issue({ type: 'GrabUnits', unitIds });
      sim.issue({ type: 'IssueMove', unitIds, dest });
    }
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (dragStart) dragCurrent = worldPoint(ev);
  };

  const onPointerUp = (ev: PointerEvent): void => {
    if (ev.button !== 0 || !dragStart) return;
    const from = dragStart;
    const to = worldPoint(ev);
    dragStart = null;
    dragCurrent = null;

    if (dragIsLaneRedraw) {
      const lane = sim.state.lanes.find((l) => l.owner === 'player');
      if (lane) sim.issue({ type: 'RedrawLane', laneId: lane.id, path: [from, to] });
    } else {
      selected = unitsInRect(sim.state, from, to);
    }
  };

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.code === 'Space') {
      clock.speed = clock.speed === 0 ? 1 : 0;
      ev.preventDefault();
    } else if (ev.code === 'Digit1') clock.speed = 1;
    else if (ev.code === 'Digit2') clock.speed = 2;
    else if (ev.code === 'Digit3') clock.speed = 3;
    else if (ev.code === 'KeyR' && selected.size > 0) {
      sim.issue({ type: 'ReleaseUnits', unitIds: [...selected] });
    }
  };

  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);

  return {
    update(state: MissionState): void {
      // Selected units die or get consumed by mounting; drop stale ids so
      // the highlight ring and 'R' don't reference ghosts.
      if (selected.size > 0) {
        const live = new Set(state.units.map((u) => u.id));
        for (const id of selected) if (!live.has(id)) selected.delete(id);
      }

      const zonesTotal = state.zones.length;
      const dropEta = fmtSeconds(state.player.dropIntervalTicks - state.player.dropTimer);
      const lossWarning =
        state.player.lossClockTicks > 0
          ? ` · loss clock ${fmtSeconds(C.LOSS_CLOCK_TICKS - state.player.lossClockTicks)}`
          : '';

      hud.innerHTML =
        `<div>${fmtSeconds(state.tick)} · tick ${state.tick} · speed ${clock.speed}x</div>` +
        `<div>zones ${state.player.zonesHeld}/${zonesTotal} · next drop ${dropEta}${lossWarning}</div>` +
        `<div>actions ${state.playerActionCount} / floor ${C.ACTION_FLOOR_PER_MISSION} · selected ${selected.size}</div>`;

      if (state.phase === 'won' || state.phase === 'lost') {
        banner.style.display = 'block';
        banner.style.color = state.phase === 'won' ? '#4fd1ff' : '#ff5c5c';
        banner.textContent = state.phase === 'won' ? 'MISSION COMPLETE' : 'MISSION FAILED';
      }
    },

    handleEvents(_events: SimEvent[]): void {
      // Reserved for a toast/log feed later.
    },

    getSelection(): ReadonlySet<UnitId> {
      return selected;
    },

    getDragRect(): DragRect | null {
      if (!dragStart || !dragCurrent || dragIsLaneRedraw) return null;
      return { x0: dragStart.x, y0: dragStart.y, x1: dragCurrent.x, y1: dragCurrent.y };
    },

    destroy(): void {
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };
}
