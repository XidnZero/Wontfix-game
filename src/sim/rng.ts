/**
 * Deterministic PRNG (mulberry32).
 *
 * `Math.random` must never appear anywhere under src/sim. A single call to it
 * breaks replay, breaks save/resume, and makes a balance bug unreproducible.
 *
 * The generator state lives inside MissionState so it is captured by any
 * snapshot, which is why these are free functions over a holder rather than a
 * class with private state.
 */

export interface RngHolder {
  rngState: number;
}

/** Uniform in [0, 1). */
export function random(h: RngHolder): number {
  h.rngState = (h.rngState + 0x6d2b79f5) | 0;
  let t = h.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max] inclusive. */
export function randomInt(h: RngHolder, min: number, max: number): number {
  return min + Math.floor(random(h) * (max - min + 1));
}

export function randomPick<T>(h: RngHolder, arr: readonly T[]): T {
  return arr[randomInt(h, 0, arr.length - 1)];
}

/**
 * In-place Fisher-Yates. Use this anywhere iteration order could otherwise
 * depend on insertion order in a way that leaks into gameplay.
 */
export function shuffle<T>(h: RngHolder, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(h, 0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
