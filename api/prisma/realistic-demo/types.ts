import type { Prisma } from "@prisma/client";

export type DemoEntityKind =
  | "department"
  | "user"
  | "indicator"
  | "template"
  | "dimension"
  | "template-indicator"
  | "cycle"
  | "snapshot"
  | "task"
  | "indicator-instance"
  | "self-eval"
  | "manager-eval"
  | "grade"
  | "flow"
  | "archive"
  | "objective"
  | "action-item"
  | "interview"
  | "appeal"
  | "improvement-plan"
  | "probation-review"
  | "probation-indicator"
  | "confirmation"
  | "signature"
  | "notification"
  | "audit-log";

export interface DemoManifest {
  source: "realistic-demo-v1";
  asOf: Date;
  ownedIds: Record<DemoEntityKind, string[]>;
  acceptanceEmployeeNos: Record<string, string>;
  storyUserIds: Record<string, string>;
  expectedCounts: Record<string, number>;
}

export interface DemoRowSets {
  departments: Prisma.DepartmentCreateManyInput[];
  users: Prisma.UserCreateManyInput[];
  indicators: Prisma.IndicatorCreateManyInput[];
  templates: Prisma.AssessmentTemplateCreateManyInput[];
  dimensions: Prisma.TemplateDimensionCreateManyInput[];
  templateIndicators: Prisma.TemplateIndicatorCreateManyInput[];
  cycles: Prisma.AssessmentCycleCreateManyInput[];
  snapshots: Prisma.AssessmentTemplateSnapshotCreateManyInput[];
  tasks: Prisma.AssessmentTaskCreateManyInput[];
  indicatorInstances: Prisma.IndicatorInstanceCreateManyInput[];
  selfEvaluations: Prisma.SelfEvalSummaryCreateManyInput[];
  managerEvaluations: Prisma.ManagerEvalSummaryCreateManyInput[];
  gradeResults: Prisma.GradeResultCreateManyInput[];
  flowRecords: Prisma.FlowRecordCreateManyInput[];
  archives: Prisma.PerformanceArchiveCreateManyInput[];
  objectives: Prisma.ObjectiveCreateManyInput[];
  actionItems: Prisma.ActionItemCreateManyInput[];
  interviews: Prisma.PerformanceInterviewCreateManyInput[];
  appeals: Prisma.AppealCreateManyInput[];
  improvementPlans: Prisma.ImprovementPlanCreateManyInput[];
  probationReviews: Prisma.ProbationReviewCreateManyInput[];
  probationIndicators: Prisma.ProbationReviewIndicatorCreateManyInput[];
  confirmations: Prisma.ConfirmationApplicationCreateManyInput[];
  signatures: Prisma.SignatureCreateManyInput[];
  notifications: Prisma.NotificationLogCreateManyInput[];
  auditLogs: Prisma.AuditLogCreateManyInput[];
}

export interface PeopleBundle {
  departments: Prisma.DepartmentCreateManyInput[];
  users: Prisma.UserCreateManyInput[];
  baseDepartmentAssertions: Array<{ id: string; expectedName: string }>;
  departmentLeadership: RealisticDemoDataset["departmentLeadership"];
  managerIds: string[];
  managerByUserId: Map<string, string>;
  deptHeadByDepartmentId: Map<string, string>;
  approverByDepartmentId: Map<string, string>;
  storyUserIds: Record<string, string>;
  acceptanceEmployeeNos: Record<string, string>;
}

export type JobFamily =
  | "projectProduct"
  | "supplyChain"
  | "salesRetail"
  | "ecommerce"
  | "creative"
  | "customerSupport"
  | "functions";

export interface GeneratedTemplate {
  template: Prisma.AssessmentTemplateCreateManyInput;
  dimensions: Prisma.TemplateDimensionCreateManyInput[];
  indicators: Prisma.TemplateIndicatorCreateManyInput[];
}

export interface CatalogBundle {
  indicators: Prisma.IndicatorCreateManyInput[];
  templates: Prisma.AssessmentTemplateCreateManyInput[];
  dimensions: Prisma.TemplateDimensionCreateManyInput[];
  templateIndicators: Prisma.TemplateIndicatorCreateManyInput[];
  templateIdByJobFamily: Map<JobFamily, string>;
  managerTemplateIdByJobFamily: Map<JobFamily, string>;
  templateForFamily(family: JobFamily): GeneratedTemplate;
  managerTemplateForFamily(family: JobFamily): GeneratedTemplate;
}

export interface PerformanceBundle {
  cycles: Prisma.AssessmentCycleCreateManyInput[];
  snapshots: Prisma.AssessmentTemplateSnapshotCreateManyInput[];
  tasks: Prisma.AssessmentTaskCreateManyInput[];
  indicatorInstances: Prisma.IndicatorInstanceCreateManyInput[];
  selfEvaluations: Prisma.SelfEvalSummaryCreateManyInput[];
  managerEvaluations: Prisma.ManagerEvalSummaryCreateManyInput[];
  gradeResults: Prisma.GradeResultCreateManyInput[];
  flowRecords: Prisma.FlowRecordCreateManyInput[];
  archives: Prisma.PerformanceArchiveCreateManyInput[];
  objectives: Prisma.ObjectiveCreateManyInput[];
  actionItems: Prisma.ActionItemCreateManyInput[];
  storyUserIds: Record<string, string>;
  employeeNoByUserId: Map<string, string>;
}

export interface WorkflowBundle {
  interviews: Prisma.PerformanceInterviewCreateManyInput[];
  q1Interviews: Prisma.PerformanceInterviewCreateManyInput[];
  q2Interviews: Prisma.PerformanceInterviewCreateManyInput[];
  appeals: Prisma.AppealCreateManyInput[];
  q1Appeals: Prisma.AppealCreateManyInput[];
  q2Appeals: Prisma.AppealCreateManyInput[];
  improvementPlans: Prisma.ImprovementPlanCreateManyInput[];
  q1ImprovementPlans: Prisma.ImprovementPlanCreateManyInput[];
  q2ImprovementPlans: Prisma.ImprovementPlanCreateManyInput[];
  probationReviews: Prisma.ProbationReviewCreateManyInput[];
  probationIndicators: Prisma.ProbationReviewIndicatorCreateManyInput[];
  confirmations: Prisma.ConfirmationApplicationCreateManyInput[];
  signatures: Prisma.SignatureCreateManyInput[];
  notifications: Prisma.NotificationLogCreateManyInput[];
  auditLogs: Prisma.AuditLogCreateManyInput[];
}

export interface RealisticDemoDataset {
  rows: DemoRowSets;
  departmentLeadership: Array<{
    id: string;
    leaderId: string | null;
    approverId: string | null;
  }>;
  manifest: DemoManifest;
}

export interface RealisticDemoSummary {
  source: DemoManifest["source"];
  asOf: string;
  currentPeople: number;
  resignedPeople: number;
  systemAdmins: number;
  departments: number;
  indicators: number;
  templates: number;
  cycles: number;
  q1Tasks: number;
  q1Exempt: number;
  q1Graded: number;
  q2Tasks: number;
  q2Exempt: number;
  q2Graded: number;
  q3Tasks: number;
  annualLeaderTasks: number;
  archives: number;
  appeals: number;
  improvementPlans: number;
  probationReviews: number;
  notifications: number;
}
