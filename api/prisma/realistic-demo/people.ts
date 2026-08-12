import type { Prisma } from "@prisma/client";
import { DEMO_CONFIG } from "./config";
import type { DemoContext } from "./context";
import type { PeopleBundle } from "./types";

export const ACCEPTANCE_PASSWORD_HASH = "__ACCEPTANCE_PASSWORD_HASH__";

const BASE_DEPARTMENT_ID = {
  project: "00000000-0000-0000-0000-000000000010",
  beijing: "00000000-0000-0000-0000-000000000011",
  supplyChain: "00000000-0000-0000-0000-000000000012",
  creative: "00000000-0000-0000-0000-000000000013",
  sales: "00000000-0000-0000-0000-000000000014",
  digital: "00000000-0000-0000-0000-000000000015",
  hrAdmin: "00000000-0000-0000-0000-000000000016",
  finance: "00000000-0000-0000-0000-000000000018",
} as const;

const SURNAMES = [
  "赵",
  "钱",
  "孙",
  "李",
  "周",
  "吴",
  "郑",
  "王",
  "冯",
  "陈",
  "褚",
  "卫",
  "蒋",
  "沈",
  "韩",
  "杨",
];
const GIVEN_NAMES = [
  "安然",
  "博文",
  "晨曦",
  "德明",
  "恩泽",
  "芳菲",
  "冠宇",
  "浩然",
  "嘉宁",
  "凯文",
  "琳雅",
  "明轩",
  "宁远",
  "欧阳",
  "佩珊",
  "清越",
];
const TEAM_SIZES = [24, 6, 6, 6, 5, 5, 5, 13, 7, 6, 9, 4, 8, 3, 2, 7, 1, 6];
const MANAGER_INDEXES = [
  0, 1, 7, 14, 21, 28, 35, 59, 65, 72, 85, 92, 102, 110, 117, 122, 125, 127,
];
const ROOT_MANAGER_INDEXES = new Set([0, 59, 85, 102, 122]);
const DEPT_HEAD_INDEXES = new Set([0, 59, 85, 102, 110, 117, 125, 127]);
const PROBATION_INDEXES = new Set([116, 117, 120, 121, 124, 125, 127]);

type DepartmentKey = keyof typeof DEMO_CONFIG.departmentHeadcount;
interface PersonSlot {
  deptId: string;
  departmentKey: DepartmentKey;
}

function weightedSlots(
  departmentKey: DepartmentKey,
  teamIds: Array<[string, number]>,
): PersonSlot[] {
  return teamIds.flatMap(([deptId, count]) =>
    Array.from({ length: count }, () => ({ deptId, departmentKey })),
  );
}

function currentPersonSlots(executiveDepartmentId: string): PersonSlot[] {
  return [
    ...weightedSlots("project", [
      ["00000000-0000-0000-0000-000000001011", 8],
      ["00000000-0000-0000-0000-000000001021", 8],
      ["00000000-0000-0000-0000-000000000103", 7],
      ["00000000-0000-0000-0000-000000000104", 9],
      ["00000000-0000-0000-0000-000000000105", 10],
      ["00000000-0000-0000-0000-000000000106", 9],
      ["00000000-0000-0000-0000-000000000107", 8],
    ]),
    ...weightedSlots("supplyChain", [
      ["00000000-0000-0000-0000-000000000121", 14],
      ["00000000-0000-0000-0000-000000000122", 12],
    ]),
    ...weightedSlots("creative", [[BASE_DEPARTMENT_ID.creative, 17]]),
    ...weightedSlots("hrAdmin", [[BASE_DEPARTMENT_ID.hrAdmin, 8]]),
    ...weightedSlots("sales", [
      ["00000000-0000-0000-0000-000000000141", 4],
      ["00000000-0000-0000-0000-000000000142", 3],
    ]),
    ...weightedSlots("finance", [[BASE_DEPARTMENT_ID.finance, 5]]),
    ...weightedSlots("executive", [[executiveDepartmentId, 3]]),
    ...weightedSlots("beijing", [[BASE_DEPARTMENT_ID.beijing, 2]]),
    ...weightedSlots("digital", [[BASE_DEPARTMENT_ID.digital, 1]]),
  ];
}

function employeeNumber(index: number): string {
  const special = new Map<number, string>([
    [0, DEMO_CONFIG.acceptanceEmployeeNos.deptHead],
    [1, DEMO_CONFIG.acceptanceEmployeeNos.manager],
    [2, DEMO_CONFIG.acceptanceEmployeeNos.employee],
    [3, DEMO_CONFIG.acceptanceEmployeeNos.lowPerformer],
    [4, DEMO_CONFIG.storyEmployeeNos.consecutiveLowPerformerA],
    [5, DEMO_CONFIG.storyEmployeeNos.consecutiveLowPerformerB],
    [6, DEMO_CONFIG.storyEmployeeNos.appealModified],
    [8, DEMO_CONFIG.storyEmployeeNos.appealMaintained],
    [9, DEMO_CONFIG.storyEmployeeNos.lateEntryExempt],
    [10, DEMO_CONFIG.storyEmployeeNos.transferredEmployee],
    [102, DEMO_CONFIG.acceptanceEmployeeNos.hr],
    [116, DEMO_CONFIG.acceptanceEmployeeNos.probation],
    [122, DEMO_CONFIG.acceptanceEmployeeNos.vp],
  ]);
  return special.get(index) ?? `FD${String(300000 + index).padStart(6, "0")}`;
}

