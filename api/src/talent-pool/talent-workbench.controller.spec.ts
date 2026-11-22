import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { TalentWorkbenchController } from './talent-workbench.controller';

describe('recruitment workbench route contract', () => {
  it('exposes the read projection only through GET /talent-recruitment/workbench', () => {
    expect(Reflect.getMetadata(PATH_METADATA, TalentWorkbenchController)).toBe('talent-recruitment');
    expect(Reflect.getMetadata(PATH_METADATA, TalentWorkbenchController.prototype.getWorkbench)).toBe('workbench');
    expect(Reflect.getMetadata(METHOD_METADATA, TalentWorkbenchController.prototype.getWorkbench)).toBe(RequestMethod.GET);
  });
});
