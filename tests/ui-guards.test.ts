// Architecture guards (docs/design.md; KWS-035, KWS-036, T-102, T-105). These fail the
// build when a view grows its own control, palette or brand string, or when Phase A scope creeps.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]));
}
const src = walk('src').map((f) => ({ f: f.replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));
const ui = src.filter(({ f }) => /\.(tsx|ts)$/.test(f) && f.startsWith('src/ui/'));
const code = (t: string) => t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('one shared component system', () => {
  it('only components.tsx renders raw form controls or dialogs', () => {
    for (const { f, text } of ui.filter(({ f }) => !f.endsWith('src/ui/components.tsx'))) {
      expect(code(text), f).not.toMatch(/<(button|input|select|textarea|dialog)\b/);
    }
  });

  it('only tokens.css holds raw colour, size and font values', () => {
    for (const { f, text } of src.filter(({ f }) => f.endsWith('.css') && !f.endsWith('tokens.css'))) {
      const c = code(text).replace(/@media[^{]*/g, ''); // breakpoints cannot use var()
      expect(c, `${f}: hex colour`).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(c, `${f}: rgb/hsl colour`).not.toMatch(/\b(rgba?|hsla?|oklch)\(/);
      expect(c, `${f}: px literal`).not.toMatch(/\d+px/);
      expect(c, `${f}: ms literal`).not.toMatch(/\d+m?s\b/);
      expect(c, `${f}: font family`).not.toMatch(/font-family:(?!\s*var\()/);
    }
  });

  it('inline styles hold no raw colour or pixel values (tokens or computed percentages only)', () => {
    for (const { f, text } of ui) {
      for (const m of code(text).matchAll(/style=\{\{([^}]*)\}\}/g)) expect(m[1], f).not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(|\d+px/i);
    }
  });

  it('glass and gradients come only from tokens; no notched borders or ambient animation', () => {
    for (const { f, text } of src.filter(({ f }) => f.endsWith('.css'))) {
      expect(text, f).not.toMatch(/clip-path|@keyframes|animation:/);
    }
    const app = code(src.find(({ f }) => f.endsWith('src/ui/app.css'))!.text);
    // Every gradient in the component layer is built from tokens, never literal colours.
    for (const g of app.matchAll(/(linear|radial)-gradient\(([^;]*)\)/g)) expect(g[2]).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(/i);
  });
});

describe('Phase A scope [KWS-035, KWS-017]', () => {
  it('ships no microphone, speech, AI, network or Karbon-session code', () => {
    for (const { f, text } of src.filter(({ f }) => /\.(tsx?|html)$/.test(f))) {
      const c = code(text).replace(/@media[^{]*/g, ''); // breakpoints cannot use var()
      expect(c, f).not.toMatch(/getUserMedia|SpeechRecognition|webkitSpeech|MediaRecorder|LanguageModel|\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|document\.cookie|chrome\.cookies|innerHTML|dangerouslySetInnerHTML/);
    }
  });

  it('never marks anything confirmed in Karbon: no code path sets confirmed status or an official entry id', () => {
    for (const { f, text } of src.filter(({ f }) => /\.tsx?$/.test(f))) {
      expect(code(text), f).not.toMatch(/submissionStatus:\s*'(confirmed|pending)'|officialEntryId:\s*\S/);
    }
  });
});

describe('centralized product identity [T-105]', () => {
  it('brand strings come from app-meta.ts', () => {
    for (const { f, text } of src.filter(({ f }) => /\.tsx?$/.test(f) && !f.endsWith('app-meta.ts'))) {
      expect(code(text), f).not.toMatch(/HourHop/);
    }
  });
});
