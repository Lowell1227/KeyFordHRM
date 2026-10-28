import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { ERROR_CODE } from '@/common/constants/error-codes';

@Injectable()
export class EmployeeRosterImportClosedGuard implements CanActivate {
  canActivate(): never {
    throw new ForbiddenException({
      code: ERROR_CODE.FORBIDDEN,
      message: '花名册导入暂未开放',
    });
  }
}
