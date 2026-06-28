<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  HomeFilled,
  UserFilled,
  OfficeBuilding,
  List,
  Calendar,
  EditPen,
  ScaleToOriginal,
  Finished,
  MessageBox,
  TrendCharts,
  Notification,
  ChatDotRound,
  Warning,
  Aim,
  Briefcase,
  Files,
  Clock,
  Money,
  ArrowDown,
} from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

type MenuGroupKey = 'home' | 'templateIndicator' | 'performance' | 'mine' | 'people' | 'report';

interface MenuItem {
  path: string;
  title: string;
  icon: any;
  roles?: string[];
  group: MenuGroupKey;
  accent?: 'gold' | 'blue' | 'green' | 'red' | 'purple';
}

interface RailItem {
  key: string;
  title: string;
  icon: any;
  open: boolean;
  route?: string;
}

const menus = computed<MenuItem[]>(() => {
  // 菜单是粗过滤，真正鉴权以页面/接口为准。
  // 结果审批：审批权由 task.approver_id 决定，菜单仅按常见审批角色收敛可见范围。
  const all: MenuItem[] = [
    { path: '/dashboard', title: '首页', icon: HomeFilled, group: 'home' },
    { path: '/tasks', title: '绩效考核', icon: EditPen, group: 'mine' },
    {
      path: '/objectives',
      title: '目标地图',
      icon: Aim,
      roles: ['manager', 'dept_head', 'vp', 'hr', 'chairman', 'system_admin'],
      group: 'performance',
    },
    {
      path: '/action-items',
      title: '行动计划',
      icon: List,
      roles: ['manager', 'dept_head', 'vp', 'hr', 'chairman', 'system_admin'],
      group: 'performance',
    },
    {
      path: '/manager/scoring',
      title: '团队绩效',
      icon: UserFilled,
      roles: ['manager', 'dept_head', 'vp', 'hr', 'system_admin'],
      group: 'performance',
    },
    {
      path: '/cycles',
      title: '绩效计划制定',
      icon: Calendar,
      roles: ['hr', 'system_admin'],
      group: 'performance',
      accent: 'gold',
    },
    {
      path: '/calibration',
      title: '绩效评定',
      icon: ScaleToOriginal,
      roles: ['hr', 'system_admin'],
      group: 'performance',
      accent: 'blue',
    },
    {
      path: '/interviews',
      title: '绩效面谈',
      icon: ChatDotRound,
      roles: ['manager', 'dept_head', 'vp', 'hr', 'system_admin'],
      group: 'performance',
    },
    { path: '/improvement-plans', title: '绩效改进计划', icon: Warning, group: 'performance' },
    {
      path: '/publish',
      title: '结果公示',
      icon: Notification,
      roles: ['hr', 'system_admin'],
      group: 'performance',
    },
    { path: '/appeals', title: '申诉计划', icon: MessageBox, roles: ['hr', 'system_admin'], group: 'performance' },
    { path: '/indicators', title: '指标库', icon: OfficeBuilding, roles: ['hr', 'system_admin'], group: 'templateIndicator' },
    {
      path: '/probation-reviews/manage',
      title: '试用期考核管理',
      icon: Calendar,
      roles: ['hr', 'system_admin'],
      group: 'people',
    },
    {
      path: '/probation-reviews/manager',
      title: '试用期评分',
      icon: UserFilled,
      roles: ['manager', 'dept_head', 'vp', 'hr', 'system_admin'],
      group: 'people',
    },
    { path: '/probation-reviews/mine', title: '试用期考核', icon: EditPen, group: 'mine' },
    {
      path: '/confirmation-applications/manage',
      title: '转正申请管理',
      icon: Calendar,
      roles: ['hr', 'system_admin'],
      group: 'people',
    },
    {
      path: '/confirmation-applications/approvals',
      title: '转正审批台',
      icon: Finished,
      roles: ['manager', 'dept_head', 'vp', 'hr', 'chairman', 'system_admin'],
      group: 'people',
    },
    { path: '/confirmation-applications/mine', title: '转正申请', icon: EditPen, group: 'mine' },
    { path: '/reports', title: '报表分析', icon: TrendCharts, roles: ['hr', 'system_admin', 'vp', 'chairman'], group: 'report' },
    { path: '/users', title: '用户管理', icon: UserFilled, roles: ['hr', 'system_admin'], group: 'people' },
  ];
  return all.filter((m) => {
    if (!m.roles) return true;
    return auth.user && m.roles.includes(auth.user.sysRole);
  });
});

const isHrAdmin = computed(() => ['system_admin', 'hr'].includes(auth.user?.sysRole ?? ''));

const railItems = computed<RailItem[]>(() => {
  const all: RailItem[] = [
    { key: 'workbench', title: '工作台', icon: HomeFilled, open: false },
    { key: 'task', title: '任务', icon: Finished, open: false },
    { key: 'project', title: '项目', icon: Files, open: false },
    { key: 'performance', title: '绩效', icon: Briefcase, open: true, route: '/dashboard' },
    { key: 'attendance', title: '考勤', icon: Clock, open: false },
    { key: 'salary', title: '薪酬', icon: Money, open: false },
  ];
  return isHrAdmin.value ? all : all.filter((item) => item.open);
});

