import { calculateWeightedScore, validateGoals, validateEvaluation } from './improvement-plan-rules';

const goals = [
  { id: 'a', name: '交付质量', description: '减少返工', weight: 40 },
  { id: 'b', name: '响应效率', description: '及时处理问题', weight: 60 },
];

describe('improvement plan rules', () => {
  it('requires goal weights to total 100 when submitting', () => {
    expect(() => validateGoals([{ ...goals[0], weight: 39 }, goals[1]])).toThrow('权重合计必须为 100%');
    expect(() => validateGoals(goals)).not.toThrow();
  });

  it('calculates the weighted total from individual percentage scores', () => {
    const evaluation = validateEvaluation(goals, {
      items: [
        { goalId: 'a', score: 80, comment: '质量仍需改进' },
        { goalId: 'b', score: 95, comment: '响应及时' },
      ],
      overallComment: '整体进步明显',
    });
    expect(calculateWeightedScore(goals, evaluation.items)).toBe(89);
  });

  it('rejects missing per-goal comments and out-of-range scores', () => {
    expect(() => validateEvaluation(goals, {
      items: [
        { goalId: 'a', score: 101, comment: '评价' },
        { goalId: 'b', score: 90, comment: '评价' },
      ],
      overallComment: '总体评价',
    })).toThrow('0 至 100');
    expect(() => validateEvaluation(goals, {
      items: [
        { goalId: 'a', score: 80, comment: '' },
        { goalId: 'b', score: 90, comment: '评价' },
      ],
      overallComment: '总体评价',
    })).toThrow('评价内容');
  });
});
