'use strict';

// Direct DTO checks only. HTTP/PG/MinIO acceptance is in recruitment-intake.integration.cjs.
require('reflect-metadata');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../../tsconfig.json'), transpileOnly: true });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '../..'), paths: { '@/*': ['src/*'] } });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ValidationPipe, BadRequestException } = require('@nestjs/common');
const { CreateRecruitmentIntakeDto } = require('../../src/talent-pool/recruitment-intakes.dto');
const { CreateRecruitmentPostingDto } = require('../../src/talent-pool/recruitment-postings.dto');
const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
const intake = value => pipe.transform(value, { type: 'body', metatype: CreateRecruitmentIntakeDto });
const posting = value => pipe.transform(value, { type: 'body', metatype: CreateRecruitmentPostingDto });
const postingBody = () => ({ requestId: randomUUID(), demandId: randomUUID(), channel: 'job_site', name: 'Synthetic intake posting',
  url: 'https://example.invalid/intake/job', externalId: 'synthetic-intake-job', evidence: 'Synthetic explicit verification evidence', verifiedIdentity: false, active: false });

test('strict follow-up calendar rejects nonexistent days and months', async () => {
  for (const nextFollowUpAt of ['2037-02-30T09:00:00+08:00', '2037-13-01T09:00:00+08:00', '2037-01-32T09:00:00Z']) {
    await assert.rejects(() => intake({ requestId: randomUUID(), nextFollowUpAt }), BadRequestException);
  }
});

test('valid Beijing follow-up keeps its exact instant across validation', async () => {
  const row = await intake({ requestId: randomUUID(), nextFollowUpAt: '2037-01-09T00:15:00+08:00' });
  assert.equal(new Date(row.nextFollowUpAt).toISOString(), '2037-01-08T16:15:00.000Z');
});

test('JSON false posting flags remain false', async () => {
  const row = await posting(postingBody()); assert.equal(row.verifiedIdentity, false); assert.equal(row.active, false);
});

for (const flag of ['verifiedIdentity', 'active']) {
  test(`string false never silently enables posting ${flag}`, async () => {
    let row;
    try { row = await posting({ ...postingBody(), [flag]: 'false' }); }
    catch (error) { assert.ok(error instanceof BadRequestException); return; }
    assert.equal(row[flag], false, 'Reject non-boolean input or retain false, never coerce it to true');
  });
}
