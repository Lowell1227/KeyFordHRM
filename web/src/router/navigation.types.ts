import type { RouteRecordName } from 'vue-router';
import type { BusinessCapabilities } from '@/types/api.types';

export type NavigationModuleKey =
  | 'workbench'
  | 'performance'
  | 'people'
  | 'recruitment'
  | 'compensation'
  | 'system';
export type NavigationModuleStatus = 'paused';
export type BusinessCapabilityKey = Exclude<keyof BusinessCapabilities, 'identities'>;

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
  status?: NavigationModuleStatus;
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
    capability?: BusinessCapabilityKey;
    navigation?: NavigationMeta;
  }
}
