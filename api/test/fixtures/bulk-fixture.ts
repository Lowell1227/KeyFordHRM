import { FixtureFactory } from './fixture-factory';
import { SysRole } from '@prisma/client';

export interface BulkFixtureResult {
  employeeIds: string[];
  managerIds: string[];
  exemptEmployeeId: string;
  deptId: string;
}

/**
 * 创建 128 人规模测试数据：10 位主管 + 128 名员工 + 1 位豁免员工。
 *
 * 员工均匀挂在各位主管下，部门与主管均使用同一个 seed dept。
 */
export async function createBulkFixture(factory: FixtureFactory): Promise<BulkFixtureResult> {
  const dept = await factory.getSeedDept();
  const employeeIds: string[] = [];
  const managerIds: string[] = [];

  const managerCount = 10;
  const employeesPerManager = 12;
  const targetCount = 128;

  for (let m = 1; m <= managerCount; m++) {
    const manager = await factory.createUser({
      employeeNo: `MGR${String(m).padStart(3, '0')}`,
      name: `主管${m}`,
      sysRole: SysRole.manager,
      deptId: dept.id,
    });
    managerIds.push(manager.id);

    for (let e = 1; e <= employeesPerManager; e++) {
      const idx = (m - 1) * employeesPerManager + e;
      if (idx > targetCount) break;
      const emp = await factory.createUser({
        employeeNo: `EMP${String(idx).padStart(3, '0')}`,
        name: `员工${idx}`,
        sysRole: SysRole.employee,
        deptId: dept.id,
        directManagerId: manager.id,
      });
      employeeIds.push(emp.id);
    }
  }

  // 补充不足 128 的员工（如果因整除原因缺少）
  while (employeeIds.length < targetCount) {
    const idx = employeeIds.length + 1;
    const emp = await factory.createUser({
      employeeNo: `EMP${String(idx).padStart(3, '0')}`,
      name: `员工${idx}`,
      sysRole: SysRole.employee,
      deptId: dept.id,
      directManagerId: managerIds[0],
    });
    employeeIds.push(emp.id);
  }

  // 豁免员工：在周期快结束时入职，在岗天数 < 1/3
  const exemptEmp = await factory.createUser({
    employeeNo: 'EXEMPT001',
    name: '豁免员工',
    sysRole: SysRole.employee,
    deptId: dept.id,
    directManagerId: managerIds[0],
    entryDate: new Date('2026-03-20'),
  });
  employeeIds.push(exemptEmp.id);

  return { employeeIds, managerIds, exemptEmployeeId: exemptEmp.id, deptId: dept.id };
}
