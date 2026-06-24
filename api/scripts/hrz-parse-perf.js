/* HOST 运行：解析两个高管绩效 Excel 全部 sheet → 模板 JSON。
   输出 api/scripts/hrz-templates.json。莫天飞重复，仅取首次。 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const FILES = [
  'C:/Users/lwei/Documents/HRzl/郭总分管-业务老大绩效0617（无薪版）.xlsx',
  'C:/Users/lwei/Documents/HRzl/倪总分管-业务老大绩效0617（无薪版）.xlsx',
];
const OUT = path.join(__dirname, 'hrz-templates.json');

function s(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return '';
  }
  return String(v);
}
const norm = (t) => s(t).replace(/[ \t]+/g, ' ').replace(/ /g, ' ').trim();
const WEIGHT_RE = /[（(]\s*(\d+(?:\.\d+)?)\s*%\s*[)）]/;
function splitNameWeight(raw) {
  const t = norm(raw);
  const m = t.match(WEIGHT_RE);
  const weight = m ? Number(m[1]) / 100 : null;
  // 名称里折叠全部空白（含换行），避免 "净利润完成率\n（项目三部）" 这类
  const name = t.replace(WEIGHT_RE, '').replace(/\s+/g, ' ').trim();
  return { name, weight };
}
function dimType(name) {
  if (/扣分|减分/.test(name)) return 'penalty';
  if (/加分/.test(name)) return 'bonus';
  if (/团队/.test(name)) return 'attitude';
  return 'kpi'; // 业务及其它
}
const after = (t, label) => { t = norm(t); const i = t.indexOf(label); return i >= 0 ? t.slice(i + label.length).replace(/^[：:]/, '').trim() : ''; };

function parseSheet(ws) {
  const r2c1 = norm(ws.getRow(2).getCell(1).value);
  const r2c3 = norm(ws.getRow(2).getCell(3).value);
  const r2c5 = norm(ws.getRow(2).getCell(5).value);
  const execName = after(r2c1, '姓名') || ws.name;
  const dept = after(r2c3, '部门');
  const period = after(r2c5, '考核周期');

  const dims = []; // {key,name,type,weight, inds:[{key,name,subWeight, desc, standards:[], dataSource}]}
  const dimByKey = new Map();
  const indByKey = new Map();

  for (let r = 5; r <= ws.rowCount; r++) {
    const c1 = norm(ws.getRow(r).getCell(1).value);
    const c2 = norm(ws.getRow(r).getCell(2).value);
    const c3 = norm(ws.getRow(r).getCell(3).value);
    const c4 = norm(ws.getRow(r).getCell(4).value);
    if (/^(总评|签字确认|签订)/.test(c1)) break; // 表尾，停止
    if (!c1 || !c2) continue;

    const dim = splitNameWeight(c1);
    if (!dim.name) continue;
    let dimRec = dimByKey.get(c1);
    if (!dimRec) {
      dimRec = { key: c1, name: dim.name, type: dimType(dim.name), weight: dim.weight ?? 0, inds: [] };
      dimByKey.set(c1, dimRec);
      dims.push(dimRec);
    }

    const ind = splitNameWeight(c2);
    const indKey = c1 + '||' + c2;
    let indRec = indByKey.get(indKey);
    if (!indRec) {
      indRec = { key: indKey, name: ind.name || c2, subWeight: ind.weight, desc: '', standards: [], dataSource: '' };
      indByKey.set(indKey, indRec);
      dimRec.inds.push(indRec);
    }
    // 首行（非 合格/良好/优秀 开头）作为目标说明，其余作为评分标准
    if (c3) {
      if (/^(合格|良好|优秀|及格)/.test(c3)) indRec.standards.push(c3);
      else if (!indRec.desc) indRec.desc = c3;
      else indRec.standards.push(c3);
    }
    if (c4 && !indRec.dataSource) indRec.dataSource = c4;
  }

  // 归一化指标权重 = 子权重 / 维度权重；penalty/无权重维度 → 平均分
  const dimensions = dims.map((d) => {
    const inds = d.inds;
    const indicators = inds.map((i) => {
      let w;
      if (d.weight > 0 && i.subWeight != null) w = i.subWeight / d.weight;
      else w = 1 / inds.length; // 扣分项/无权重，平均
      return {
        name: i.name,
        weight: Number(w.toFixed(4)),
        description: i.desc || null,
        scoringStandard: i.standards.join('\n') || null,
        dataSource: i.dataSource || null,
      };
    });
    return { name: d.name, type: d.type, weight: Number(d.weight.toFixed(4)), indicators };
  });

  return { execName, dept, period, dimensions };
}

(async () => {
  const seen = new Set();
  const templates = [];
  for (const f of FILES) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(f);
    for (const ws of wb.worksheets) {
      const t = parseSheet(ws);
      if (seen.has(t.execName)) { console.log(`跳过重复：${t.execName}`); continue; }
      seen.add(t.execName);
      templates.push(t);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(templates, null, 2), 'utf8');

  console.log(`\n模板数：${templates.length}`);
  for (const t of templates) {
    const dimSum = t.dimensions.filter((d) => d.type === 'kpi' || d.type === 'attitude').reduce((a, d) => a + d.weight, 0);
    console.log(`\n● ${t.execName} (${t.dept})  维度=${t.dimensions.length}  kpi+attitude权重和=${dimSum.toFixed(2)}`);
    for (const d of t.dimensions) {
      const isum = d.indicators.reduce((a, i) => a + i.weight, 0);
      console.log(`   ${d.name}[${d.type} ${d.weight}] 指标=${d.indicators.length} 权重和=${isum.toFixed(3)} → ${d.indicators.map((i) => i.name + '(' + i.weight + ')').join(', ')}`);
    }
  }
  console.log('\n输出 →', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
