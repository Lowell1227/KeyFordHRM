import { ValidationPipe } from '@nestjs/common';
import { CreateEmployeeDto, SaveEmployeeCreateDraftDto, CreateEmploymentRecordDto } from './employee-archive.dto';
import { CreateEmployeeReentryDto } from './employee-onboarding.dto';

describe('internship employment type validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const body = { name: '虚构实习员工', company: 'fuede', deptId: '30000000-0000-4000-8000-000000000001',
    entryDate: '2026-11-17', effectiveFrom: '2026-11-17', effectiveDate: '2026-11-17', changeType: 'data_correction',
    employmentType: 'internship', employeeStatus: 'active' };

  it.each([CreateEmployeeDto, SaveEmployeeCreateDraftDto, CreateEmploymentRecordDto, CreateEmployeeReentryDto])
   ('accepts internship in %p without changing the employee status', async metatype => {
      const result = await pipe.transform(body, { type: 'body', metatype });
      expect(result.employmentType).toBe('internship');
      expect(result.employeeStatus).toBe('active');
    });
});
