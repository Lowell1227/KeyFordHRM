import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const apiLog = [];
page.on('response', async (res) => {
  const url = res.url();
  if (url.includes('/api/v1/cycles') && !url.includes('auth')) {
    let body = '';
    try { body = (await res.text()).slice(0, 400); } catch {}
    apiLog.push(`${res.status()} ${url} :: ${body}`);
  }
});
await page.goto('http://localhost/login');
await page.waitForTimeout(1200);
await page.click('text=密码登录');
await page.waitForTimeout(600);
await page.fill('input[placeholder="工号"]', '312');
await page.fill('input[placeholder="密码"]', '000000');
await page.keyboard.press('Enter');
await page.waitForTimeout(3000);
await page.goto('http://localhost/calibration');
await page.waitForTimeout(3000);
console.log('cycle select options:', JSON.stringify(await page.$$eval('.el-select-dropdown__item, [data-testid]', els => els.slice(0,10).map(e => e.textContent.trim()))));
const txt = await page.$eval('body', e => e.innerText.replace(/\s+/g, ' ').slice(0, 500));
console.log('PAGE TEXT:', txt);
console.log('API:', JSON.stringify(apiLog, null, 1));
await page.screenshot({ path: 'calibration.png', fullPage: false });
await browser.close();
