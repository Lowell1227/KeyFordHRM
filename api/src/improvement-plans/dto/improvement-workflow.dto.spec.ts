import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateImprovementPlanDto, UpdateImprovementPlanDto, ImprovementDecisionDto,
  ImprovementGoalDecisionDto, ImprovementEvaluationDto, ImprovementEvaluationDraftDto, ImprovementRevisionDto } from './improvement-workflow.dto';

describe('Improvement mutation revision validation', () => {
  it('allows creation without an existing-record revision', async () => {
    const errors = await validate(Object.assign(new CreateImprovementPlanDto(), {
      employeeId: '00000000-0000-4000-8000-000000000001',
    }));
    expect(errors).toEqual([]);
  });

  it.each([UpdateImprovementPlanDto, ImprovementDecisionDto,
    ImprovementGoalDecisionDto, ImprovementEvaluationDto, ImprovementEvaluationDraftDto, ImprovementRevisionDto])(
    '%p requires a nonnegative integer expectedRevision', async (Dto) => {
      for (const revision of [undefined, null, -1, 1.5, '0']) {
        const errors = await validate(Object.assign(new Dto(), { expectedRevision: revision }));
        expect(errors.some((error) => error.property === 'expectedRevision')).toBe(true);
      }
      for (const revision of [0, 1]) {
        const errors = await validate(Object.assign(new Dto(), { expectedRevision: revision }));
        expect(errors.some((error) => error.property === 'expectedRevision')).toBe(false);
      }
    });
});
