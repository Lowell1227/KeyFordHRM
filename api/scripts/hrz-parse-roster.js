/* 在 HOST 上运行：解析花名册 Excel → 结构化 JSON（部门树 + 用户）。
   不连数据库。输出 api/scripts/hrz-roster.json，容器内经 bind-mount 可读。 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const FILE = 'C:/Users/lwei/Documents/HRzl/绩效导入花名册0606.xlsx';
const OUT = path.join(__dirname, 'hrz-roster.json');

function s(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v).trim();
}
function dateStr(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = s(v);
  if (!t || ['／', '/', '-', '无'].includes(t)) return null;
  const m = t.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}
const blank = (t) => !t || ['／', '/', '-', '无', '。'].includes(t);

const COMPANY = (c) => {
  if (/北京/.test(c)) return 'beijing_fuede';
  if (/凡思堡|凡丝宝/.test(c)) return 'fansibao';
  if (/体育/.test(c)) return 'fuede_sports';
  return 'fuede'; // 孚德 / 协程 / 孚德/协程 / 空
};
const EMP_TYPE = (c) =>
  ({ 全职: 'full_time', 退休返聘: 'rehire', 外部协作: 'external', 兼职: 'part_time' }[c] || 'full_time');
const STATUS = (c) => ({ 正式: 'active', 兼职: 'active', 试用: 'probation', 离职: 'resigned' }[c] || 'active');

function inferRole(position, level) {
  const p = position || '';
  if (/董事长/.test(p)) return 'chairman';
  if (/总经理|CEO|总裁/.test(p)) return 'vp'; // 含 副总裁
  if (/人力行政总监|HRBP|人力资源总监/.test(p)) return 'hr';
  if (/总监/.test(p)) return 'dept_head';
  if (['M3', 'M4', 'M5'].includes(level)) return 'dept_head';
  if (/经理|主管|店长|负责人/.test(p)) return 'manager';
  if (['M1', 'M2'].includes(level)) return 'manager';
  return 'employee';
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet('Sheet1');

  const deptMap = new Map(); // key(path) -> { key, name, parentKey, company }
  function ensureDept(levels, company) {
    // levels: [l1,l2,l3] 已过滤空
    let parentKey = null;
    let key = null;
    for (let i = 0; i < levels.length; i++) {
      key = levels.slice(0, i + 1).join(' / ');
      if (!deptMap.has(key)) {
        deptMap.set(key, { key, name: levels[i], parentKey, company });
      }
      parentKey = key;
    }
    return key; // 最深层 key（无层级时 null）
  }

  const users = [];
  for (let r = 3; r <= ws.rowCount; r++) {
    const get = (c) => s(ws.getRow(r).getCell(c).value);
    const name = get(1);
    const employeeNo = get(2);
    if (!name || !employeeNo) continue;

    const company = COMPANY(get(3));
    const levels = [get(4), get(5), get(6)].filter((x) => !blank(x));
    const deptKey = ensureDept(levels, company);

    const position = get(7);
    const level = get(8);
    users.push({
      employeeNo,
      name,
      position: blank(position) ? null : position,
      jobLevel: blank(level) ? null : level,
      company,
      deptKey,
      managerName: blank(get(9)) ? null : get(9),
      entryDate: dateStr(ws.getRow(r).getCell(10).value),
      workLocation: blank(get(11)) ? null : get(11),
      employmentType: EMP_TYPE(get(12)),
      status: STATUS(get(13)),
      plannedRegularDate: dateStr(ws.getRow(r).getCell(15).value),
      actualRegularDate: dateStr(ws.getRow(r).getCell(16).value),
      sysRole: inferRole(position, level),
      canViewAll: /董事长/.test(position),
    });
  }

  const departments = [...deptMap.values()];
  const out = { departments, users };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

  // 摘要
  const roleCount = {};
  users.forEach((u) => (roleCount[u.sysRole] = (roleCount[u.sysRole] || 0) + 1));
  console.log('部门节点:', departments.length);
  console.log('用户:', users.length);
  console.log('角色分布:', JSON.stringify(roleCount));
  console.log('chairman:', users.filter((u) => u.sysRole === 'chairman').map((u) => u.name).join(','));
  console.log('vp:', users.filter((u) => u.sysRole === 'vp').map((u) => `${u.name}(${u.position})`).join(', '));
  console.log('hr:', users.filter((u) => u.sysRole === 'hr').map((u) => `${u.name}(${u.position})`).join(', '));
  const noMgr = users.filter((u) => u.managerName && !users.some((x) => x.name === u.managerName));
  console.log('上级名找不到对应用户的:', noMgr.length, noMgr.slice(0, 10).map((u) => `${u.name}->${u.managerName}`).join('; '));
  const dupName = users.map((u) => u.name).filter((n, i, a) => a.indexOf(n) !== i);
  console.log('重名:', [...new Set(dupName)].join(',') || '无');
  console.log('\n输出 →', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
