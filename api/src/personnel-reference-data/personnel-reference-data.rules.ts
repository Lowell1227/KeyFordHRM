import { PersonnelReferenceDataKind } from './personnel-reference-data.dto';

// Match the narrowest writable personnel field, not just the directory table.
export const PERSONNEL_REFERENCE_RULES: Record<PersonnelReferenceDataKind, { label: string; maxLength: number }> = {
  work_location: { label: '工作地点', maxLength: 100 },
  job_family: { label: '职系', maxLength: 100 },
  job_grade: { label: '职级', maxLength: 30 },
  education: { label: '学历', maxLength: 50 },
  marital_status: { label: '婚姻状况', maxLength: 30 },
  political_status: { label: '政治面貌', maxLength: 50 },
  household_type: { label: '户籍类型', maxLength: 50 },
  contact_relation: { label: '与联系人关系', maxLength: 50 },
  bank_name: { label: '开户银行', maxLength: 100 },
  contract_name: { label: '合同名称', maxLength: 100 },
};
