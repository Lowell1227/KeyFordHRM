const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
for (const config of ['nginx/default.conf', '../deploy/nginx/conf.d/app.conf']) {
  test(`${config} keeps bearer URLs out of proxy access/error logs`, () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', config), 'utf8');
    for (const prefix of ['/talents/s/', '/api/v1/talents/shares/']) {
      const index = source.indexOf(`location ^~ ${prefix} {`);
      assert.ok(index >= 0, `Dedicated location required for ${prefix}`);
      const block = source.slice(index, source.indexOf('\n    }', index));
      assert.match(block, /access_log off;/);
      assert.match(block, /error_log \/dev\/null crit;/);
      assert.match(block, /no-store/);
      assert.match(block, /no-referrer/);
      assert.match(block, /noindex/);
    }
  });
}
