import type { RouteRecordName } from 'vue-router';

export type NavigationModuleKey = 'workbench' | 'performance' | 'people' | 'analysis';

export interface NavigationMeta {
  module: NavigationModuleKey;
  label: string;
  order: number;
  group?: string;
  groupLabel?: string;
}

export interface NavigationItem {
  name: RouteRecordName;
  path: string;
  label: string;
  order: number;
}

export interface NavigationGroup {
  key: string;
  label: string;
  items: NavigationItem[];
}

export interface NavigationModule {
  key: NavigationModuleKey;
  label: string;
  order: number;
  defaultPath: string;
  groups: NavigationGroup[];
}

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    public?: boolean;
    layout?: string;
    title?: string;
    roles?: string[];
    navigation?: NavigationMeta;
  }
}
