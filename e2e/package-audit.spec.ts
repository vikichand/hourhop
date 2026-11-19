import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { EXT_PATH, expect, rowAction, sampleMode, test } from './fixtures';

// Audits the PACKAGED build in .output/chrome-mv3, not the source. [KWS-017, KWS-020, KWS-030, KWS-035]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? files(path.join(dir, f)) : [path.join(dir, f)]));
}

test('manifest requests only sidePanel and Karbon\'s official API host: no content scripts, background worker or remote code', () => {
  const m = JSON.parse(readFileSync(path.join(EXT_PATH, 'manifest.json'), 'utf8'));
  expect(m.manifest_version).toBe(3);
  expect(m.permissions).toEqual(['sidePanel']);
  expect(m.optional_permissions).toBeUndefined();
  expect(m.host_permissions).toEqual(['https://api.karbonhq.com/*']);
  expect(m.content_scripts).toBeUndefined();
  expect(m.background).toBeUndefined();
  expect(m.web_accessible_resources).toBeUndefined();
  expect(m.externally_connectable).toBeUndefined();
  expect(m.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src 'self' https://api.karbonhq.com");
  expect(m.description).toContain('Not affiliated with or endorsed by Karbon');
  expect(m.name).toBe('HourHop');
});

test('bundle has no eval, microphone, speech or AI code, no URL but Karbon\'s API, and no reference image', () => {
  const all = files(EXT_PATH);
  const js = all.filter((f) => /\.(js|html)$/.test(f)).map((f) => [f, readFileSync(f, 'utf8')] as const);
  const forbidden = [
    /XMLHttpRequest/, /new WebSocket/, /sendBeacon/, /EventSource/, /\beval\s*\(/, /new Function\s*\(/,
    /getUserMedia/, /SpeechRecognition/, /webkitSpeech/, /MediaRecorder/, /\bLanguageModel\b/, /\bai\.(languageModel|summarizer)/,
    /https?:\/\/(?!www\.w3\.org|api\.karbonhq\.com\b)/, /app\d*\.karbonhq\.com/i,
  ];
  for (const [f, src] of js) for (const re of forbidden) expect(re.test(src), `${path.basename(f)} matches ${re}`).toBe(false);
  // fetch() exists only in the chunk that holds the Karbon client, and only alongside its pinned origin.
  for (const [f, src] of js.filter(([, src]) => /\bfetch\s*\(/.test(src))) expect(src, path.basename(f)).toContain('https://api.karbonhq.com');
  // R0 reference image must never ship (docs/design.md §2).
  expect(all.some((f) => /\.(jpe?g|webp|gif)$/i.test(f))).toBe(false);
  // The reference lives in the private, untracked myDocs/; compare hashes when it is present.
  const ref = 'myDocs/references/1000083021.jpg';
  if (existsSync(ref)) {
    const r0 = createHash('sha256').update(readFileSync(ref)).digest('hex');
    for (const f of all) expect(createHash('sha256').update(readFileSync(f)).digest('hex')).not.toBe(r0);
  }
});

test('a full session makes no network request outside the extension and registers no service worker', async ({ context, open }) => {
  const external: string[] = [];
  context.on('request', (r) => { if (!/^(chrome-extension|data|blob):/.test(r.url())) external.push(r.url()); });
  const p = await sampleMode(open);
  await rowAction(p, 'Alder & Finch Joinery Ltd', 'VAT return Q3').click();
  await p.getByRole('button', { name: 'Pause', exact: true }).click();
  await p.getByRole('button', { name: 'Resume', exact: true }).click();
  await p.getByRole('button', { name: 'Stop', exact: true }).click();
  const review = await open('review.html');
  await review.getByText('VAT return Q3').first().waitFor();
  await open('options.html');
  await p.waitForTimeout(500);
  expect(external).toEqual([]);
  expect(context.serviceWorkers()).toEqual([]);
});
