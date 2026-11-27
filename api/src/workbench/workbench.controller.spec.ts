import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { METHOD_METADATA, PATH_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { OperationsQueryDto } from './operations.dto';
import { WorkbenchController } from './workbench.controller';

jest.mock('./workbench.service', () => ({ WorkbenchService: class {} }));

describe('workbench read-only controller contract (pure)', () => {
  it('exposes only an authenticated GET with private/no-store caching', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WorkbenchController)).toBe('workbench');
    expect(Reflect.getMetadata(PATH_METADATA, WorkbenchController.prototype.operations)).toBe('operations');
    expect(Reflect.getMetadata(METHOD_METADATA, WorkbenchController.prototype.operations)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(HEADERS_METADATA, WorkbenchController.prototype.operations)).toEqual([
      { name: 'Cache-Control', value: 'no-store, private' },
    ]);
    expect(Reflect.getMetadata('isPublic', WorkbenchController)).toBeUndefined();
    expect(Reflect.getMetadata('isPublic', WorkbenchController.prototype.operations)).toBeUndefined();
  });

  it('defaults to five samples and validates bounded integer pagination', () => {
    const query = plainToInstance(OperationsQueryDto, {});
    expect(query).toMatchObject({ page: 1, pageSize: 5 });
    expect(validateSync(query)).toEqual([]);
    expect(validateSync(plainToInstance(OperationsQueryDto, { page: '2', pageSize: '20' }))).toEqual([]);
    for (const value of [{ page: 0 }, { page: 1.1 }, { pageSize: 21 }, { pageSize: 0 }, { page: 'all' }]) {
      expect(validateSync(plainToInstance(OperationsQueryDto, value)).length).toBeGreaterThan(0);
    }
  });
});
