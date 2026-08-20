import { CompanyCode } from "@prisma/client";
import type { ParsedEmployeeRosterRow } from "./employee-roster.excel";

export interface RosterOrganizationNode {
  key: string;
  parentKey: string | null;
  name: string;
  fullPath: string;
  company: CompanyCode;
  leaderName: string | null;
  depth: number;
  sortOrder: number;
}

type RawRosterOrganizationNode = Omit<RosterOrganizationNode, "sortOrder"> & {
  firstSeen: number;
};

const DEPARTMENT_ORDER = [
  "总经办",
  "人事行政部",
  "财务部",
  "销售部",
  "项目中心",
  "供应链中心",
  "创意设计部",
  "孚德北京办公室",
];

export function mapRosterCompany(value: string): CompanyCode {
  if (value.includes("北京孚德")) return CompanyCode.beijing_fuede;
  if (value.includes("孚德体育")) return CompanyCode.fuede_sports;
  if (value.includes("梵丝宝") || value.includes("凡思堡"))
    return CompanyCode.fansibao;
  return CompanyCode.fuede;
}

export function rosterOrganizationKey(segments: readonly string[]): string {
  return JSON.stringify(segments.map((segment) => segment.trim()));
}

export function rosterOrganizationKeyForRow(
  row: ParsedEmployeeRosterRow,
  departmentLevel = row.employee.departmentPath.length,
): string | null {
  const departmentPath = row.employee.departmentPath.slice(0, departmentLevel);
  if (departmentPath.length === 0) return null;
  return rosterOrganizationKey(departmentPath);
}

function inferLeaderName(
  rows: readonly ParsedEmployeeRosterRow[],
  departmentPath: readonly string[],
): string | null {
  const members = rows.filter((row) => departmentPath.every(
    (segment, index) => row.employee.departmentPath[index]?.trim() === segment,
  ));
  const memberNames = new Set(
    members
      .map((row) => row.employee.name?.trim())
      .filter((name): name is string => Boolean(name)),
  );
  const internalManagerNames = new Set(
    members
      .map((row) => row.employee.managerName?.trim())
      .filter((name): name is string => typeof name === "string" && memberNames.has(name)),
  );
  const boundaryMembers = members.filter((row) => {
    const name = row.employee.name?.trim();
    if (!name) return false;
    const managerName = row.employee.managerName?.trim();
    return !managerName || !memberNames.has(managerName);
  });

  if (boundaryMembers.length === 1) {
    const boundary = boundaryMembers[0];
    const name = boundary.employee.name!.trim();
    const managerName = boundary.employee.managerName?.trim();
    if (!managerName || internalManagerNames.has(name)) return name;
  }

  const externalManagerNames = new Set(
    boundaryMembers
      .map((row) => row.employee.managerName?.trim())
      .filter((name): name is string => Boolean(name)),
  );
  return externalManagerNames.size === 1
    ? [...externalManagerNames][0]
    : null;
}

export function buildRosterOrganizationPlan(
  rows: readonly ParsedEmployeeRosterRow[],
): RosterOrganizationNode[] {
  const rawNodes = new Map<string, RawRosterOrganizationNode>();
  let firstSeen = 0;

  for (const row of rows) {
    const companyText = row.employee.companyText?.trim();
    if (!companyText || row.employee.departmentPath.length === 0) continue;
    const segments = row.employee.departmentPath.map((segment) => segment.trim());
    for (let depth = 0; depth < segments.length; depth++) {
      const currentSegments = segments.slice(0, depth + 1);
      const key = rosterOrganizationKey(currentSegments);
      if (rawNodes.has(key)) continue;
      rawNodes.set(key, {
        key,
        parentKey:
          depth === 0
            ? null
            : rosterOrganizationKey(currentSegments.slice(0, -1)),
        name: currentSegments.at(-1)!,
        fullPath: currentSegments.join(" / "),
        company: mapRosterCompany(companyText),
        leaderName: null,
        depth,
        firstSeen: firstSeen++,
      });
    }
  }

  const childrenByParent = new Map<
    string | null,
    RawRosterOrganizationNode[]
  >();
  for (const node of rawNodes.values()) {
    const children = childrenByParent.get(node.parentKey) ?? [];
    children.push(node);
    childrenByParent.set(node.parentKey, children);
  }

  const compareNodes = (
    left: RawRosterOrganizationNode,
    right: RawRosterOrganizationNode,
  ) => {
    const preferred = left.depth === 0 ? DEPARTMENT_ORDER : [];
    const leftRank = preferred.indexOf(left.name);
    const rightRank = preferred.indexOf(right.name);
    if (leftRank !== rightRank) {
      if (leftRank === -1) return 1;
      if (rightRank === -1) return -1;
      return leftRank - rightRank;
    }
    return (
      left.firstSeen - right.firstSeen ||
      left.name.localeCompare(right.name, "zh-CN")
    );
  };

  const result: RosterOrganizationNode[] = [];
  const append = (parentKey: string | null) => {
    const children = [...(childrenByParent.get(parentKey) ?? [])].sort(
      compareNodes,
    );
    children.forEach((node, sortOrder) => {
      const { firstSeen: _firstSeen, ...planned } = node;
      result.push({
        ...planned,
        leaderName: inferLeaderName(
          rows,
          planned.fullPath.split(" / "),
        ),
        sortOrder,
      });
      append(node.key);
    });
  };
  append(null);
  return result;
}
