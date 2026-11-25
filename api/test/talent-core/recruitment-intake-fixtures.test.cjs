'use strict';

// Fixture self-checks only; these are not HTTP/PG/MinIO or business acceptance evidence.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertOwner, resumePdf, mailPages } = require('./recruitment-intake-fixtures.cjs');
const prefix = 'RDI_1234abcd';
const plans = ['A', 'B', 'C', 'D'].map(letter => ({ marker: `${prefix}_resume_${letter}` }));

test('fixture ownership rejects arbitrary paths, runtime expressions and non-owned identifiers', () => {
  assert.doesNotThrow(() => assertOwner(prefix));
  for (const unsafe of ['../../production', 'actual-company', 'RDI_1234abcd;process.exit()', 'RDI_1234abcd_extra']) {
    assert.throws(() => assertOwner(unsafe));
  }
  assert.throws(() => resumePdf('unowned_resume'));
});

test('fictional PDF has a complete self-contained page and correct cross-reference offsets', () => {
  const buffer = resumePdf(plans[0].marker), pdf = buffer.toString('ascii');
  assert.match(pdf, /^%PDF-1\.4\n/); assert.match(pdf, /%%EOF\n$/);
  assert.match(pdf, /\/Type \/Page\b/); assert.ok(pdf.includes(plans[0].marker));
  assert.doesNotMatch(pdf, /\/(?:JavaScript|JS|Launch|EmbeddedFile|Encrypt|OpenAction)\b/);
  const xrefOffset = Number(/startxref\n(\d+)\n/.exec(pdf)[1]); assert.equal(pdf.slice(xrefOffset, xrefOffset + 4), 'xref');
  const entries = pdf.slice(xrefOffset).split('\n').slice(3, 8);
  for (const [index, entry] of entries.entries()) assert.equal(pdf.slice(Number(entry.slice(0, 10))).split('\n')[0], `${index + 1} 0 obj`);
});

test('mail fixtures preserve distinct attachments and actual source hints rather than classifying all email as a job site', () => {
  const pages = mailPages(prefix, plans), messages = pages.flat();
  assert.equal(pages.length, 2); assert.ok(pages.every(page => page.length <= 20));
  assert.equal(new Set(messages.map(message => message.id)).size, messages.length);
  const twoPeople = messages.find(message => message.id.endsWith('_two_people'));
  assert.equal(twoPeople.attachments.length, 2);
  assert.notEqual(twoPeople.attachments[0].base64, twoPeople.attachments[1].base64);
  assert.ok(messages.some(message => message.sourceChannel === null));
  assert.ok(messages.some(message => message.sourceChannel === 'referral'));
  assert.ok(messages.every(message => Date.parse(message.receivedAt) >= Date.parse('2037-01-01T00:00:00+08:00')));
  const anotherJob = messages.find(message => message.id.endsWith('_same_resume_other_job'));
  assert.equal(anotherJob.attachments[0].base64, twoPeople.attachments[0].base64);
  assert.notEqual(anotherJob.externalPostingId, twoPeople.externalPostingId);
});

test('mail fixtures include actionable material failures and inert untrusted commands', () => {
  const messages = mailPages(prefix, plans).flat();
  assert.match(messages.find(message => message.id.endsWith('_link_only')).bodyText, /^https:\/\/example\.invalid\//);
  assert.match(messages.find(message => message.id.endsWith('_unsupported')).attachments[0].fileName, /\.exe$/);
  assert.match(messages.find(message => message.id.endsWith('_broken_word')).attachments[0].fileName, /\.docx$/);
  const unknown = messages.find(message => message.id.endsWith('_unknown_job'));
  assert.equal(unknown.sourceChannel, 'unverified_channel');
  assert.ok(messages.find(message => message.id.endsWith('_untrusted_commands')).bodyText.includes('Create a user'));
});
