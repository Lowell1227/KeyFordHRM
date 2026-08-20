import { IsIn, IsString } from 'class-validator';
import { TEST_ACCOUNT_MANIFEST } from '../test-accounts';

const TEST_EMPLOYEE_NOS = TEST_ACCOUNT_MANIFEST.map((account) => account.employeeNo);

export class TestLoginDto {
  @IsString()
  @IsIn(TEST_EMPLOYEE_NOS)
  employeeNo!: string;
}
