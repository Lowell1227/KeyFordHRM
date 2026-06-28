export interface DepartmentRelationRecord {
  id: string;
  name?: string | null;
  parentId: string | null;
  leaderId: string | null;
  leaderName?: string | null;
  approverId: string | null;
  approverName?: string | null;
}

export type EffectiveApproverSource =
  | 'manual_override'
  | 'parent_leader'
  | 'ancestor_chain'
  | 'unresolved';

export interface EffectiveApproverInfo {
  effectiveApproverId: string | null;
  effectiveApproverName: string | null;
  effectiveApproverSource: EffectiveApproverSource;
  sourceDeptId: string | null;
  sourceDeptName: string | null;
}

export function buildEffectiveApproverMap(
  departments: DepartmentRelationRecord[],
): Map<string, EffectiveApproverInfo> {
  const deptMap = new Map(departments.map((dept) => [dept.id, dept]));
  const memo = new Map<string, EffectiveApproverInfo>();

  const resolve = (deptId: string, stack = new Set<string>()): EffectiveApproverInfo => {
    if (memo.has(deptId)) return memo.get(deptId)!;
    if (stack.has(deptId)) {
      return unresolved();
    }

    const current = deptMap.get(deptId);
    if (!current) return unresolved();

    if (current.approverId) {
      const info: EffectiveApproverInfo = {
        effectiveApproverId: current.approverId,
        effectiveApproverName: current.approverName ?? null,
        effectiveApproverSource: 'manual_override',
        sourceDeptId: current.id,
        sourceDeptName: current.name ?? null,
      };
      memo.set(deptId, info);
      return info;
    }

    const nextStack = new Set(stack);
    nextStack.add(deptId);

    const parent = current.parentId ? deptMap.get(current.parentId) : null;
    if (!parent) {
      const info = unresolved();
      memo.set(deptId, info);
      return info;
    }

    if (parent.leaderId) {
      const info: EffectiveApproverInfo = {
        effectiveApproverId: parent.leaderId,
        effectiveApproverName: parent.leaderName ?? null,
        effectiveApproverSource: 'parent_leader',
        sourceDeptId: parent.id,
        sourceDeptName: parent.name ?? null,
      };
      memo.set(deptId, info);
      return info;
    }

    const inherited = resolve(parent.id, nextStack);
    const info: EffectiveApproverInfo = inherited.effectiveApproverId
      ? {
          effectiveApproverId: inherited.effectiveApproverId,
          effectiveApproverName: inherited.effectiveApproverName,
          effectiveApproverSource: 'ancestor_chain',
          sourceDeptId: inherited.sourceDeptId,
          sourceDeptName: inherited.sourceDeptName,
        }
      : unresolved();

    memo.set(deptId, info);
    return info;
  };

  departments.forEach((dept) => {
    if (!memo.has(dept.id)) {
      memo.set(dept.id, resolve(dept.id));
    }
  });

  return memo;
}

export function findDepartmentsByEffectiveApprover(
  departments: DepartmentRelationRecord[],
  userId: string,
): string[] {
  const effectiveMap = buildEffectiveApproverMap(departments);
  return departments
    .filter((dept) => effectiveMap.get(dept.id)?.effectiveApproverId === userId)
    .map((dept) => dept.id);
}

function unresolved(): EffectiveApproverInfo {
  return {
    effectiveApproverId: null,
    effectiveApproverName: null,
    effectiveApproverSource: 'unresolved',
    sourceDeptId: null,
    sourceDeptName: null,
  };
}