const groupedMenus = computed(() => {
  const visible = menus.value;
  return [
    { key: 'home', title: '', items: visible.filter((m) => m.group === 'home') },
    { key: 'mine', title: '我的绩效', items: visible.filter((m) => m.group === 'mine') },
    { key: 'performance', title: '绩效管理', items: visible.filter((m) => m.group === 'performance') },
    { key: 'templateIndicator', title: '模板指标', items: visible.filter((m) => m.group === 'templateIndicator') },
    { key: 'people', title: '人员流程', items: visible.filter((m) => m.group === 'people') },
    { key: 'report', title: '报表分析', items: visible.filter((m) => m.group === 'report') },
  ].filter((g) => g.items.length);
});

const COLLAPSED_GROUPS_KEY = 'kayford.sidebar.collapsedGroups';

function readCollapsedGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'boolean'),
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveCollapsedGroups(value: Record<string, boolean>) {
  localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(value));
}

const collapsedGroups = ref<Record<string, boolean>>(readCollapsedGroups());
const activePath = computed(() => route.path);

function navigate(path: string) {
  router.push(path);
}

function handleRailClick(item: RailItem) {
  if (!item.open) {
    ElMessage.info(`${item.title}模块未开放`);
    return;
  }
  if (item.route) navigate(item.route);
}

function toggleGroup(key: string) {
  collapsedGroups.value[key] = !collapsedGroups.value[key];
  saveCollapsedGroups(collapsedGroups.value);
}
</script>

<template>
  <aside class="app-sidebar">
    <nav class="app-rail" aria-label="主模块">
      <div class="rail-logo" aria-label="KAYFORD 孚德">
        <img src="/kayford-logo.jpg" alt="KAYFORD 孚德" />
      </div>
      <button
        v-for="item in railItems"
        :key="item.key"
        class="rail-item"
        :class="{ 'is-active': item.key === 'performance', 'is-locked': !item.open }"
        type="button"
        :aria-disabled="!item.open"
        @click="handleRailClick(item)"
      >
        <span class="rail-icon">
          <el-icon><component :is="item.icon" /></el-icon>
        </span>
        <span>{{ item.title }}</span>
        <span v-if="!item.open" class="rail-watermark">未开放</span>
      </button>
    </nav>

    <div class="menu-panel">
      <div class="menu-brand">
        <span class="menu-brand__mark">
          <el-icon><Briefcase /></el-icon>
        </span>
        <span>绩效</span>
      </div>

      <div class="menu-scroll">
        <section v-for="group in groupedMenus" :key="group.key" class="menu-group">
          <button
            v-if="group.key === 'home'"
            class="menu-link menu-link--home"
            :class="{ 'is-active': activePath === group.items[0].path }"
            type="button"
            @click="navigate(group.items[0].path)"
          >
            <el-icon><component :is="group.items[0].icon" /></el-icon>
            <span>{{ group.items[0].title }}</span>
          </button>

          <template v-else>
            <button
              class="menu-group__title"
              type="button"
              :aria-expanded="!collapsedGroups[group.key]"
              @click="toggleGroup(group.key)"
            >
              <el-icon><component :is="group.items[0].icon" /></el-icon>
              <span>{{ group.title }}</span>
              <el-icon class="menu-arrow" :class="{ 'is-collapsed': collapsedGroups[group.key] }">
                <ArrowDown />
              </el-icon>
            </button>
            <div v-show="!collapsedGroups[group.key]" class="menu-group__items">
              <button
                v-for="menu in group.items"
                :key="menu.path"
                class="menu-link"
                :class="[
                  { 'is-active': activePath === menu.path },
                  menu.accent ? `menu-link--${menu.accent}` : '',
                ]"
                type="button"
                @click="navigate(menu.path)"
              >
                <span class="menu-dot" />
                <span>{{ menu.title }}</span>
                <span class="menu-more">...</span>
              </button>
            </div>
          </template>
        </section>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  width: 228px;
  flex-shrink: 0;
  height: 100%;
  display: flex;
  background: #fff;
  box-shadow: 16px 0 30px rgba(91, 119, 255, 0.05);
  z-index: 2;
}

