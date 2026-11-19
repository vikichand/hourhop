// Integration capability model. Sample and Local never touch the network. Karbon reads the user's assigned
// work through Karbon's official API v3 with the firm's own keys (src/integrations/karbon.ts); it never
// writes, because the API has no endpoint for creating time entries.

import type { ProfileId } from '../domain/types';

export interface ProviderInfo {
  id: ProfileId;
  label: string; // shown in the header status
  description: string;
  /** Source label for "recorded" budget actuals. Never "Karbon" for synthetic or manual data. */
  recordedLabel: string;
  canEditCatalog: boolean;
  readsKarbon: boolean;
  /** Always false: Karbon's API has no way to create time entries (see docs/roadmap.md). */
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
  karbon: {
    id: 'karbon',
    label: 'Karbon',
    description: 'Your assigned work, synced read-only from Karbon. Time is saved on this device; enter it in Karbon with Copy for Karbon.',
    recordedLabel: 'Karbon recorded',
    canEditCatalog: false,
    readsKarbon: true,
    submitsToKarbon: false,
  },
};
