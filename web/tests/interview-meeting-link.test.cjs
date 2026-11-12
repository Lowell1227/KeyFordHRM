const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

const filename = path.resolve(__dirname, '../src/views/talent/interview-meeting-link.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { extractTencentMeetingLink, safeTencentMeetingLink } = loaded.exports;
const link = 'https://meeting.tencent.com/dm/synthetic-f5';

for (const text of [link, `Join the meeting:\n${link}\nMeeting ID: 123-456-789`,
  `\u70b9\u51fb\u5165\u4f1a\uff1a\uff08${link}\uff09\u3002`,
  `Join: (${link}).`, `<${link}>`, `"${link}"`, `[Join](${link})`,
]) {
  test(`extracts a complete invitation link without surrounding punctuation: ${JSON.stringify(text)}`, () => {
    assert.deepEqual(extractTencentMeetingLink(text), { status: 'single', url: link });
  });
}

test('preserves query parameters and fragments and normalizes only the URL', () => {
  assert.deepEqual(extractTencentMeetingLink('Join: HTTPS://MEETING.TENCENT.COM:443/dm/synthetic-f5?pwd=a%2Bb&from=invite#join'), {
    status: 'single', url: `${link}?pwd=a%2Bb&from=invite#join`,
  });
});

for (const value of [
  'http://meeting.tencent.com/dm/f5', 'ftp://meeting.tencent.com/dm/f5',
  'https://meeting.tencent.com.evil.test/dm/f5', 'https://evil.test/meeting.tencent.com/dm/f5',
  'https://user:secret@meeting.tencent.com/dm/f5', 'https://@meeting.tencent.com/dm/f5',
  'https://meeting.tencent.com@evil.test/dm/f5', 'https://meeting.tencent.com:8443/dm/f5',
  'https://meeting.tencent.com\\@evil.test/dm/f5', 'https://meeting.tencent.com/dm/a\\b',
  'https://meeting.ten\tcent.com/dm/f5', `https://meeting.tencent.com/dm/f5\u0000`,
  `https://meeting.tencent.com/dm/f5\u007f`, 'https://meeting.tencent.com/dm/a%0Ab',
  `https://meeting.tencent.com/dm/f5\u0085`, `https://meeting.tencent.com/dm/f5\u202e`,
  'https://meeting.tencent.com/dm/a%5Cb', 'https://meeting.tencent.com./dm/f5',
  'https://meeting.tencent.com\u3002evil.test/dm/f5', 'https://%6deeting.tencent.com/dm/f5',
  'https:///meeting.tencent.com/dm/f5', 'https:/meeting.tencent.com/dm/f5',
  'https://meeting.tencent.com:bad/dm/f5', 'javascript:alert(1)',
  'https://[meeting.tencent.com]/dm/f5', `https://meeting.tencent.com/dm/${'a'.repeat(1000)}`,
]) {
  test(`rejects unsafe or malformed links without repairing them: ${JSON.stringify(value).slice(0, 120)}`, () => {
    assert.equal(safeTencentMeetingLink(value), null);
    assert.deepEqual(extractTencentMeetingLink(`Join: ${value}`), { status: 'none' });
  });
}

test('does not extract an official URL nested inside an unrelated URL or executable scheme', () => {
  for (const text of [`https://evil.test/?next=${link}`, `javascript:${link}`, `prefix${link}`]) {
    assert.deepEqual(extractTencentMeetingLink(text), { status: 'none' });
  }
});

test('no link keeps the manual path available', () => {
  for (const text of ['', 'Meeting ID: 123-456-789', '<script>alert(1)</script>']) {
    assert.deepEqual(extractTencentMeetingLink(text), { status: 'none' });
  }
});

test('multiple links, including repeated links, require a manual choice', () => {
  for (const text of [`${link}\nhttps://meeting.tencent.com/dm/other`, `${link} ${link}`,
    `${link},https://meeting.tencent.com/dm/other`, `${link}\uff0chttps://meeting.tencent.com/dm/other`,
    `(${link});(https://meeting.tencent.com/dm/other)`,
  ]) {
    assert.deepEqual(extractTencentMeetingLink(text), { status: 'multiple' });
  }
});

test('an unrelated or spoof URL does not count as a second official link', () => {
  assert.deepEqual(extractTencentMeetingLink(`https://meeting.tencent.com.evil.test/dm/no\n${link}`), { status: 'single', url: link });
});

test('manual link validation permits one official URL but never an invitation paragraph', () => {
  assert.equal(safeTencentMeetingLink(link), link);
  assert.equal(safeTencentMeetingLink(` ${link} `), link);
  assert.equal(safeTencentMeetingLink(`Join: ${link}`), null);
  assert.equal(safeTencentMeetingLink(`${link}\n`), null);
});

test('ASCII colon labels expose all links, including a backup link', () => {
  assert.deepEqual(extractTencentMeetingLink(`\u4f1a\u8bae\u94fe\u63a5:${link}`), { status: 'single', url: link });
  assert.deepEqual(extractTencentMeetingLink(`${link}\n\u5907\u7528:https://meeting.tencent.com/dm/backup`), { status: 'multiple' });
});

test('Chinese invitation punctuation separates prose from the URL', () => {
  assert.deepEqual(extractTencentMeetingLink(`${link}\uff0c\u8bf7\u51c6\u65f6\u53c2\u52a0\u3002`), { status: 'single', url: link });
});

test('valid ASCII punctuation in query values is never silently rewritten', () => {
  for (const ending of ['!', '.', ',', ';', ')']) {
    const url = `${link}?pwd=synthetic${ending}`;
    assert.equal(safeTencentMeetingLink(url), url);
    assert.deepEqual(extractTencentMeetingLink(url), { status: 'single', url });
  }
});

test('an ambiguous ASCII wrapper around a query asks for manual verification', () => {
  assert.deepEqual(extractTencentMeetingLink(`(${link}?pwd=synthetic!)`), { status: 'none' });
});