function entryDate(index: number): Date {
  if (index < 116)
    return new Date(Date.UTC(2025, index % 12, (index % 24) + 1));
  const cohortMonth = [0, 1, 2, 2, 3, 4, 5, 5, 6, 6, 7, 7][index - 116];
  return new Date(Date.UTC(2026, cohortMonth, (index % 20) + 1));
}

function employmentType(
  index: number,
): "full_time" | "rehire" | "external" | "part_time" {
  if (index < 115) return "full_time";
  if (index < 124) return "rehire";
  if (index < 127) return "external";
  return "part_time";
}

function personName(index: number): string {
  return `${SURNAMES[index % SURNAMES.length]}${GIVEN_NAMES[Math.floor(index / SURNAMES.length) % GIVEN_NAMES.length]}`;
}

function positionFor(index: number, departmentKey: DepartmentKey): string {
  if (index === 102) return "人力资源经理";
  if (index === 122) return "副总经理";
  if (DEPT_HEAD_INDEXES.has(index)) return "部门负责人";
  if (MANAGER_INDEXES.includes(index)) return "团队经理";
  const role = {
    project: "项目专员",
    supplyChain: "供应链专员",
    creative: "设计师",
    hrAdmin: "行政专员",
    sales: "销售专员",
    finance: "财务专员",
    executive: "总经理助理",
    beijing: "门店专员",
    digital: "运营专员",
  };
  return role[departmentKey];
}

function sysRoleFor(
  index: number,
): "hr" | "vp" | "dept_head" | "manager" | "employee" {
  if (index === 102) return "hr";
  if (index === 122) return "vp";
  if (DEPT_HEAD_INDEXES.has(index)) return "dept_head";
  if (MANAGER_INDEXES.includes(index)) return "manager";
  return "employee";
}

function createReportingGraph(
  users: Prisma.UserCreateManyInput[],
  slots: PersonSlot[],
  managerIds: string[],
): Map<string, string> {
  const managerByIndex = new Map(
    MANAGER_INDEXES.map((index, managerIndex) => [
      index,
      managerIds[managerIndex],
    ]),
  );
  const managerDepartment = new Map(
    MANAGER_INDEXES.map((index, managerIndex) => [
      managerIds[managerIndex],
      slots[index].departmentKey,
    ]),
  );
  const remaining = new Map(
    managerIds.map((managerId, index) => [managerId, TEAM_SIZES[index]]),
  );
  const managerByUserId = new Map<string, string>();
  const rootManagerIds = new Set(
    [...ROOT_MANAGER_INDEXES].map((index) => managerByIndex.get(index)!),
  );
  const parentByManagerIndex = new Map<number, number>([
    [1, 0],
    [7, 0],
    [14, 0],
    [21, 0],
    [28, 0],
    [35, 0],
    [65, 59],
    [72, 59],
    [92, 85],
    [110, 122],
    [117, 122],
    [125, 122],
    [127, 122],
  ]);

  for (const [childIndex, parentIndex] of parentByManagerIndex) {
    const childId = managerByIndex.get(childIndex)!;
    const parentId = managerByIndex.get(parentIndex)!;
    users[childIndex].directManagerId = parentId;
    managerByUserId.set(childId, parentId);
    remaining.set(parentId, remaining.get(parentId)! - 1);
  }

  for (let index = 0; index < users.length; index += 1) {
    const user = users[index];
    if (managerByIndex.has(index) || rootManagerIds.has(user.id!)) continue;
    const departmentKey = slots[index].departmentKey;
    const managerId =
      managerIds.find(
        (id) =>
          managerDepartment.get(id) === departmentKey && remaining.get(id)! > 0,
      ) ?? managerIds.find((id) => remaining.get(id)! > 0);
    if (!managerId)
      throw new Error(
        "manager quota exhausted before all current users received a manager",
      );
    user.directManagerId = managerId;
    managerByUserId.set(user.id!, managerId);
    remaining.set(managerId, remaining.get(managerId)! - 1);
  }

  if ([...remaining.values()].some((count) => count !== 0))
    throw new Error("manager quotas do not cover all reporting users");
  return managerByUserId;
}

