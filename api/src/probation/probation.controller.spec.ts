import { ProbationController } from './probation.controller';

describe('legacy probation review API', () => {
  const service = {
    create: jest.fn(), update: jest.fn(), submitSelfEval: jest.fn(),
    submitManagerScore: jest.fn(), close: jest.fn(),
  };
  const controller = new ProbationController(service as never);
  const viewer = { id: 'employee-1' } as never;

  it('keeps historical reads but refuses all new independent scoring writes', async () => {
    const actions = [
      () => controller.create({} as never, viewer),
      () => controller.update('review-1', {} as never, viewer),
      () => controller.submitSelfEval('review-1', {} as never, viewer),
      () => controller.submitManagerScore('review-1', {} as never, viewer),
      () => controller.close('review-1', viewer),
    ];
    for (const action of actions) {
      expect(action).toThrow('独立试用期评分已停用');
    }
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  });
});
