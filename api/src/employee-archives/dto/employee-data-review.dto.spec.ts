import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { ApproveEmployeeDataReviewsDto, RejectEmployeeDataReviewsDto } from './employee-data-review.dto';

const requestId = '10000000-0000-4000-8000-000000000001';

describe('review version transport validation', () => {
  for (const Dto of [ApproveEmployeeDataReviewsDto, RejectEmployeeDataReviewsDto]) {
    it(`${Dto.name}: lets legacy payloads reach the service's 409 version guard`, () => {
      const dto = Object.assign(new Dto(), { requestIds: [requestId], scopes: ['profile'], reason: 'Fictional correction' });
      expect(validateSync(dto)).toEqual([]);
    });

    it(`${Dto.name}: preserves explicit per-ID versions under whitelist validation`, () => {
      const dto = Object.assign(new Dto(), { requestIds: [requestId], scopes: ['profile'], reason: 'Fictional correction',
        requestVersions: { [requestId]: 3 } });
      expect(validateSync(dto, { whitelist: true })).toEqual([]);
      expect(dto.requestVersions).toEqual({ [requestId]: 3 });
    });

    it.each([1, '1', [1], null])(`${Dto.name}: rejects a shared scalar or non-object version map %j`, requestVersions => {
      const dto = Object.assign(new Dto(), { requestIds: [requestId], scopes: ['profile'], reason: 'Fictional correction', requestVersions });
      expect(validateSync(dto).map(error => error.property)).toContain('requestVersions');
    });
  }
});
