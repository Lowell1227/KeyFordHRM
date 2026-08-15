import type { RouteRecordRaw } from 'vue-router';
import type { SysRole } from '@/types/enums';
import type {
  NavigationGroup,
  NavigationItem,
  NavigationMeta,
  NavigationModule,
  NavigationModuleKey,
} from './navigation.types';

export type NavigationUser = Pick<{ sysRole: SysRole; canViewAll: boolean }, 'sysRole' | 'canViewAll'>;

const moduleDefinitions: Record<NavigationModuleKey, Pick<NavigationModule, 'label' | 'order'>> = {
  workbench: { label: '工作台', order: 10 },
  performance: { label: '绩效', order: 20 },
  people: { label: '试用期与转正', order: 30 },
  analysis: { label: '分析与设置', order: 40 },
};

function canSeeRoute(route: RouteRecordRaw, user: NavigationUser): boolean {
  const roles = route.meta?.roles;
  return !roles || roles.includes(user.sysRole);
}

function navigationMeta(route: RouteRecordRaw): NavigationMeta | null {
  const meta = route.meta?.navigation;
  if (!meta || typeof route.name !== 'string') return null;
  return meta;
}

function groupKey(meta: NavigationMeta, route: RouteRecordRaw): string {
  return meta.group ?? `${meta.module}:${String(route.name)}`;
}

export function buildNavigation(routes: readonly RouteRecordRaw[], user: NavigationUser): NavigationModule[] {
  const modules = new Map<NavigationModuleKey, NavigationModule>();

  for (const route of routes) {
    const meta = navigationMeta(route);
    if (!meta || !canSeeRoute(route, user)) continue;

    const moduleDefinition = moduleDefinitions[meta.module];
    const module = modules.get(meta.module) ?? {
      key: meta.module,
      ...moduleDefinition,
      defaultPath: route.path,
      groups: [],
    };
    const key = groupKey(meta, route);
    let group = module.groups.find((candidate) => candidate.key === key);
    if (!group) {
      group = { key, label: meta.groupLabel ?? '', items: [] };
      module.groups.push(group);
    }

    const item: NavigationItem = {
      name: route.name as NavigationItem['name'],
      path: route.path,
      label: meta.label,
      order: meta.order,
    };
    group.items.push(item);
    modules.set(meta.module, module);
  }

  return [...modules.values()]
    .map((module) => {
      const groups = module.groups
        .map((group): NavigationGroup => ({
          ...group,
          items: [...group.items].sort((left, right) => left.order - right.order),
        }))
        .sort((left, right) => left.items[0].order - right.items[0].order);
      return { ...module, defaultPath: groups[0].items[0].path, groups };
    })
    .sort((left, right) => left.order - right.order);
}
