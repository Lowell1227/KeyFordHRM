/**
 * 种子数据：系统配置默认值 + 顶层部门结构
 * 对照 02_DDL.sql 第 5 节。leader_id / approver_id 在钉钉同步出核心用户后再回填。
 * 幂等：使用 upsert，可重复执行。
 */
import { PrismaClient, CompanyCode, SysRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// 系统配置默认值（DDL 5.1）
const SYSTEM_CONFIGS: { key: string; value: unknown; description: string }[] = [
  { key: 'grade_distribution', value: { A: 0.2, B: 0.4, C: 0.3, D: 0.1 }, description: '强制等级分布比例上限，超出仅预警不阻断（D3）' },
  { key: 'grade_coefficients', value: { A: 1.2, B: 1.0, C: 0.8, D: 0.6 }, description: '各等级绩效系数（字段保留，暂不在 UI 显示，D13）' },
  { key: 'grade_score_mapping', value: { A: 90, B: 75, C: 60 }, description: '评分→初始等级映射：≥90=A,≥75=B,≥60=C,<60=D（仅供参考，最终以 HR 校准为准）' },
  { key: 'appeal_window_days', value: 30, description: '申诉窗口期天数，从公示日起计算（D6）' },
  { key: 'exempt_threshold_ratio', value: 0.3333, description: '在岗时间不足此比例则自动豁免（D10）' },
  { key: 'dingtalk_sync_cron', value: '0 2 * * *', description: '钉钉组织架构同步定时任务，每日凌晨 2 点' },
  { key: 'deadline_reminder_days', value: 3, description: '节点截止前提前 N 天推送提醒，默认 3 天' },
  { key: 'probation_duration_days', value: 90, description: '试用期默认天数，超出后系统触发转正提醒' },
  { key: 'notification_channels', value: ['dingtalk'], description: '默认通知渠道' },
  { key: 'system_name', value: '孚德绩效管理系统', description: '系统名称' },
  { key: 'company_full_name', value: '杭州孚德品牌管理有限公司', description: '主体公司全名' },
];

// 顶层部门结构（DDL 5.2），均属孚德主体
const DEPARTMENTS: { id: string; name: string; parentId: string | null; sortOrder: number; isActive?: boolean }[] = [
  { id: '00000000-0000-0000-0000-000000000001', name: '杭州孚德品牌管理有限公司', parentId: null, sortOrder: 0, isActive: false },
  { id: '00000000-0000-0000-0000-000000000010', name: '项目中心', parentId: '00000000-0000-0000-0000-000000000001', sortOrder: 1 },
  { id: '00000000-0000-0000-0000-000000000011', name: '孚德北京办公室', parentId: '00000000-0000-0000-0000-000000000001', sortOrder: 2 },
  { id: '00000000-0000-0000-0000-000000000014', name: '销售部', parentId: '00000000-0000-0000-0000-000000000001', sortOrder: 3 },
  { id: '00000000-0000-0000-0000-000000000013', name: '创意设计部', parentId: '00000000-0000-0000-0000-000000000001', sortOrder: 4 },
  { id: '00000000-0000-0000-0000-000000000012', name: '供应链中心', parentId: '00000000-0000-0000-0000-000000000001', sortOrder: 5 },
  { id: '00000000-0000-0000-0000-000000000015', name: '数字化运营部', parentId: '00000000-0000-0000-0000-000000000001', sortOrder: 6 },
  { id: '00000000-0000-0000-0000-000000000016', name: '人事行政部', parentId: '00000000-0000-0000-0000-000000000001', sortOrder: 7 },
  { id: '00000000-0000-0000-0000-000000000018', name: '财务部', parentId: '00000000-0000-0000-0000-000000000001', sortOrder: 8 },
  { id: '00000000-0000-0000-0000-000000000017', name: '行政部', parentId: '00000000-0000-0000-0000-000000000001', sortOrder: 98, isActive: false },
  { id: '00000000-0000-0000-0000-000000000019', name: '创新业务中心', parentId: '00000000-0000-0000-0000-000000000001', sortOrder: 99, isActive: false },
  { id: '00000000-0000-0000-0000-000000000020', name: '外援', parentId: '00000000-0000-0000-0000-000000000001', sortOrder: 100, isActive: false },
  { id: '00000000-0000-0000-0000-000000000101', name: '项目一部', parentId: '00000000-0000-0000-0000-000000000010', sortOrder: 1 },
  { id: '00000000-0000-0000-0000-000000000102', name: '项目二部', parentId: '00000000-0000-0000-0000-000000000010', sortOrder: 2 },
  { id: '00000000-0000-0000-0000-000000000103', name: '项目三部', parentId: '00000000-0000-0000-0000-000000000010', sortOrder: 3 },
  { id: '00000000-0000-0000-0000-000000000104', name: '项目管理和运营部', parentId: '00000000-0000-0000-0000-000000000010', sortOrder: 4 },
  { id: '00000000-0000-0000-0000-000000000105', name: '直播电商部', parentId: '00000000-0000-0000-0000-000000000010', sortOrder: 5 },
  { id: '00000000-0000-0000-0000-000000000106', name: '视觉设计部', parentId: '00000000-0000-0000-0000-000000000010', sortOrder: 6 },
  { id: '00000000-0000-0000-0000-000000000107', name: '客服部', parentId: '00000000-0000-0000-0000-000000000010', sortOrder: 7 },
  { id: '00000000-0000-0000-0000-000000001011', name: '北京国安世茂工三店', parentId: '00000000-0000-0000-0000-000000000101', sortOrder: 1 },
  { id: '00000000-0000-0000-0000-000000001021', name: '浙江FC黄龙店', parentId: '00000000-0000-0000-0000-000000000102', sortOrder: 1 },
  { id: '00000000-0000-0000-0000-000000000121', name: '仓储定制部', parentId: '00000000-0000-0000-0000-000000000012', sortOrder: 1 },
  { id: '00000000-0000-0000-0000-000000000122', name: '供应链管理部', parentId: '00000000-0000-0000-0000-000000000012', sortOrder: 2 },
  { id: '00000000-0000-0000-0000-000000000141', name: '线下零售组', parentId: '00000000-0000-0000-0000-000000000014', sortOrder: 1 },
  { id: '00000000-0000-0000-0000-000000000142', name: 'B2B销售组', parentId: '00000000-0000-0000-0000-000000000014', sortOrder: 2 },
  { id: '00000000-0000-0000-0000-000000000201', name: '吉客云系统外援', parentId: '00000000-0000-0000-0000-000000000020', sortOrder: 1, isActive: false },
  { id: '00000000-0000-0000-0000-000000000202', name: '外援组1', parentId: '00000000-0000-0000-0000-000000000020', sortOrder: 2, isActive: false },
  { id: '00000000-0000-0000-0000-000000000203', name: '协泰外援', parentId: '00000000-0000-0000-0000-000000000020', sortOrder: 3, isActive: false },
];

async function seedAdminIfNeeded() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    console.log('▶ 未设置 SEED_ADMIN_PASSWORD，跳过测试管理员创建');
    return;
  }

  console.log('▶ 创建测试管理员（来自 SEED_ADMIN_PASSWORD）...');
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await prisma.user.upsert({
    where: { employeeNo: 'ADMIN' },
    update: {
      name: '系统管理员',
      passwordHash,
      sysRole: SysRole.system_admin,
      canViewAll: true,
      status: 'active',
      deletedAt: null,
    },
    create: {
      employeeNo: 'ADMIN',
      name: '系统管理员',
      passwordHash,
      sysRole: SysRole.system_admin,
      canViewAll: true,
      status: 'active',
    },
  });
}

async function main() {
  console.log('▶ 写入系统配置...');
  for (const cfg of SYSTEM_CONFIGS) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      update: { value: cfg.value as object, description: cfg.description },
      create: { key: cfg.key, value: cfg.value as object, description: cfg.description },
    });
  }

  console.log('▶ 写入部门结构...');
  // 先建父后建子（数组已按层级排序），保证 parent_id 外键有效
  for (const dept of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { id: dept.id },
      update: { name: dept.name, parentId: dept.parentId, sortOrder: dept.sortOrder, isActive: dept.isActive ?? true },
      create: {
        id: dept.id,
        name: dept.name,
        parentId: dept.parentId,
        sortOrder: dept.sortOrder,
        isActive: dept.isActive ?? true,
        company: CompanyCode.fuede,
      },
    });
  }

  await seedAdminIfNeeded();

  console.log('✓ 种子数据完成');
  console.log('  注意：分管总管辖范围（D16）需在钉钉同步出李宏/倪靖/郭志浩后，');
  console.log('        通过 departments.approver_id 回填（见 DDL 5.3 注释）。');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
