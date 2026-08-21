import { expect, test } from '@playwright/test';
import {
  isWeightComplete,
  validateTemplateWeightsPercent,
} from '../../src/views/admin/template-weights';

const globalWeightTemplate = [
  {
    name: '业绩目标',
    type: 'kpi',
    weight: 70,
    indicators: [{ weight: 45 }, { weight: 25 }],
  },
  {
    name: '能力态度',
    type: 'attitude',
    weight: 30,
    indicators: [{ weight: 20 }, { weight: 10 }],
  },
];

test('accepts indicator weights as final percentages of the total score', () => {
  expect(validateTemplateWeightsPercent(globalWeightTemplate)).toBeNull();
  expect(isWeightComplete(70, 70)).toBe(true);
  expect(isWeightComplete(30, 30)).toBe(true);
});

test('explains that each core dimension indicator total must match its dimension weight', () => {
  expect(validateTemplateWeightsPercent([
    {
      ...globalWeightTemplate[0],
      indicators: [{ weight: 35 }, { weight: 25 }],
    },
    globalWeightTemplate[1],
  ])).toBe('维度「业绩目标」的指标权重合计应等于维度权重 70.00%，当前 60.00%');
});
