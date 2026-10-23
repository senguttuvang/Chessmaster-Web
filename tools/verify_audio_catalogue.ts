/** Real-media capability checks; run after recover_audio.py and serving its catalogue. */
import { chromium, expect } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:9060';
if (!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(url)) throw new Error('Use the local catalogue loopback URL');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const output = new URL('../output/audio-catalogue/', import.meta.url).pathname;
await Bun.$`mkdir -p ${output}`;
const failures: string[] = [];
page.on('pageerror', error => failures.push(error.message));
const checks: object[] = [];
try {
  await page.goto(url);
  await expect(page.locator('#search')).toBeEnabled({ timeout: 30_000 });
  const data = await page.evaluate(async () => (await fetch('index.json')).json());
  for (const group of Object.keys(data.summary.groups)) {
    await page.locator('#group').selectOption(group);
    const clip = data.clips.find((c: { group: string }) => c.group === group);
    await page.locator('#results button').first().click();
    await expect(page.locator('#name')).toHaveText(clip.name);
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')!;
      return Number.isFinite(audio.duration) && audio.readyState >= 2;
    });
    const duration = await page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).duration);
    expect(Math.abs(duration - clip.metadata.duration), `${clip.id} duration`).toBeLessThan(0.1);
    await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('audio')!.currentTime > 0.05);
    await expect(page.locator('#playback-error')).toBeEmpty();
    await page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).pause());
    checks.push({ group, clip: clip.id, declaredDuration: clip.metadata.duration, browserDuration: duration, played: true });
  }
  await page.locator('#group').selectOption('');
  await page.locator('#search').fill('ANL_001');
  await expect(page.locator('#count')).toHaveText('1 matching clips');
  await expect(page.locator('#ref-count')).toContainText('original W directives');
  await page.locator('#search').fill('there is no such original clip');
  await expect(page.locator('#count')).toHaveText('0 matching clips');
  await expect(page.locator('#play')).toBeDisabled();
  await page.locator('#search').fill('');
  await page.locator('#defects').check();
  await expect(page.locator('#count')).toHaveText('47 matching clips');
  await expect(page.locator('#notice')).toBeVisible();
  await page.locator('#defects').uncheck();
  await page.locator('#group').selectOption('tutorial');
  await page.locator('#search').fill('ANL_001');
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  for (const [name, width] of [['mobile', 390], ['reflow', 640]] as const) {
    const capture = await browser.newPage({ viewport: { width, height: 850 } });
    try {
      await capture.goto(url);
      await expect(capture.locator('#search')).toBeEnabled();
      await capture.locator('#group').selectOption('tutorial');
      await capture.locator('#search').fill('ANL_001');
      await capture.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      expect(await capture.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} overflow`).toBe(true);
      await capture.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    } finally { await capture.close(); }
  }
  // A missing asset must produce a visible playback error, not a fake success.
  await page.route('**/audio/**', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.locator('audio').evaluate(element => { const audio = element as HTMLAudioElement; audio.src += '?missing=1'; audio.load(); });
  await expect(page.locator('#playback-error')).toContainText('could not be loaded');
  await page.unroute('**/audio/**');
  await page.route('**/index.json', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.reload();
  await expect(page.locator('#status')).toContainText('Audio index unavailable');
  await expect(page.locator('#search')).toBeDisabled();
  expect(failures).toEqual([]);
  await Bun.write(`${output}/verification.json`, JSON.stringify({ url, checks, search: true, empty: true, defects: true, reflow: true, missingAudio: true, missingIndex: true, pageErrors: failures }, null, 2) + '\n');
  console.log(`Audio catalogue: ${checks.length} source groups decoded and played; search, defects, reflow and failures passed.`);
} finally { await browser.close(); }