export function generatePeople(context: DemoContext): PeopleBundle {
  const executiveDepartmentId = context.own(
    "department",
    context.id("department", "executive-office"),
  );
  const departments: Prisma.DepartmentCreateManyInput[] = [
    {
      id: executiveDepartmentId,
      name: "总经办",
      parentId: DEMO_CONFIG.baseDepartments[0].id,
      sortOrder: 9,
      isActive: true,
    },
  ];
  const slots = currentPersonSlots(executiveDepartmentId);
  if (slots.length !== 128)
    throw new Error(
      `current person slots must equal 128; received ${slots.length}`,
    );

  const acceptanceNumbers = new Set<string>(
    Object.values(DEMO_CONFIG.acceptanceEmployeeNos),
  );
  const currentUsers = slots.map((slot, index) => {
    const employeeNo = employeeNumber(index);
    const id = context.own("user", context.id("user", employeeNo));
    return {
      id,
      employeeNo,
      name: personName(index),
      phone: null,
      email: `${employeeNo.toLowerCase()}@example.invalid`,
      passwordHash: acceptanceNumbers.has(employeeNo)
        ? ACCEPTANCE_PASSWORD_HASH
        : null,
      deptId: slot.deptId,
      position: positionFor(index, slot.departmentKey),
      entryDate: entryDate(index),
      plannedRegularDate: null,
      actualRegularDate: null,
      leaveDate: null,
      employmentType: employmentType(index),
      status: PROBATION_INDEXES.has(index) ? "probation" : "active",
      directManagerId: null,
      sysRole: sysRoleFor(index),
      canViewAll: false,
    } satisfies Prisma.UserCreateManyInput;
  });

  const managerIds = MANAGER_INDEXES.map((index) => currentUsers[index].id);
  const managerByUserId = createReportingGraph(currentUsers, slots, managerIds);
  const deptHeadByDepartmentId = new Map<string, string>([
    [BASE_DEPARTMENT_ID.project, currentUsers[0].id],
    [BASE_DEPARTMENT_ID.supplyChain, currentUsers[59].id],
    [BASE_DEPARTMENT_ID.creative, currentUsers[85].id],
    [BASE_DEPARTMENT_ID.hrAdmin, currentUsers[102].id],
    [BASE_DEPARTMENT_ID.sales, currentUsers[110].id],
    [BASE_DEPARTMENT_ID.finance, currentUsers[117].id],
    [executiveDepartmentId, currentUsers[122].id],
    [BASE_DEPARTMENT_ID.beijing, currentUsers[125].id],
    [BASE_DEPARTMENT_ID.digital, currentUsers[127].id],
  ]);
  const approverByDepartmentId = new Map(
    [...deptHeadByDepartmentId.keys()].map((departmentId) => [
      departmentId,
      currentUsers[122].id,
    ]),
  );
  const departmentLeadership = [...deptHeadByDepartmentId].map(
    ([id, leaderId]) => ({
      id,
      leaderId,
      approverId: approverByDepartmentId.get(id)!,
    }),
  );

  const resignedUsers = Array.from(
    { length: DEMO_CONFIG.resignedHistoryCount },
    (_, index) => {
      const employeeNo = `FD80000${index + 1}`;
      return {
        id: context.own("user", context.id("user", employeeNo)),
        employeeNo,
        name: personName(128 + index),
        phone: null,
        email: `${employeeNo.toLowerCase()}@example.invalid`,
        passwordHash: null,
        deptId: BASE_DEPARTMENT_ID.project,
        position: "历史员工",
        entryDate: new Date(Date.UTC(2023, index, 1)),
        leaveDate: new Date(Date.UTC(2025, index + 3, 1)),
        employmentType: "full_time",
        status: "resigned",
        directManagerId: null,
        sysRole: "employee",
        canViewAll: false,
      } satisfies Prisma.UserCreateManyInput;
    },
  );
  const adminEmployeeNo = DEMO_CONFIG.acceptanceEmployeeNos.admin;
  const adminUser: Prisma.UserCreateManyInput = {
    id: context.own("user", context.id("user", adminEmployeeNo)),
    employeeNo: adminEmployeeNo,
    name: "演示系统管理员",
    phone: null,
    email: `${adminEmployeeNo.toLowerCase()}@example.invalid`,
    passwordHash: ACCEPTANCE_PASSWORD_HASH,
    deptId: executiveDepartmentId,
    position: "系统管理员",
    entryDate: new Date(Date.UTC(2024, 0, 1)),
    employmentType: "full_time",
    status: "active",
    directManagerId: null,
    sysRole: "system_admin",
    canViewAll: true,
  };
  const users = [...currentUsers, ...resignedUsers, adminUser];
  const storyUserIds = Object.fromEntries(
    Object.entries(DEMO_CONFIG.storyEmployeeNos).map(([key, employeeNo]) => [
      key,
      context.id("user", employeeNo),
    ]),
  );

  Object.assign(context.manifest.storyUserIds, storyUserIds);
  context.manifest.expectedCounts.currentUsers = currentUsers.length;
  context.manifest.expectedCounts.resignedUsers = resignedUsers.length;
  context.manifest.expectedCounts.managerEdges = managerByUserId.size;

  return {
    departments,
    users,
    baseDepartmentAssertions: [...DEMO_CONFIG.baseDepartments],
    departmentLeadership,
    managerIds,
    managerByUserId,
    deptHeadByDepartmentId,
    approverByDepartmentId,
    storyUserIds,
    acceptanceEmployeeNos: { ...DEMO_CONFIG.acceptanceEmployeeNos },
  };
}
