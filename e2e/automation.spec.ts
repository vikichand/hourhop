import { choose, expect, rowAction, sampleMode, spills, test } from './fixtures';

// Reckonry-style timer features: background badge, presets, timer settings and "start now, choose later".

test('toolbar badge follows the timer from the background helper: running minutes, II when paused, empty when stopped', async ({ context, open }) => {
  const p = await sampleMode(open);
  const sw = context.serviceWorkers().find((w) => w.url().endsWith('/background.js')) ?? await context.waitForEvent('serviceworker');
  const badge = () => sw.evaluate(() => (globalThis as any).chrome.action.getBadgeText({}));
  await rowAction(p, 'Alder & Finch Joinery Ltd', 'VAT return Q3').click();
  await expect.poll(badge).toBe('0m');
  await p.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(badge).toBe('II');
  await p.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(badge).toBe('');
});

test('timer settings save; a preset sets role and task type on the running timer in one click', async ({ open }) => {
  const p = await sampleMode(open);
  const s = await open('options.html');
  await s.setViewportSize({ width: 1100, height: 1400 });
  await choose(s, 'Pause when idle (no keyboard or mouse)', 'After 10 minutes');
  await s.getByLabel("Resume when I'm back (only after an automatic pause)").check();
  await s.getByLabel('Preset name').fill('Client meeting');
  await s.getByLabel('Role').fill('Senior');
  await s.getByLabel('Task type').fill('Meeting');
  await s.getByRole('button', { name: 'Add preset' }).click();
  await expect(s.getByText('Client meeting')).toBeVisible();
  await s.reload();
  await expect(s.getByRole('combobox', { name: 'Pause when idle (no keyboard or mouse)' })).toHaveText('After 10 minutes');
  await expect(s.getByLabel("Resume when I'm back (only after an automatic pause)")).toBeChecked();
  expect(await spills(s)).toEqual([]);

  await p.bringToFront();
  await rowAction(p, 'Alder & Finch Joinery Ltd', 'VAT return Q3').click();
  const preset = p.getByRole('group', { name: 'Presets: role and task type' }).getByRole('button', { name: 'Client meeting' });
  await expect(preset).toHaveAttribute('aria-pressed', 'false');
  await preset.click();
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
  await expect(p.getByText('Role: Senior, Task type: Meeting')).toBeVisible();
  for (const w of [320, 400]) { await p.setViewportSize({ width: w, height: 900 }); expect(await spills(p), `panel @${w}px`).toEqual([]); }
});

test('start now, choose later: the work item is picked at stop, or later from Review', async ({ open }) => {
  const p = await sampleMode(open, 320);
  await p.getByRole('button', { name: 'Start now, choose the work later' }).click();
  await expect(p.locator('.tracking .work-title')).toHaveText('Choose the work item when you stop');
  await p.getByRole('button', { name: 'Stop', exact: true }).click();
  const dlg = p.getByRole('dialog', { name: 'Which work was this?' });
  await dlg.getByRole('searchbox', { name: 'Search work items' }).fill('payroll');
  await dlg.getByRole('button', { name: /Brightwater Dental Group: Payroll run November/ }).click();
  await expect(dlg).toHaveCount(0);

  // A second one is left for later and assigned from Review.
  await p.getByRole('button', { name: 'Start now, choose the work later' }).click();
  await p.getByRole('button', { name: 'Stop', exact: true }).click();
  await p.getByRole('dialog', { name: 'Which work was this?' }).getByRole('button', { name: 'Choose later' }).click();
  const r = await open('review.html');
  await r.setViewportSize({ width: 1100, height: 1000 });
  await expect(r.getByText('Payroll run November').first()).toBeVisible();
  await r.getByRole('button', { name: 'Choose work' }).click();
  await r.getByRole('dialog', { name: 'Which work was this?' }).getByRole('button', { name: /VAT return Q3/ }).click();
  await expect(r.getByRole('button', { name: 'Choose work' })).toHaveCount(0);
  await expect(r.getByText('VAT return Q3').first()).toBeVisible();
});
