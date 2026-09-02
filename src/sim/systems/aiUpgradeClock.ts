/**
 * AI version pressure. Grace period, then one upgrade per
 * AI_UPGRADE_INTERVAL_TICKS until Final. Never causes a loss directly — it
 * only raises what stepAiPlanning (stubbed for the vertical slice) would act
 * on once it exists.
 */

import * as C from '../config';
import type { TickContext } from '../sim';
import { AiVersion } from '../types';

export function stepAiUpgradeClock(ctx: TickContext): void {
  const ai = ctx.state.ai;
  if (ai.version >= AiVersion.Final) return;

  ai.upgradeTimer++;
  if (ai.upgradeTimer < C.AI_UPGRADE_GRACE_TICKS) return;

  if ((ai.upgradeTimer - C.AI_UPGRADE_GRACE_TICKS) % C.AI_UPGRADE_INTERVAL_TICKS !== 0) return;

  ai.version = Math.min(AiVersion.Final, ai.version + 1);
  ctx.events.push({ type: 'AiVersionUpgraded', version: ai.version });
}
