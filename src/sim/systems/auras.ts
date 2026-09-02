/**
 * Auras — stubbed for the vertical slice (README). The jammer chassis exists
 * in config/types but nothing recomputes `effectiveVersion` or reclaim
 * eligibility from JAMMER_RADIUS coverage yet. Must precede targeting once
 * implemented, so a rollback affects this tick's decisions, not next tick's.
 */

import type { TickContext } from '../sim';

export function stepAuras(_ctx: TickContext): void {
  // No-op. See file header.
}
