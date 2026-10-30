import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { assertPersonnelReferenceDataAccess } from './personnel-reference-data.permissions';

@Injectable()
export class PersonnelReferenceDataGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    assertPersonnelReferenceDataAccess(
      request.user,
      request.params.kind,
      request.method !== 'GET',
    );
    return true;
  }
}
