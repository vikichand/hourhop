// Wholly synthetic demonstration catalog (T-103/T-104). Names are invented. Covers every client kind,
// recurring work with the same title (distinct keys), each budget state, completed work, and hostile text.

import { normalizeTimeEstimates } from '../domain/budget';
import type { BudgetInfo, Client, WorkItem } from '../domain/types';

const P = 'sample' as const;

export function sampleCatalog(nowMs: number): { clients: Client[]; work: WorkItem[] } {
  const asOf = new Date(nowMs - 25 * 60_000).toISOString();
  const day = (offset: number) => new Date(nowMs + offset * 86_400_000).toISOString().slice(0, 10);
  const time = (est: number, rec: number, scope: 'work-total' | 'user-allocation' = 'work-total'): BudgetInfo =>
    ({ kind: 'set', asOfUtc: asOf, lines: [{ kind: 'time', scope, estimateMinutes: est, recordedMinutes: rec }] });

  const clients: Client[] = [
    { key: 'org-alder', profileId: P, kind: 'Organization', name: 'Alder & Finch Joinery Ltd' },
    { key: 'org-brightwater', profileId: P, kind: 'Organization', name: 'Brightwater Dental Group' },
    { key: 'con-okafor', profileId: P, kind: 'Contact', name: 'Ngozi Okafor' },
    { key: 'con-lindqvist', profileId: P, kind: 'Contact', name: 'Sven Lindqvist' },
    { key: 'grp-harbour', profileId: P, kind: 'ClientGroup', name: 'Harbour Family Group' },
    { key: 'org-quarry', profileId: P, kind: 'Organization', name: 'Quarry Lane Bakery Cooperative (Northern Region Operations Division)' },
    { key: 'con-zhang', profileId: P, kind: 'Contact', name: '张伟 (Zhang Wei)' },
  ];

  const w = (key: string, clientKey: string, title: string, status: WorkItem['status'], budget: BudgetInfo, dueDate?: string): WorkItem =>
    ({ key, profileId: P, clientKey, title, status, budget, dueDate });

  const work: WorkItem[] = [
    w('wi-1001', 'org-alder', 'Monthly bookkeeping', 'In Progress', time(480, 195), day(6)),
    w('wi-0907', 'org-alder', 'Monthly bookkeeping', 'Completed', time(480, 470), day(-24)),
    w('wi-1002', 'org-alder', 'VAT return Q3', 'Ready To Start', time(180, 160), day(2)),
    w('wi-1003', 'org-brightwater', 'Year-end accounts 2025/26', 'In Progress',
      { kind: 'set', asOfUtc: asOf, lines: [
        { kind: 'time', scope: 'work-total', estimateMinutes: 960, recordedMinutes: 1010 },
        { kind: 'time', scope: 'user-allocation', estimateMinutes: 240, recordedMinutes: 150 },
      ] }, day(12)),
    w('wi-1004', 'org-brightwater', 'Payroll run November', 'Ready To Start', { kind: 'none', asOfUtc: asOf }, day(1)),
    w('wi-1005', 'con-okafor', 'Personal tax return 2025/26', 'Waiting',
      normalizeTimeEstimates([{ key: '0-review', minutes: 0 }], 30, 'work-total', asOf)),
    w('wi-1006', 'con-lindqvist', 'Advisory: business structure review', 'In Progress',
      { kind: 'set', asOfUtc: asOf, lines: [{ kind: 'amount', scope: 'work-total', estimateAmount: 1200, currency: 'GBP', recordedAmount: 450 }] }),
    w('wi-1007', 'grp-harbour', 'Consolidated group accounts', 'Planned', { kind: 'unavailable', reason: 'denied' }, day(30)),
    w('wi-1008', 'org-quarry', 'Catch-up bookkeeping January to September with supplier statement reconciliation and fixed asset register rebuild', 'Ready To Start', time(600, 120)),
    w('wi-1010', 'con-zhang', '年度税务申报 Annual filing', 'In Progress', time(0, 0)),
    w('wi-1011', 'org-quarry', 'Management accounts Q3', 'Ready To Start', time(300, 30), day(9)),
  ];
  return { clients, work };
}
