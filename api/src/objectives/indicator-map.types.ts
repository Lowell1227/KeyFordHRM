import { IndicatorVisibilityScope } from '@prisma/client';

export interface IndicatorMapNode {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  progress: number;
  sortOrder: number;
  visibilityScopes: IndicatorVisibilityScope[];
  owner: {
    id: string;
    name: string;
    deptId: string | null;
    deptName: string | null;
  };
}

export interface IndicatorMapEdge {
  id: string;
  source: string;
  target: string;
}

export interface IndicatorMapResult {
  cycle: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
  };
  roots: string[];
  nodes: IndicatorMapNode[];
  edges: IndicatorMapEdge[];
  sameDepartmentUnaligned: IndicatorMapNode[];
  permissions: {
    viewerTaskId: string;
    viewerId: string;
    managerId: string | null;
    canViewSameDepartment: boolean;
  };
}
