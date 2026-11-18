import { expect, it } from 'vitest';
import { latestOnly } from '../src/ui/latest';

it('an older read that resolves last does not overwrite the newer result [KWS-033]', async () => {
  const run = latestOnly();
  let applied: string[] = [];
  let resolveOld!: (v: string) => void;
  const old = run(new Promise<string>((r) => (resolveOld = r)), (v) => applied.push(v), () => {});
  const fresh = run(Promise.resolve('new'), (v) => applied.push(v), () => {});
  await fresh;
  resolveOld('old');
  await old;
  expect(applied).toEqual(['new']);
});
