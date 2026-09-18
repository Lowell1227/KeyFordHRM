import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('employee onboarding schema contract', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(join(
    process.cwd(),
    'prisma/migrations/20260918120000_employee_reentry_onboarding/migration.sql',
  ), 'utf8');

  it('defines pending-entry, onboarding and employee-number lifecycle fields', () => {
    expect(schema).toContain('pending_entry');
    expect(schema).toContain('enum OnboardingIntakeType');
    expect(schema).toContain('enum OnboardingStatus');
    expect(schema).toContain('enum EmployeeNumberStatus');
    expect(schema).toContain('model EmployeeNumberAssignment');
    expect(schema).toContain('sourceReference');
    expect(schema).toContain('requestVersion');
    expect(schema).toContain('revisionHistory');
    expect(schema).toContain('cancelledAt');
    expect(schema).toMatch(/userId\s+String\?/);
    expect(migration).toContain('CREATE SEQUENCE "employee_number_seq"');
    expect(migration).toContain("setval('employee_number_seq'");
  });
});
