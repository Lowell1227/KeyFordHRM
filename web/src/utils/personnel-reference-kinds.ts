export const personnelReferenceKinds = {
  work_location: { label: '工作地点', tab: 'work-locations', maxLength: 100, allowCustom: false },
  job_family: { label: '职系', tab: 'job-families', maxLength: 100, allowCustom: false },
  job_grade: { label: '职级', tab: 'job-grades', maxLength: 30, allowCustom: false },
  education: { label: '学历', tab: 'education', maxLength: 50, allowCustom: false },
  marital_status: { label: '婚姻状况', tab: 'marital-status', maxLength: 30, allowCustom: false },
  political_status: { label: '政治面貌', tab: 'political-status', maxLength: 50, allowCustom: false },
  household_type: { label: '户籍类型', tab: 'household-types', maxLength: 50, allowCustom: false },
  contact_relation: { label: '与联系人关系', tab: 'contact-relations', maxLength: 50, allowCustom: false },
  bank_name: { label: '开户银行', tab: 'banks', maxLength: 100, allowCustom: true },
  contract_name: { label: '合同名称', tab: 'contract-names', maxLength: 100, allowCustom: true },
} as const;

export type PersonnelReferenceKind = keyof typeof personnelReferenceKinds;
export const archiveReferenceKinds = (Object.keys(personnelReferenceKinds) as PersonnelReferenceKind[])
  .filter(kind => kind !== 'work_location' && kind !== 'job_family');
