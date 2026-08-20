import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const manualURL = process.env.MANUAL_URL ?? 'http://localhost:5173/manual/index.html';
const outputDir = await mkdtemp(join(tmpdir(), 'kayford-manual-qa-'));
const browser = await chromium.launch({ headless: true });
const errors = [];

async function captureErrors(page) {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
}

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const desktopPage = await desktop.newPage();
await captureErrors(desktopPage);
await desktopPage.goto(manualURL, { waitUntil: 'networkidle' });

await assert.rejects(
  async () => desktopPage.getByRole('heading', { name: '不存在的手册标题' }).waitFor({ timeout: 250 }),
  /Timeout/,
  'The heading check must fail when the expected heading is absent.',
);

await desktopPage.getByRole('heading', { name: /孚德绩效管理系统/ }).waitFor();
assert.equal(await desktopPage.locator('.toc a').count(), 11, 'The manual should have 11 navigation entries.');
assert.equal(await desktopPage.locator('.image-button').count(), 16, 'The manual should present 16 zoomable system figures.');
assert.ok(await desktopPage.locator('.accept-check').count() >= 30, 'The acceptance checklist should be complete.');

await desktopPage.screenshot({ path: join(outputDir, 'manual-desktop.png'), fullPage: false });

const manualImages = desktopPage.locator('img:not(#dialog-image)');
for (let index = 0; index < await manualImages.count(); index += 1) {
  const image = manualImages.nth(index);
  await image.scrollIntoViewIfNeeded();
  await image.waitFor({ state: 'visible' });
  await image.evaluate((element) => element.decode());
  assert.ok(await image.evaluate((element) => element.naturalWidth), `Image ${index + 1} should load.`);
}

const firstFigure = desktopPage.locator('.image-button').first();
await firstFigure.click();
await desktopPage.locator('#image-dialog[open]').waitFor();
assert.ok(await desktopPage.locator('#dialog-image').getAttribute('src'), 'The image dialog should contain a source.');
await desktopPage.locator('.dialog-close').click();

const firstCheck = desktopPage.locator('.accept-check').first();
await firstCheck.check();
assert.notEqual(await desktopPage.locator('#progress-label').innerText(), '0%', 'Checking an item should update progress.');
await desktopPage.reload({ waitUntil: 'networkidle' });
assert.equal(await desktopPage.locator('.accept-check').first().isChecked(), true, 'Acceptance progress should persist after refresh.');
await desktopPage.evaluate(() => localStorage.removeItem('kayford.manual.acceptance.v1'));
await desktop.close();

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mobilePage = await mobile.newPage();
await captureErrors(mobilePage);
await mobilePage.goto(manualURL, { waitUntil: 'networkidle' });
const mobileToggle = mobilePage.locator('.mobile-nav-toggle');
assert.equal(await mobileToggle.isVisible(), true, 'The mobile table-of-contents button should be visible.');
await mobileToggle.click();
assert.ok((await mobilePage.locator('#manual-sidebar').getAttribute('class')).includes('open'), 'The mobile menu should open.');
await mobilePage.screenshot({ path: join(outputDir, 'manual-mobile.png'), fullPage: false });
await mobile.close();

await browser.close();
assert.deepEqual(errors, [], `The manual should not emit browser errors: ${errors.join('; ')}`);

console.log(JSON.stringify({ manualURL, outputDir, checks: 'passed' }, null, 2));
