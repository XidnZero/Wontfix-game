/**
 * Per-unit combat/movement numbers, derived from chassis or (for foot units)
 * from the squad they carry. Centralised here so targeting, combat and
 * movement agree on what a unit can do without duplicating the chassis-vs-foot
 * branch in three places.
 */

import * as C from '../config';
import type { MissionState, Squad, Unit } from '../types';

export function findSquad(state: MissionState, unit: Unit): Squad | null {
  if (unit.squadId === null) return null;
  return state.squads.find((s) => s.id === unit.squadId) ?? null;
}

export function unitSpeed(unit: Unit): number {
  const base = unit.chassis !== null ? (C.CHASSIS_SPEED[unit.chassis] ?? C.FOOT_SPEED) : C.FOOT_SPEED;
  return base * C.GLOBAL_SPEED_MULTIPLIER;
}

export function unitRange(unit: Unit): number {
  if (unit.chassis !== null) return C.CHASSIS_RANGE[unit.chassis] ?? 0;
  return C.FOOT_RANGE;
}

/**
 * Firmware-wipe and reclaim penalties are stubbed for the vertical slice (see
 * README's build order) — every vehicle currently fights at full strength
 * regardless of `firmware`/`reclaimExposure`. Wire `WIPED_VEHICLE_PENALTY` in
 * here once reboot/reclaim/firmware-wipe are implemented.
 */
export function unitDamage(state: MissionState, unit: Unit): number {
  let base: number;
  if (unit.chassis !== null) {
    base = C.CHASSIS_DAMAGE[unit.chassis] ?? 0;
  } else {
    const squad = findSquad(state, unit);
    base = squad ? C.FOOT_DAMAGE_PER_BODY[squad.kind] * squad.bodies : 0;
  }
  return unit.owner === 'ai' ? base * C.AI_DAMAGE_MULTIPLIER : base;
}

export function maxHpFor(chassis: Unit['chassis'], bodies: number): number {
  if (chassis !== null) return C.CHASSIS_HP[chassis] ?? 100;
  return bodies * C.FOOT_HP_PER_BODY;
}
