import { APP } from '../../app-meta';
import { toCsv, toJson } from '../../domain/export';
import type { ProfileId } from '../../domain/types';
import { getLedger } from '../app-state';

/** Saves the profile's sessions as a file via a local blob URL. Returns a status message. */
export async function downloadExport(profile: ProfileId, format: 'csv' | 'json'): Promise<string> {
  const sessions = await (await getLedger()).allSessions(profile);
  const nowIso = new Date().toISOString();
  const body = format === 'csv' ? toCsv(sessions) : toJson(sessions, nowIso, APP.version);
  const blob = new Blob([body], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hourhop-${profile}-${nowIso.slice(0, 10)}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `Exported ${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} from ${profile === 'sample' ? 'sample data' : 'local data'} as ${format.toUpperCase()}.`;
}
