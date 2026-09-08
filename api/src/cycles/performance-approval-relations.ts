export interface PerformanceApprovalDepartment {
  id: string;
  name?: string | null;
  parentId: string | null;
  leaderId: string | null;
  leaderName?: string | null;
  leaderDirectManagerId?: string | null;
  leaderDirectManagerName?: string | null;
  approverId: string | null;
  approverName?: string | null;
}

export type PerformanceApproverSource =
  | 'department_explicit'
  | 'ancestor_explicit'
  | 'top_department_leader_manager'
  | 'unresolved';

export interface PerformanceApproverInfo {
  approverId: string | null;
  approverName: string | null;
  source: PerformanceApproverSource;
  sourceDeptId: string | null;
  sourceDeptName: string | null;
}

export function buildPerformanceApproverMap(
  departments: PerformanceApprovalDepartment[],
): Map<string, PerformanceApproverInfo> {
  const departmentById = new Map(departments.map((department) => [department.id, department]));

  return new Map(departments.map((department) => {
    const visited = new Set<string>();
    let current: PerformanceApprovalDepartment | undefined = department;
    let depth = 0;

    while (current) {
      if (visited.has(current.id)) return [department.id, unresolved()] as const;
      visited.add(current.id);

      if (current.approverId) {
        return [department.id, {
          approverId: current.approverId,
          approverName: current.approverName ?? null,
          source: depth === 0 ? 'department_explicit' : 'ancestor_explicit',
          sourceDeptId: current.id,
          sourceDeptName: current.name ?? null,
        }] as const;
      }

      if (current.parentId) {
        const parent = departmentById.get(current.parentId);
        if (!parent) return [department.id, unresolved()] as const;
        current = parent;
        depth += 1;
        continue;
      }

      if (current.leaderDirectManagerId) {
        return [department.id, {
          approverId: current.leaderDirectManagerId,
          approverName: current.leaderDirectManagerName ?? null,
          source: 'top_department_leader_manager',
          sourceDeptId: current.id,
          sourceDeptName: current.name ?? null,
        }] as const;
      }
      return [department.id, unresolved()] as const;
    }

    return [department.id, unresolved()] as const;
  }));
}

function unresolved(): PerformanceApproverInfo {
  return {
    approverId: null,
    approverName: null,
    source: 'unresolved',
    sourceDeptId: null,
    sourceDeptName: null,
  };
}
