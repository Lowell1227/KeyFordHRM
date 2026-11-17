import { buildResultEvidence, maskResultEvidence, RESULT_PERIOD_SELECT } from './result-evidence';
const review = (id: string, source: string, selfScore: number | null, managerScore: number | null, indicatorVersionId = 'version-1') => ({
  selfScore, managerScore, indicatorVersionItem: { id, indicatorVersionId, sourceInstanceId: source, name: '同名指标', weight: 0.5, indicatorType: 'kpi' },
});
const periods = [
  { periodKey: '2026-08', indicatorVersionId: 'version-1', status: 'completed', selfGrade: 'A', managerGrade: 'B', selfScoreTotal: 90, managerScoreTotal: 80, indicatorReviews: [review('v2', 'one', 100, 90), review('v3', 'two', 40, 20)] },
  { periodKey: '2026-07', indicatorVersionId: 'version-1', status: 'completed', selfGrade: 'B', managerGrade: 'C', selfScoreTotal: 80, managerScoreTotal: 60, indicatorReviews: [review('v1', 'one', 80, 70)] },
  { periodKey: '2026-09', indicatorVersionId: 'version-1', status: 'pending', indicatorReviews: [review('v4', 'one', null, null)] },
];
describe('shared result evidence', () => {
  it('selects each period version and review item version for every shared consumer', () => {
    expect(RESULT_PERIOD_SELECT).toMatchObject({
      indicatorVersionId: true,
      indicatorReviews: { select: { indicatorVersionItem: { select: { indicatorVersionId: true } } } },
    });
  });

  it('uses each month own version, preserving old results but excluding leftover draft items from amended months', () => {
    const amendedPeriods = [
      { ...periods[1], indicatorReviews: [
        review('old-removed', 'removed', 80, 70),
        review('old-retained', 'retained', 60, 50),
      ] },
      { ...periods[0], indicatorVersionId: 'version-2', indicatorReviews: [
        review('draft-removed', 'removed', 5, 10),
        review('draft-only', 'draft-only', 10, 20),
        review('draft-retained', 'retained', 0, 0),
        review('new-retained', 'retained', 100, 90, 'version-2'),
      ] },
    ];
    const stored = JSON.stringify(amendedPeriods);

    const result = buildResultEvidence(amendedPeriods);

    expect(result.indicators).toEqual([
      expect.objectContaining({ id: 'removed', avgSelfScore: 80, avgManagerScore: 70 }),
      expect.objectContaining({ id: 'retained', avgSelfScore: 80, avgManagerScore: 70 }),
    ]);
    expect(result.periods).toEqual([
      expect.objectContaining({ periodKey: '2026-07', selfScoreTotal: 80, managerScoreTotal: 60 }),
      expect.objectContaining({ periodKey: '2026-08', selfScoreTotal: 90, managerScoreTotal: 80 }),
    ]);
    expect(JSON.stringify(amendedPeriods)).toBe(stored);
    expect(amendedPeriods[1].indicatorReviews).toHaveLength(4);
  });

  it('does not attach review evidence to a month without a bound version', () => {
    const unbound = [{ ...periods[0], indicatorVersionId: null }];
    const result = buildResultEvidence(unbound);
    expect(result.indicators).toEqual([]);
    expect(result.periods[0].managerScoreTotal).toBe(80);
  });

  it('keeps chronological monthly scores and missing results without inventing zero scores', () => {
    const result = buildResultEvidence(periods);
    expect(result.periods.map(p => p.periodKey)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(result.periods[0]).toMatchObject({ selfScoreTotal: 80, managerScoreTotal: 60, managerGrade: 'C' });
    expect(result.periods[2]).toMatchObject({ selfScoreTotal: null, managerScoreTotal: null });
  });
  it('aggregates version snapshots by stable source id without mixing identically named goals', () => {
    const result = buildResultEvidence(periods);
    expect(result.indicators).toHaveLength(2);
    expect(result.indicators.find(i => i.id === 'one')).toMatchObject({ avgSelfScore: 90, avgManagerScore: 80 });
    expect(result.indicators.find(i => i.id === 'two')).toMatchObject({ avgSelfScore: 40, avgManagerScore: 20 });
  });
  it('masks manager monthly and indicator results according to publication visibility without mutating evidence', () => {
    const result = buildResultEvidence(periods);
    const masked = maskResultEvidence(result, { total_score: false, grade: false, indicator_scores: false });
    expect(masked.periods[0]).toMatchObject({ selfScoreTotal: 80, selfGrade: 'B', managerScoreTotal: null, managerGrade: null });
    expect(masked.indicators[0].avgManagerScore).toBeNull();
    expect(result.periods[0].managerScoreTotal).toBe(60);
    expect(maskResultEvidence(result, { total_score: true, grade: true, indicator_scores: true })).toEqual(result);
  });
});
