// Budget projection (PRD §7, ARCHITECTURE §6). Every state stays distinct: unavailable, none,
// zero, time, amount, near, over. Recorded (posted) and local unsubmitted time are never summed
// into an "official" actual, and amounts are never converted to hours.

import { minutesShort } from './time';
import type { BudgetInfo, BudgetLine, BudgetScope } from './types';

/** Raw estimate rows as a Karbon-like source reports them. Key `0-…` means "activity with no estimate". */
export interface EstimateRow { key: string; userKey?: string; minutes: number }

/** Sums comparable estimate rows. `0-` rows never become a budget; no rows at all is "none", not zero. */
export function normalizeTimeEstimates(
  rows: EstimateRow[], recordedMinutes: number, scope: BudgetScope, asOfUtc: string, userKey?: string,
): BudgetInfo {
  const real = rows.filter((r) => !r.key.startsWith('0-') && (scope === 'work-total' || r.userKey === userKey));
  if (!real.length) return { kind: 'none', asOfUtc };
  const estimateMinutes = real.reduce((a, r) => a + r.minutes, 0);
  return { kind: 'set', asOfUtc, lines: [{ kind: 'time', scope, estimateMinutes, recordedMinutes }] };
}

export type Level = 'ok' | 'near' | 'over' | 'none';
export const NEAR_RATIO = 0.8;

export interface BudgetLineView {
  title: string; // "Work budget" | "Your allocation"
  value: string; // "3h 15m / 8h 00m"
  remaining: string; // "4h 45m left" | "1h 10m over"
  /** 0..1 for a meter, only when the estimate is a real positive time budget. */
  ratio?: number;
  level: Level;
  local?: string; // "Local unsubmitted 45m" — separate, never added to recorded
  projected?: string; // "With local time: 94%"
}

export interface BudgetView {
  state: 'unavailable' | 'none' | 'set';
  summary: string;
  asOf?: string;
  lines: BudgetLineView[];
}

function scopeTitle(scope: BudgetScope) {
  return scope === 'work-total' ? 'Work budget' : 'Your allocation';
}

function lineView(line: BudgetLine, localMinutes: number, recordedLabel: string): BudgetLineView {
  if (line.kind === 'amount') {
    const fmt = (n: number) =>
      line.currency
        ? new Intl.NumberFormat(undefined, { style: 'currency', currency: line.currency }).format(n)
        : `${n.toLocaleString()} (currency unverified)`;
    const rec = line.recordedAmount;
    return {
      title: `${scopeTitle(line.scope)} (amount)`,
      value: rec === undefined ? `${fmt(line.estimateAmount)} budget` : `${fmt(rec)} / ${fmt(line.estimateAmount)}`,
      remaining: rec === undefined ? `${recordedLabel} amount unavailable` : rec > line.estimateAmount ? `${fmt(rec - line.estimateAmount)} over` : `${fmt(line.estimateAmount - rec)} left`,
      level: rec === undefined ? 'none' : rec > line.estimateAmount ? 'over' : rec >= line.estimateAmount * NEAR_RATIO ? 'near' : 'ok',
      local: localMinutes ? `Local unsubmitted ${minutesShort(localMinutes)} (time, not converted to amount)` : undefined,
    };
  }
  const { estimateMinutes: est, recordedMinutes: rec } = line;
  if (est === 0) {
    return {
      title: scopeTitle(line.scope),
      value: `${recordedLabel} ${minutesShort(rec)} / zero budget`,
      remaining: rec > 0 ? `${minutesShort(rec)} over a zero budget` : 'Zero budget set',
      level: rec > 0 ? 'over' : 'none',
      local: localMinutes ? `Local unsubmitted ${minutesShort(localMinutes)}` : undefined,
    };
  }
  const ratio = rec / est;
  const projectedRatio = (rec + localMinutes) / est;
  return {
    title: scopeTitle(line.scope),
    value: `${minutesShort(rec)} / ${minutesShort(est)}`,
    remaining: rec > est ? `${minutesShort(rec - est)} over` : `${minutesShort(est - rec)} left`,
    ratio: Math.min(1, ratio),
    level: ratio > 1 ? 'over' : ratio >= NEAR_RATIO ? 'near' : 'ok',
    local: localMinutes ? `Local unsubmitted ${minutesShort(localMinutes)}` : undefined,
    projected: localMinutes ? `With local time: ${Math.round(projectedRatio * 100)}% of budget` : undefined,
  };
}

/**
 * @param recordedLabel source of the recorded actuals, e.g. "Sample recorded". Never "Karbon recorded"
 * unless the data truly came from an approved Karbon read.
 */
export function budgetView(info: BudgetInfo, localMinutes: number, recordedLabel: string): BudgetView {
  if (info.kind === 'unavailable') {
    const why = { 'not-connected': 'not connected to Karbon', denied: 'you do not have access', error: 'could not be loaded' }[info.reason];
    return { state: 'unavailable', summary: `Budget unavailable: ${why}`, lines: [] };
  }
  const asOf = new Date(info.asOfUtc).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  if (info.kind === 'none') return { state: 'none', summary: 'No budget set', asOf, lines: [] };
  const lines = info.lines.map((l) => lineView(l, localMinutes, recordedLabel));
  const worst = lines.some((l) => l.level === 'over') ? 'Over budget' : lines.some((l) => l.level === 'near') ? 'Near budget' : 'Within budget';
  return { state: 'set', summary: worst, asOf, lines };
}

/** One short phrase for a work row, or undefined when nothing true can be said. */
export function budgetHint(info: BudgetInfo): string | undefined {
  if (info.kind === 'none') return 'No budget';
  if (info.kind !== 'set') return undefined;
  const l = info.lines.find((x) => x.scope === 'work-total') ?? info.lines[0];
  if (!l) return undefined;
  if (l.kind === 'amount') return 'Amount budget';
  if (l.estimateMinutes === 0) return 'Zero budget';
  const r = l.recordedMinutes / l.estimateMinutes;
  return r > 1 ? 'Over budget' : r >= NEAR_RATIO ? 'Near budget' : `Budget ${minutesShort(l.estimateMinutes)}`;
}
