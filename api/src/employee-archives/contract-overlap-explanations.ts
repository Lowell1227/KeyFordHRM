type Contract = Record<string, any>;
const day = (value: any): string | null => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString().slice(0, 10) : null;
const text = (value: any) => typeof value === 'string' ? value.trim() : '';
const company = (c: Contract) => c.contractType === 'transfer' ? text(c.newCompany) || text(c.signingCompany) : text(c.signingCompany);
const agreement = (c: Contract) => `${text(c.name)} ${text(c.termType)}`;

/** Explain observed overlaps, without deciding validity or changing contract dates. */
export function explainContractOverlap(first: Contract, second: Contract) {
  const [a, b] = day(first.effectiveFrom)! <= day(second.effectiveFrom)! ? [first, second] : [second, first];
  const record = (c: Contract) => `${text(c.name) || '合同/协议'}｜${company(c) || '签订公司未填写'}｜${day(c.effectiveFrom)}至${day(c.expiresAt) || '无固定期限'}${c.contractType === 'transfer' ? `｜转签：${text(c.originalCompany) || '原公司未填写'}→${text(c.newCompany) || '转入公司未填写'}` : ''}`;
  const records = `记录一：${record(a)}\n记录二：${record(b)}`;
  let title = '合同期限交叠待核对';
  let reason = '两份记录的生效期间交叠，现有资料尚不能说明是替代、续签还是同时保留。';
  let suggestion = '核对原件及两份记录的关系；若日期填错请更正，若确实需要保留可说明原因并标记正常。不自动修改日期。';
  const previous = agreement(a), next = agreement(b);
  const transition = previous.includes('兼职') ? '兼职' : previous.includes('实习') ? '实习' : '';
  const overlapStart = day(b.effectiveFrom)!;
  const overlapEnd = [day(a.expiresAt), day(b.expiresAt)].filter((v): v is string => !!v).sort()[0];
  const days = overlapEnd ? Math.round((Date.parse(overlapEnd) - Date.parse(overlapStart)) / 86400000) + 1 : null;
  if (transition && next.includes('劳动') && !/兼职|实习/.test(next)) {
    title = `${transition}转劳动合同待核对`;
    reason = `原${transition}协议尚在记录期限内，新劳动合同已经开始，可能是用工身份转换后替代了旧协议。`;
    suggestion = '核对新劳动合同是否替代原协议；确认属于正常转换可保留原约定日期并标记正常。只有查明实际提前结束日期后才补录，不猜填日期。';
  } else if (previous.includes('返聘') || next.includes('返聘')) {
    title = '退休返聘协议衔接待核对';
    reason = '退休返聘协议与另一份劳动合同或返聘协议交叠，可能是身份转换，也可能存在历史合同类型或日期填写问题。';
    suggestion = '核对退休返聘开始时间、原劳动合同的结束情况，以及是否重复录入返聘协议；确认衔接正常可保留记录并标记正常。';
  } else if (days && days <= 2) {
    title = '前后合同日期衔接待核对';
    reason = `两份合同交叠${days}天（${overlapStart}至${overlapEnd}），可能是续签时对起止日的填写口径不同。`;
    suggestion = '对照原件核对起止日；若原件如此且属于正常衔接，可保留并标记正常。不自动修改任何一天。';
  } else if (a.contractType === 'transfer' && b.contractType === 'transfer'
      && text(a.originalCompany) && a.originalCompany === b.originalCompany && text(a.newCompany) && a.newCompany === b.newCompany) {
    title = '相同主体重复转签待核对';
    reason = '两条记录的转出、转入公司相同，但生效期间交叠，需要区分再次签订、原记录更正或重复录入。';
    suggestion = '核对是否确有两份不同的转签文件；只有确认重复或录入错误才删除错误记录，真实历史继续保留。';
  } else if (b.contractType === 'transfer') {
    if (!company(a) || !text(b.originalCompany) || !text(b.newCompany)) {
      title = '转签主体待补充';
      const missing = [!company(a) ? '旧合同的签订公司' : '', !text(b.originalCompany) ? '转出公司' : '', !text(b.newCompany) ? '转入公司' : ''].filter(Boolean);
      reason = `缺少${missing.join('、')}，暂时无法完整核对公司转签关系。`;
      suggestion = '按合同或转签文件补充缺少的主体，不用员工当前所属公司代替历史签约公司；确认现状需保留时可说明原因并标记正常。';
    } else if (company(a) !== text(b.originalCompany)) {
      title = '转签主体关系待核对';
      reason = `旧合同公司为“${company(a)}”，后续转签的转出公司却为“${text(b.originalCompany)}”，可能缺少中间转签记录或主体填错。`;
      suggestion = '核对是否还有中间转签；补齐实际关系，或更正填错的主体。不要直接覆盖历史公司。';
    } else {
      title = '公司转签记录交叠';
      reason = '转出公司能对应旧合同公司，可能是正常公司主体转签；原约定期限仍然交叠，不等于录入错误。';
      suggestion = '核对转签文件与原、新主体及期限；确认正常可保留全部日期并标记正常。本项有多组记录时需全部核对后再勾选。';
    }
  } else if (company(a) && company(b) && company(a) !== company(b)) {
    title = '公司变更关系待核对';
    reason = '两份合同的签订公司不同，生效期间交叠，但未明确记录为公司转签。';
    suggestion = '核对是否属于公司转签、同时签订不同协议或录入错误；按实际情况完善记录，不仅凭日期交叠判错。';
  }
  if (!company(a) || !company(b)) reason += ' 部分签订公司未填写，请同时核对历史签约主体。';
  if ([a, b].some(c => text(c.name).includes('劳动') && /兼职|实习/.test(text(c.termType)))) {
    reason += ' 另有记录名称写“劳动合同”，期限类型却写兼职或实习协议，请核对名称和类型。';
  }
  return { title, records, reason, suggestion };
}
