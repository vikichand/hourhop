// Integration capability model (T-104). Phase A ships only two local providers. There is deliberately
// no Karbon provider: Karbon's public API documents no per-user auth and no time-entry write.
// `karbon-approved` gets added only after Phase B/C approval; nothing here makes network requests.

import type { ProfileId } from '../domain/types';

export interface ProviderInfo {
  id: ProfileId;
  label: string; // shown in the header status
  description: string;
  /** Source label for "recorded" budget actuals. Never "Karbon" for synthetic or manual data. */
  recordedLabel: string;
  canEditCatalog: boolean;
  readsKarbon: false;
  submitsToKarbon: false;
}

export const PROVIDERS: Record<ProfileId, ProviderInfo> = {
  sample: {
    id: 'sample',
    label: 'Sample data',
    description: 'Synthetic demonstration clients and budgets. Nothing here is real client data.',
    recordedLabel: 'Sample recorded',
    canEditCatalog: false,
    readsKarbon: false,
    submitsToKarbon: false,
  },
  local: {
    id: 'local',
    label: 'Local only',
    description: 'Clients and work items you add yourself. Stored only in this browser profile.',
    recordedLabel: 'Recorded',
    canEditCatalog: true,
    readsKarbon: false,
    submitsToKarbon: false,
  },
};
