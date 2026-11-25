import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { CreateCycleDto } from './create-cycle.dto';
import { TrackingContextQueryDto } from './tracking-context-query.dto';
import { UpdateCycleDto } from './update-cycle.dto';

const rosterUserId = '11111111-1111-5111-8111-111111111111';
const departmentId = '22222222-2222-4222-8222-222222222222';
const scopeFields = ['participantDeptIds', 'participantUserIds', 'explicitExemptDeptIds', 'explicitExemptUserIds'];

describe('cycle scope identity validation', () => {
  it.each([['create', CreateCycleDto], ['update', UpdateCycleDto]] as const)(
    '%s accepts roster UUID v5 identities in scope fields', (_operation, Dto) => {
      const dto = Object.assign(new Dto(), {
        participantDeptIds: [departmentId],
        participantUserIds: [rosterUserId],
        explicitExemptDeptIds: [departmentId],
        explicitExemptUserIds: [rosterUserId],
      });
      expect(validateSync(dto).filter((error) => scopeFields.includes(error.property))).toEqual([]);
    },
  );

  it('continues to reject malformed scope identities', () => {
    const dto = Object.assign(new CreateCycleDto(), { participantUserIds: ['350'] });
    expect(validateSync(dto).some((error) => error.property === 'participantUserIds')).toBe(true);
  });

  it('accepts a roster UUID v5 as the tracking owner', () => {
    const dto = Object.assign(new TrackingContextQueryDto(), { ownerId: rosterUserId });
    expect(validateSync(dto)).toEqual([]);
  });
});
