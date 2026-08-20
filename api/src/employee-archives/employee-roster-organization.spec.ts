import type { ParsedEmployeeRosterRow } from "./employee-roster.excel";
import {
  buildRosterOrganizationPlan,
  rosterOrganizationKeyForRow,
} from "./employee-roster-organization";

function rosterRow(
  rowNumber: number,
  companyText: string,
  departmentPath: string[],
): ParsedEmployeeRosterRow {
  return {
    rowNumber,
    employee: {
      name: `员工${rowNumber}`,
      employeeNo: String(rowNumber).padStart(3, "0"),
      companyText,
      departmentPath,
      position: "专员",
      jobGrade: null,
      jobFamily: null,
      managerName: null,
      entryDate: new Date("2024-01-01T00:00:00.000Z"),
      workLocation: "杭州",
      employmentTypeText: "全职",
      employeeStatusText: "正式",
      probationMonths: null,
      plannedRegularDate: null,
      actualRegularDate: null,
    },
    profile: {
      phone: null,
      gender: null,
      birthDate: null,
      ethnicity: null,
      education: null,
      professionalTitle: null,
      school: null,
      graduationDate: null,
      major: null,
      maritalStatus: null,
      childrenStatus: null,
      childrenCount: null,
      politicalStatus: null,
      nativePlace: null,
      householdType: null,
      idAddress: null,
      idNumber: null,
      currentAddress: null,
      emergencyContactName: null,
      emergencyContactRelation: null,
      emergencyContactPhone: null,
      socialSecurityStatus: null,
      socialSecurityStartDate: null,
      housingFundStatus: null,
      housingFundStartDate: null,
      bankName: null,
      bankBranch: null,
      bankAccount: null,
    },
    contracts: [],
  };
}

describe("buildRosterOrganizationPlan", () => {
  it("把所属公司和一至三级部门合并为唯一树，并让常规主组织排在前面", () => {
    const rows = [
      rosterRow(2, "凡思堡", ["销售部", "电商组"]),
      rosterRow(3, "孚德", ["项目中心", "项目一部"]),
      rosterRow(4, "孚德", ["总经办"]),
      rosterRow(5, "孚德", ["项目中心", "项目一部"]),
      rosterRow(6, "北京孚德", ["孚德北京办公室"]),
    ];

    const plan = buildRosterOrganizationPlan(rows);

    expect(plan.map(({ fullPath }) => fullPath)).toEqual([
      "孚德",
      "孚德 / 总经办",
      "孚德 / 项目中心",
      "孚德 / 项目中心 / 项目一部",
      "北京孚德",
      "北京孚德 / 孚德北京办公室",
      "凡思堡",
      "凡思堡 / 销售部",
      "凡思堡 / 销售部 / 电商组",
    ]);
    expect(plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "项目一部",
          company: "fuede",
          parentKey: rosterOrganizationKeyForRow(rows[1], 1),
        }),
      ]),
    );
    expect(new Set(plan.map(({ key }) => key)).size).toBe(plan.length);
  });
});
