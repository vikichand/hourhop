import { IDBFactory } from 'fake-indexeddb';
import { openLedger } from '../src/storage/ledger';
import type { NewSessionInput } from '../src/domain/timer';
import type { ProfileId } from '../src/domain/types';

export const T0 = Date.parse('2026-11-19T09:00:00Z');
export const MIN = 60_000;

export function input(id: string, work: string, tenantId: ProfileId = 'sample'): NewSessionInput {
  return {
    id,
    target: { kind: 'work-item', tenantId, clientKind: 'Organization', clientId: 'org-1', workItemId: work },
    label: { client: 'Client 1', work: `Work ${work}` },
    timeZone: 'UTC',
  };
}

/** A fresh in-memory IndexedDB with a controllable clock, opened by `n` independent connections. */
export async function ledgers(n = 1, profile: ProfileId = 'sample') {
  const factory = new IDBFactory();
  const clock = { now: T0 };
  const list = [];
  for (let i = 0; i < n; i++) list.push(await openLedger(factory, () => clock.now));
  await list[0]!.setProfile(profile);
  return { factory, clock, list, l: list[0]! };
}
