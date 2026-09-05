/**
 * Pixi. Reads state, writes nothing — see the README's layout rules.
 *
 * Furniture (zones/factories/LZs/lanes) is redrawn whenever the tick
 * advances; unit positions are interpolated between the last two ticks using
 * `alpha` every frame, which is what makes 20Hz simulation look smooth at
 * whatever the display's refresh rate is (see app/clock.ts).
 */

import { Container, Graphics, Text, type Application } from 'pixi.js';
import * as C from '../sim/config';
import type { FactoryId, MissionState, Owner, UnitId, Vec2 } from '../sim/types';

const OWNER_COLOR: Record<Owner, number> = {
  player: 0x4fd1ff,
  ai: 0xff5c5c,
  neutral: 0x6b7280,
};

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export interface DragRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Renderer {
  render(
    state: MissionState,
    alpha: number,
    selected: ReadonlySet<UnitId>,
    dragRect: DragRect | null,
    lanePreview: Vec2[] | null,
  ): void;
  destroy(): void;
}

export function createRenderer(app: Application): Renderer {
  const world = new Container();
  const furniture = new Graphics();
  const labels = new Container();
  const units = new Graphics();
  const overlay = new Graphics();
  world.addChild(furniture, labels, units, overlay);
  app.stage.addChild(world);

  let lastTick = -1;
  let prevPos = new Map<UnitId, Vec2>();
  let currPos = new Map<UnitId, Vec2>();
  const factoryLabels = new Map<FactoryId, Text>();

  function drawFurniture(state: MissionState): void {
    furniture.clear();

    for (const lane of state.lanes) {
      if (lane.path.length < 2) continue;
      furniture.moveTo(lane.path[0].x, lane.path[0].y);
      for (let i = 1; i < lane.path.length; i++) furniture.lineTo(lane.path[i].x, lane.path[i].y);
      furniture.stroke({ width: lane.mounted ? 3 : 1.5, color: OWNER_COLOR[lane.owner], alpha: 0.3 });
    }

    for (const lz of state.landingZones) {
      furniture.circle(lz.pos.x, lz.pos.y, 10);
      furniture.stroke({ width: 2, color: OWNER_COLOR[lz.owner], alpha: lz.active ? 0.9 : 0.25 });
    }

    for (const factory of state.factories) {
      const color = OWNER_COLOR[factory.owner];
      furniture.rect(factory.pos.x - 16, factory.pos.y - 16, 32, 32);
      furniture.fill({ color, alpha: 0.25 });
      furniture.stroke({ width: 2, color });

      let label = factoryLabels.get(factory.id);
      if (!label) {
        label = new Text({ style: { fontSize: 10, fill: 0xe6e8eb, fontFamily: 'monospace' } });
        label.anchor.set(0.5, 0);
        factoryLabels.set(factory.id, label);
        labels.addChild(label);
      }
      label.text = factory.producing;
      label.position.set(factory.pos.x, factory.pos.y + 20);
    }

    for (const zone of state.zones) {
      const ringColor = zone.contested ? 0xffd23f : OWNER_COLOR[zone.owner];
      furniture.circle(zone.center.x, zone.center.y, zone.radius);
      furniture.stroke({ width: 2, color: ringColor, alpha: 0.85 });

      // captureProgress > 0, not contender !== null: a contested zone freezes
      // progress by nulling contender (capture.ts), so gating on contender
      // made frozen progress during a contest invisible — reading as lost
      // rather than held.
      if (zone.captureProgress > 0) {
        const frac = Math.min(1, zone.captureProgress / C.CAPTURE_TICKS);
        const barY = zone.center.y + zone.radius + 6;
        const barColor = zone.contested ? 0xffd23f : OWNER_COLOR[zone.contender ?? zone.owner];
        furniture.rect(zone.center.x - zone.radius, barY, zone.radius * 2, 4);
        furniture.fill({ color: 0x2a2f36 });
        furniture.rect(zone.center.x - zone.radius, barY, zone.radius * 2 * frac, 4);
        furniture.fill({ color: barColor });
      }
    }
  }

  return {
    render(
      state: MissionState,
      alpha: number,
      selected: ReadonlySet<UnitId>,
      dragRect: DragRect | null,
      lanePreview: Vec2[] | null,
    ): void {
      if (state.tick !== lastTick) {
        prevPos = currPos;
        currPos = new Map(state.units.map((u) => [u.id, { ...u.pos }]));
        lastTick = state.tick;
        drawFurniture(state);
      }

      units.clear();
      for (const unit of state.units) {
        const prev = prevPos.get(unit.id) ?? unit.pos;
        const curr = currPos.get(unit.id) ?? unit.pos;
        const pos = lerp(prev, curr, alpha);
        const color = OWNER_COLOR[unit.owner];
        const hpFrac = unit.maxHp > 0 ? Math.max(0, unit.hp / unit.maxHp) : 1;
        const alphaHp = 0.5 + 0.5 * hpFrac;

        if (unit.chassis === null) {
          units.circle(pos.x, pos.y, 4);
          units.fill({ color, alpha: alphaHp });
        } else {
          units.rect(pos.x - 6, pos.y - 6, 12, 12);
          units.fill({ color, alpha: alphaHp });
        }

        if (unit.state === 'engaging') {
          units.circle(pos.x, pos.y, 10);
          units.stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
        }

        if (selected.has(unit.id)) {
          units.circle(pos.x, pos.y, 13);
          units.stroke({ width: 1.5, color: 0xffd23f, alpha: 0.9 });
        }
      }

      overlay.clear();
      if (dragRect) {
        const x = Math.min(dragRect.x0, dragRect.x1);
        const y = Math.min(dragRect.y0, dragRect.y1);
        const w = Math.abs(dragRect.x1 - dragRect.x0);
        const h = Math.abs(dragRect.y1 - dragRect.y0);
        overlay.rect(x, y, w, h);
        overlay.fill({ color: 0xffd23f, alpha: 0.08 });
        overlay.stroke({ width: 1, color: 0xffd23f, alpha: 0.6 });
      }

      if (lanePreview && lanePreview.length >= 2) {
        overlay.moveTo(lanePreview[0].x, lanePreview[0].y);
        for (let i = 1; i < lanePreview.length; i++) overlay.lineTo(lanePreview[i].x, lanePreview[i].y);
        overlay.stroke({ width: 2, color: 0xffd23f, alpha: 0.8 });
        for (const p of lanePreview) {
          overlay.circle(p.x, p.y, 2.5);
          overlay.fill({ color: 0xffd23f, alpha: 0.8 });
        }
      }
    },

    destroy(): void {
      world.destroy({ children: true });
    },
  };
}
