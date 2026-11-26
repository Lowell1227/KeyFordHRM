import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = process.argv[2];
if (!output || !resolve(output).includes(`${process.platform === 'win32' ? '\\' : '/'}test-results${process.platform === 'win32' ? '\\' : '/'}capacity${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('capacity-output-required');
const samples = [];
for (let attempt = 0; attempt < 3; attempt += 1) {
  if (attempt) await new Promise((done) => setTimeout(done, 15000));
  for (const baseURL of ['http://127.0.0.1', 'https://1260cw31az927.vicp.fun']) {
    const start = performance.now();
    try {
      const page = await fetch(`${baseURL}/login`, { signal: AbortSignal.timeout(15000) });
      const html = await page.text();
      const script = html.match(/src="(\/assets\/index-[^"?]+\.js)"/)?.[1];
      if (!page.ok || !script) throw new Error('unexpected-page');
      const htmlMs = performance.now() - start;
      const assetStart = performance.now();
      const response = await fetch(`${baseURL}${script}`, { signal: AbortSignal.timeout(15000) });
      const headerMs = performance.now() - assetStart;
      const bytes = (await response.arrayBuffer()).byteLength;
      samples.push({ attempt: attempt + 1, channel: baseURL.startsWith('https') ? 'public' : 'loopback', status: response.status,
        htmlMs, assetHeaderMs: headerMs, assetTotalMs: performance.now() - assetStart,
        decodedBytes: bytes, encoding: response.headers.get('content-encoding'), at: new Date().toISOString() });
    } catch { samples.push({ attempt: attempt + 1, channel: baseURL.startsWith('https') ? 'public' : 'loopback', error: 'read-failed', at: new Date().toISOString() }); }
  }
}
writeFileSync(output, JSON.stringify({ scope: 'six-anonymous-read-pairs-not-public-load', samples }, null, 2));
console.log(JSON.stringify(samples));
