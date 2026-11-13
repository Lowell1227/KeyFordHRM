import { BadRequestException } from '@nestjs/common';
import { isISO8601 } from 'class-validator';
import { ERROR_CODE } from '@/common/constants/error-codes';

type Contract = Record<string, unknown>;
const dateFields = ['signedAt', 'effectiveFrom', 'expiresAt'] as const;
const knownTypes = new Set(['contract', 'renewal', 'transfer', 'attachment', 'confidentiality']);
const text = (value: unknown): unknown => typeof value === 'string' ? value.trim() || null : value ?? null;
const type = (contract: Contract) => text(contract.kind ?? contract.contractType) ?? 'contract';

function calendarDate(value: unknown): string | null | undefined {
  if (text(value) === null) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : undefined;
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)
    || !isISO8601(value, { strict: true, strictSeparator: true })) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : undefined;
}

function materials(value: unknown) {
  return (Array.isArray(value) ? value : []).map(item => JSON.stringify(item && typeof item === 'object'
    ? { name: item.name, url: item.url, size: item.size, mimeType: item.mimeType } : item)).sort();
}

// Compare stored business content, excluding identity, order and import/audit metadata.
function content(contract: Contract, previous?: Contract, applyDateDefault = true) {
  const effectiveFrom = !applyDateDefault || (previous && contract.effectiveFrom !== undefined)
    ? contract.effectiveFrom : contract.effectiveFrom ?? contract.signedAt;
  const dateValue = (value: unknown) => {
    const day = calendarDate(value);
    return day === undefined ? value : day;
  };
  const inheritedSubject = previous?.contractSubjectId
    && (contract.contractSubjectId === undefined || contract.contractSubjectId === previous.contractSubjectId);
  return JSON.stringify({
    contractType: type(contract), name: text(contract.name),
    signingCompany: text(inheritedSubject ? previous.signingCompany : contract.signingCompany),
    contractSubjectId: text(contract.contractSubjectId === undefined ? previous?.contractSubjectId : contract.contractSubjectId),
    signedAt: dateValue(contract.signedAt), effectiveFrom: dateValue(effectiveFrom), expiresAt: dateValue(contract.expiresAt),
    termType: text(contract.termText ?? contract.termType),
    originalCompany: text(contract.originalCompany), newCompany: text(contract.newCompany),
    confidentialityAgreement: text(contract.confidentialityAgreement), nonCompeteAgreement: text(contract.nonCompeteAgreement),
    portraitAgreement: text(contract.portraitAgreement), images: materials(contract.images), attachments: materials(contract.attachments),
  });
}

export function assertValidContractChanges(contracts: unknown[], current: Contract[] = []): void {
  const fieldErrors: Record<string, string> = {};
  const rows = contracts.flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fieldErrors[`contracts.${index}`] = '合同记录格式不正确';
      return [];
    }
    return [{ contract: value as Contract, index }];
  });
  const lastIdIndex = new Map(rows.map(({ contract, index }) => [text(contract.id), index]));
  const proposals = rows.filter(({ contract, index }) => !text(contract.id) || lastIdIndex.get(text(contract.id)) === index)
    .map(({ contract, index }) => {
      const previous = current.find(item => text(contract.id) && item.id === text(contract.id));
      const fingerprint = content(contract, previous);
      const unchanged = Boolean(previous && fingerprint === content(previous, previous));
      if (!unchanged) {
        const path = (field: string) => `contracts.${index}.${field}`;
        if (!knownTypes.has(type(contract) as string) && (!previous || type(contract) !== type(previous))) {
          fieldErrors[path('contractType')] = '合同类型无效，请选择首签、续签或转签';
        }
        for (const field of dateFields) {
          if (calendarDate(contract[field]) === undefined) fieldErrors[path(field)] = '请填写有效日期';
        }
        const effectiveFrom = calendarDate(previous && contract.effectiveFrom !== undefined
          ? contract.effectiveFrom : contract.effectiveFrom ?? contract.signedAt);
        const expiresAt = calendarDate(contract.expiresAt);
        if (effectiveFrom && expiresAt && expiresAt < effectiveFrom) {
          fieldErrors[path('expiresAt')] = '到期日期不能早于生效日期';
        }
      }
      return { index, fingerprints: [...new Set([fingerprint, content(contract, previous, false)])], unchanged };
    });
  const seen = new Map<string, typeof proposals[number]>();
  for (const proposal of proposals) {
    for (const fingerprint of proposal.fingerprints) {
      const other = seen.get(fingerprint);
      // Existing duplicates keep their IDs; date defaults must not conceal a copied incomplete row.
      if (other && (!proposal.unchanged || !other.unchanged)) {
        const invalid = proposal.unchanged ? other : proposal;
        fieldErrors[`contracts.${invalid.index}.name`] = '合同内容重复，请核对已有合同，不要重复新增';
      }
      seen.set(fingerprint, proposal);
    }
  }
  if (Object.keys(fieldErrors).length) {
    throw new BadRequestException({ code: ERROR_CODE.PARAM_INVALID, message: Object.values(fieldErrors)[0], data: { fieldErrors } });
  }
}
