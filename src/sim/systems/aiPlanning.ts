/**
 * AI planning — stubbed for the vertical slice (README: "AI versioning ...
 * can stay stubbed through the whole vertical slice"). v1 lanes are seeded
 * once at mission setup and never redrawn; dynamic replanning is what
 * distinguishes v2 (commandeers vehicles) and later versions, and none of
 * that is needed to answer the three questions the slice exists to answer.
 */

import type { TickContext } from '../sim';

export function stepAiPlanning(_ctx: TickContext): void {
  // No-op. See file header.
}
