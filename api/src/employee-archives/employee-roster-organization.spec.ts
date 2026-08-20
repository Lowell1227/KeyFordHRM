import type { ParsedEmployeeRosterRow } from "./employee-roster.excel";
import {
  buildRosterOrganizationPlan,
  rosterOrganizationKeyForRow,
} from "./employee-roster-organization";

function rosterRow(
  rowNumber: number,
  companyText: string,
  departmentPath: string[],
  name = `员工${rowNumber}`,
  managerName: string | null = null,
): ParsedEmployeeRosterRow {
  return {
    rowNumber,
    employee: {
      name,
      employeeNo: String(rowNumber).padStart(3, "0"),
      companyText,
      departmentPath,
      position: "专员",
      jobGrade: null,
      jobFamily: null,
      managerName,
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
  it("忽略所属公司并按完整部门路径合并唯一组织树", () => {
    const rows = [
      rosterRow(2, "凡思堡", ["销售部", "电商组"]),
      rosterRow(3, "孚德", ["项目中心", "项目一部"]),
      rosterRow(4, "孚德", ["总经办"]),
      rosterRow(5, "北京孚德", ["项目中心", "项目一部"]),
      rosterRow(6, "北京孚德", ["孚德北京办公室"]),
    ];

    const plan = buildRosterOrganizationPlan(rows);

    expect(plan.map(({ fullPath }) => fullPath)).toEqual([
      "总经办",
      "销售部",
      "销售部 / 电商组",
      "项目中心",
      "项目中心 / 项目一部",
      "孚德北京办公室",
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
    expect(rosterOrganizationKeyForRow(rows[1])).toBe(
      JSON.stringify(["项目中心", "项目一部"]),
    );
    expect(new Set(plan.map(({ key }) => key)).size).toBe(plan.length);
  });

  it("根据部门内外的直属上级关系推导每个组织负责人", () => {
    const rows = [
      rosterRow(2, "孚德", ["总经办"], "李宏"),
      rosterRow(3, "孚德", ["总经办"], "郭志浩", "李宏"),
      rosterRow(4, "北京孚德", ["项目中心", "项目一部"], "苏萌", "郭志浩"),
      rosterRow(5, "孚德", ["项目中心", "项目一部"], "项目专员", "苏萌"),
      rosterRow(6, "孚德", ["项目中心", "项目管理和运营部"], "李雨陶", "郭志浩"),
      rosterRow(7, "凡思堡", ["项目中心", "项目管理和运营部"], "劳祐茹", "郭志浩"),
      rosterRow(8, "孚德体育文化", ["销售部", "线下零售组"], "唐廷磊", "莫天飞"),
    ];

    const leaders = new Map(
      buildRosterOrganizationPlan(rows).map((node) => [node.fullPath, node.leaderName]),
    );

    expect(Object.fromEntries(leaders)).toMatchObject({
      "总经办": "李宏",
      "项目中心": "郭志浩",
      "项目中心 / 项目一部": "苏萌",
      "项目中心 / 项目管理和运营部": "郭志浩",
      "销售部 / 线下零售组": "莫天飞",
    });
  });
});
