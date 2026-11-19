import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { TalentRecruitmentController } from './talent-recruitment.controller';

describe('recruitment route contract', () => {
  it('keeps all application and feedback endpoints under the agreed prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, TalentRecruitmentController)).toBe('talent-recruitment');
    const routes = [
      ['owners', 'owners', RequestMethod.GET], ['list', 'candidates/:candidateId/applications', RequestMethod.GET],
      ['hiringReviews', 'hiring-reviews', RequestMethod.GET],
      ['create', 'candidates/:candidateId/applications', RequestMethod.POST], ['detail', 'applications/:id', RequestMethod.GET],
      ['update', 'applications/:id', RequestMethod.PATCH], ['act', 'applications/:id/actions', RequestMethod.POST],
      ['feedback', 'interviews/:id/feedback', RequestMethod.GET], ['saveFeedback', 'interviews/:id/feedback', RequestMethod.PUT],
      ['returnFeedback', 'interviews/:id/feedback/:userId/return', RequestMethod.POST],
    ] as const;
    for (const [name, path, method] of routes) {
      expect(Reflect.getMetadata(PATH_METADATA, TalentRecruitmentController.prototype[name])).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, TalentRecruitmentController.prototype[name])).toBe(method);
    }
  });
});