.app-rail {
  width: 58px;
  min-width: 58px;
  padding: 14px 8px 16px;
  background: linear-gradient(180deg, #8268ff 0%, #356bff 100%);
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
}

.rail-logo {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 10px 18px rgba(24, 35, 104, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.rail-logo img {
  width: 36px;
  height: 36px;
  object-fit: contain;
  display: block;
}

.rail-item {
  position: relative;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.86);
  font-size: 11px;
  line-height: 1.2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 0;
  cursor: pointer;
}

.rail-item.is-locked {
  cursor: not-allowed;
}

.rail-item.is-locked::after {
  content: '';
  position: absolute;
  inset: -4px -5px;
  border-radius: 6px;
  background: rgba(27, 42, 112, 0.1);
  opacity: 0;
  transition: opacity 0.18s;
}

.rail-item.is-locked:hover::after {
  opacity: 1;
}

.rail-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.rail-item.is-active .rail-icon {
  background: #fff;
  color: #5b62ff;
  box-shadow: 0 8px 18px rgba(31, 35, 41, 0.14);
}

.rail-watermark {
  position: absolute;
  left: 8px;
  top: -4px;
  z-index: 3;
  width: 42px;
  height: 18px;
  border: 1px solid rgba(255, 255, 255, 0.82);
  border-radius: 3px;
  color: #fff;
  background: rgba(31, 49, 136, 0.5);
  font-size: 9px;
  line-height: 16px;
  text-align: center;
  transform: rotate(-12deg);
  pointer-events: none;
  opacity: 0.78;
  box-sizing: border-box;
}

.rail-item.is-locked:hover .rail-watermark {
  opacity: 1;
}

.menu-panel {
  width: 170px;
  min-width: 170px;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.menu-brand {
  height: 58px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 18px;
  font-weight: 700;
  color: #2d3558;
  box-sizing: border-box;
}

.menu-brand__mark {
  width: 19px;
  height: 19px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: #5d82ff;
  background: #edf2ff;
  font-size: 13px;
}

.menu-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 10px 18px;
}

.menu-group {
  margin-bottom: 10px;
}

.menu-group__title,
.menu-link {
  width: 100%;
  height: 38px;
  border: 0;
  border-radius: 2px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 11px;
  color: #646b86;
  background: transparent;
  font-size: 13px;
  text-align: left;
  box-sizing: border-box;
}

.menu-group__title {
  color: #343a57;
  font-weight: 700;
  cursor: pointer;
}

.menu-group__title:hover {
  background: #f5f7ff;
}

.menu-group__items {
  padding-top: 2px;
}

.menu-arrow {
  margin-left: auto;
  color: #9da6c0;
  font-size: 12px;
  transition: transform 0.18s;
}

.menu-arrow.is-collapsed {
  transform: rotate(-90deg);
}

.menu-link {
  cursor: pointer;
  margin: 2px 0;
  transition: background 0.18s, color 0.18s;
}

.menu-link:hover,
.menu-link.is-active {
  color: #5067e8;
  background: #eef2ff;
}

.menu-link--home {
  font-weight: 700;
}

.menu-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #9aa8ff;
  flex-shrink: 0;
}

.menu-link--gold .menu-dot {
  background: #ffc247;
}

.menu-link--blue .menu-dot {
  background: #5d78ff;
}

.menu-link--green .menu-dot {
  background: #91d569;
}

.menu-link--red .menu-dot {
  background: #ff6f91;
}

.menu-link--purple .menu-dot {
  background: #a779ff;
}

.menu-more {
  margin-left: auto;
  color: #aeb5c8;
  letter-spacing: 1px;
}

.menu-link:not(:hover):not(.is-active) .menu-more {
  opacity: 0;
}

@media (max-width: 1180px) {
  .app-sidebar {
    width: 210px;
  }

  .app-rail {
    width: 54px;
    min-width: 54px;
    padding-inline: 7px;
    gap: 12px;
  }

  .rail-icon {
    width: 30px;
    height: 30px;
  }

  .menu-panel {
    width: 156px;
    min-width: 156px;
  }

  .menu-group__title,
  .menu-link {
    height: 36px;
    gap: 8px;
    padding-inline: 9px;
    font-size: 12px;
  }
}

@media (max-width: 768px) {
  .app-sidebar {
    width: 100%;
    height: auto;
    flex-direction: column;
  }

  .app-rail {
    width: 100%;
    min-width: 0;
    height: 58px;
    padding: 7px 10px;
    flex-direction: row;
    justify-content: flex-start;
    gap: 10px;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .app-rail::-webkit-scrollbar {
    display: none;
  }

  .rail-logo {
    display: none;
  }

  .rail-item {
    min-width: 46px;
    flex-shrink: 0;
    gap: 4px;
    font-size: 10px;
  }

  .rail-icon {
    width: 30px;
    height: 30px;
    border-radius: 9px;
  }

  .rail-watermark {
    left: 50%;
    top: -1px;
    transform: translateX(-50%) rotate(-12deg);
  }

  .menu-panel {
    width: 100%;
    min-width: 0;
  }

  .menu-brand {
    display: none;
  }

  .menu-scroll {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 8px 10px 9px;
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
  }

  .menu-scroll::-webkit-scrollbar {
    display: none;
  }

  .menu-group {
    min-width: 142px;
    margin-bottom: 0;
    scroll-snap-align: start;
  }

  .menu-group__title,
  .menu-link {
    height: 34px;
    font-size: 12px;
  }
}

@media (max-width: 480px) {
  .menu-group {
    min-width: 132px;
  }

  .menu-group__title,
  .menu-link {
    padding-inline: 8px;
    gap: 7px;
  }
}
</style>
