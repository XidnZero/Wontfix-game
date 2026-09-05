/**
 * Plain HTML/CSS over the canvas — see the README's layout rules. Reads
 * state and issues Commands through `Simulation.issue`; nothing here reaches
 * into the sim directly.
 *
 * Controls, RTS-standard: left-drag box-selects player units, right-click
 * grabs the selection and sends it to the click point (Tier 2: IssueMove,
 * which detaches on its own — a move order IS a grab), 'R' releases the
 * selection back to lane control. A plain click
 * (no drag) on a friendly factory cycles its production through the four
 * player chassis — the only way SetFactoryProduction ever gets issued.
 * Shift+drag redraws the player's one starting lane, sampling points along
 * the actual drag path (not just start/end) so it's a real multi-waypoint
 * lane, not a single straight segment. 'S'/'L' save/load through the
 * platform boundary — the payoff for MissionState being plain serializable
 * data (README rule 2): a snapshot is just `JSON.stringify`, and loading one
 * back is just replacing the field.
 */

import type { Application } from 'pixi.js';
import * as C from '../sim/config';
import type { Clock } from '../app/clock';
import type { Simulation } from '../sim/sim';
import type { SimEvent } from '../sim/io';
import type { MissionState, PlayerChassis, UnitId, Vec2 } from '../sim/types';
import type { DragRect } from '../render/render';
import type { Platform } from '../platform/platform';

const QUICKSAVE_SLOT = 'quicksave';

/** Order factories cycle through on click. */
const FACTORY_CHASSIS_ORDER: readonly PlayerChassis[] = ['scout', 'tank', 'jammer', 'repair'];

/** Half-extent of a factory's clickable footprint — matches its render size. */
const FACTORY_HIT_RADIUS = 16;

export interface UiHandle {
  update(state: MissionState): void;
  handleEvents(events: SimEvent[]): void;
  getSelection(): ReadonlySet<UnitId>;
  getDragRect(): DragRect | null;
  getLanePreview(): Vec2[] | null;
  destroy(): void;
}

function fmtSeconds(ticks: number): string {
  const s = Math.max(0, Math.round(ticks / C.TICK_HZ));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Slack added around a box-select rect so a plain click still hits a unit. */
const CLICK_TOLERANCE = 6;

/** Minimum distance between sampled points on a hand-drawn lane. */
const MIN_WAYPOINT_SPACING = 24;

export function createUi(app: Application, sim: Simulation, clock: Clock, platform: Platform): UiHandle {
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
    'drag: select · right-click: move · R: release · click factory: cycle production · ' +
    'shift+drag: draw lane · space: pause · 1/2/3: speed · S: save · L: load';
  root.appendChild(hint);

  const toast = document.createElement('div');
  toast.style.cssText =
    'position:absolute;top:12px;right:12px;background:#00000066;' +
    'padding:6px 10px;border-radius:6px;font-size:12px;opacity:0;transition:opacity 0.3s;';
  root.appendChild(toast);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(text: string): void {
    toast.textContent = text;
    toast.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
    }, 2000);
  }

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

  function friendlyFactoryAt(state: MissionState, p: { x: number; y: number }) {
    return state.factories.find(
      (f) =>
        f.owner === 'player' &&
        Math.abs(p.x - f.pos.x) <= FACTORY_HIT_RADIUS &&
        Math.abs(p.y - f.pos.y) <= FACTORY_HIT_RADIUS,
    );
  }

  let selected = new Set<UnitId>();
  let dragStart: { x: number; y: number } | null = null;
  let dragCurrent: { x: number; y: number } | null = null;
  let dragIsLaneRedraw = false;
  let lanePath: Vec2[] = [];

  const onContextMenu = (ev: MouseEvent): void => ev.preventDefault();

  const onPointerDown = (ev: PointerEvent): void => {
    if (ev.button === 0) {
      dragStart = worldPoint(ev);
      dragCurrent = dragStart;
      dragIsLaneRedraw = ev.shiftKey;
      lanePath = dragIsLaneRedraw ? [dragStart] : [];
    } else if (ev.button === 2) {
      if (selected.size === 0) return;
      const dest = worldPoint(ev);
      const unitIds = [...selected];
      // IssueMove sets detached itself (commands.ts) — a move order IS a
      // grab, and one right-click should score one action against the
      // ACTION_FLOOR_PER_MISSION instrumentation, not two.
      sim.issue({ type: 'IssueMove', unitIds, dest });
    }
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (!dragStart) return;
    dragCurrent = worldPoint(ev);

    if (dragIsLaneRedraw) {
      const last = lanePath[lanePath.length - 1];
      const dx = dragCurrent.x - last.x;
      const dy = dragCurrent.y - last.y;
      if (dx * dx + dy * dy >= MIN_WAYPOINT_SPACING * MIN_WAYPOINT_SPACING) {
        lanePath.push(dragCurrent);
      }
    }
  };

  const onPointerUp = (ev: PointerEvent): void => {
    if (ev.button !== 0 || !dragStart) return;
    const from = dragStart;
    const to = worldPoint(ev);
    dragStart = null;
    dragCurrent = null;

    if (dragIsLaneRedraw) {
      const path = lanePath;
      lanePath = [];
      const last = path[path.length - 1];
      if (last.x !== to.x || last.y !== to.y) path.push(to);

      if (path.length >= 2) {
        const lane = sim.state.lanes.find((l) => l.owner === 'player');
        if (lane) sim.issue({ type: 'RedrawLane', laneId: lane.id, path });
      }
      return;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const wasClick = dx * dx + dy * dy <= CLICK_TOLERANCE * CLICK_TOLERANCE;
    const factory = wasClick ? friendlyFactoryAt(sim.state, to) : undefined;

    if (factory) {
      const order = FACTORY_CHASSIS_ORDER;
      const next = order[(order.indexOf(factory.producing as PlayerChassis) + 1) % order.length];
      sim.issue({ type: 'SetFactoryProduction', factoryId: factory.id, chassis: next });
      showToast(`Factory -> ${next}`);
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
    } else if (ev.code === 'KeyS') {
      platform
        .save(QUICKSAVE_SLOT, sim.snapshot())
        .then(() => showToast('Saved'))
        .catch(() => showToast('Save failed'));
    } else if (ev.code === 'KeyL') {
      platform
        .load(QUICKSAVE_SLOT)
        .then((json) => {
          if (!json) {
            showToast('No save found');
            return;
          }
          // Not `sim.state = JSON.parse(json)` — that leaves `queued` and
          // `log` from the discarded run still attached to the Simulation.
          sim.loadState(json);
          selected = new Set();
          showToast('Loaded');
        })
        .catch(() => showToast('Load failed'));
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

    getLanePreview(): Vec2[] | null {
      if (!dragIsLaneRedraw || lanePath.length === 0) return null;
      return dragCurrent ? [...lanePath, dragCurrent] : lanePath;
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
