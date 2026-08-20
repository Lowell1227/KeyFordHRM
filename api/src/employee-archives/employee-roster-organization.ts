import { CompanyCode } from "@prisma/client";
import type { ParsedEmployeeRosterRow } from "./employee-roster.excel";

export interface RosterOrganizationNode {
  key: string;
  parentKey: string | null;
  name: string;
  fullPath: string;
  company: CompanyCode;
  depth: number;
  sortOrder: number;
}

type RawRosterOrganizationNode = Omit<RosterOrganizationNode, "sortOrder"> & {
  firstSeen: number;
};

const COMPANY_ORDER = [
  "孚德",
  "孚德体育文化",
  "孚德体育",
  "北京孚德",
  "凡思堡",
  "梵丝宝",
  "协程",
  "孚德/协程",
];

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
  const company = row.employee.companyText?.trim();
  const departmentPath = row.employee.departmentPath.slice(0, departmentLevel);
  if (!company || departmentPath.length === 0) return null;
  return rosterOrganizationKey([company, ...departmentPath]);
}

export function buildRosterOrganizationPlan(
  rows: readonly ParsedEmployeeRosterRow[],
): RosterOrganizationNode[] {
  const rawNodes = new Map<string, RawRosterOrganizationNode>();
  let firstSeen = 0;

  for (const row of rows) {
    const companyText = row.employee.companyText?.trim();
    if (!companyText || row.employee.departmentPath.length === 0) continue;
    const segments = [
      companyText,
      ...row.employee.departmentPath.map((segment) => segment.trim()),
    ];
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
    const preferred =
      left.depth === 0
        ? COMPANY_ORDER
        : left.depth === 1
          ? DEPARTMENT_ORDER
          : [];
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
      result.push({ ...planned, sortOrder });
      append(node.key);
    });
  };
  append(null);
  return result;
}
