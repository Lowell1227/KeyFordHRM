# 员工再入职与招聘入职接收 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不创建重复员工的前提下，为已离职或已归档员工提供可审核、可取消、按日期生效的再入职流程，并提供未来招聘模块只能创建入职草稿的幂等接收接口。

**Architecture:** 继续复用 `User` 作为人员长期主档、`EmploymentRecord` 作为任职历史、`EmployeeDataChangeRequest` 作为审核申请。新增工号占用历史和待入职状态，由独立的 `EmployeeOnboardingService` 处理草稿、提交、修订、取消与招聘接收，现有审核服务负责二次确认，`EmployeeEffectiveDateService` 负责幂等生效；登录只在生效日后通过当前有效任职校验，并只恢复因离职停用且没有身份冲突的钉钉绑定。

**Tech Stack:** NestJS、Prisma、PostgreSQL、Jest、Vue 3、TypeScript、Element Plus、vue-tsc、Playwright、Docker Compose。

**Spec:** `docs/superpowers/specs/2026-09-18-employee-reentry-onboarding-design.md`

## Global Constraints

- HRM 员工档案和任职记录是组织、人员、部门、岗位、直属主管及任职状态的权威来源；钉钉只负责登录、身份绑定、通知和工作台入口。
- 同一自然员工始终复用原 `User.id`；再入职新增任职历史，不新增第二名员工，也不覆盖历史离职、合同、绩效或审批记录。
- 用户可见术语使用“再入职”；现有 `EmploymentType.rehire` 继续表示用工类型“返聘”，不得根据再入职经历自动设置。
- 审核通过与正式生效分离：未来生效申请进入 `pending_entry`，生效日前不得登录，也不得进入在职业务范围。
- 再入职只恢复 `SysRole.employee`、空 `hrCapabilities`、`canViewAll=false`、`isAssessorOnly=false`；管理权限必须通过既有权限维护入口另行授予。
- 合同缺失、试用期日期不完整、主管缺失、历史日期和钉钉未关联只在字段旁提醒；人员唯一性、工号冲突、并发有效任职和无效引用才阻断。
- 历史正式工号永不释放给其他员工；只有被取消且从未生效的预留工号可释放。
- 招聘来源只能创建入职草稿，不能创建正式员工、任职、组织数据或登录资格；不得按姓名、手机号、邮箱或钉钉组织自动合并员工。
- 提交、审核、生效和取消必须幂等并保留审计；接口和日志不得暴露完整手机号、证件号、合同地址或钉钉身份明文。
- 本计划实施期间不改变已启动绩效周期冻结的组织和绩效直属上级快照。
- 生产环境只有在用户再次明确授权“发布/上线”后才允许部署；实施任务的提交和推送不等于生产已上线。

## File Map

### API and data

- Modify `api/prisma/schema.prisma`: 增加待入职状态、入职申请元数据、任职工号快照和工号占用历史。
- Create `api/prisma/migrations/20260918120000_employee_reentry_onboarding/migration.sql`: 数据库枚举、列、表、约束、索引和历史工号回填。
- Modify `api/test/fixtures/fixture-factory.ts`: 按外键顺序清理工号占用历史，避免 E2E 测试残留。
- Create `api/src/employee-archives/dto/employee-onboarding.dto.ts`: 再入职、修订、取消和招聘入职接收 DTO。
- Create `api/src/employee-archives/employee-onboarding.service.ts`: 申请草稿、提交、修订、取消、幂等接收和匹配建议。
- Create `api/src/employee-archives/employee-onboarding.service.spec.ts`: 领域服务单元测试。
- Create `api/src/common/personnel/current-worker.ts`: 当前在岗人员状态的唯一共享查询边界。
- Modify `api/src/employee-archives/employee-archives.controller.ts`: 暴露再入职和入职接收 API。
- Modify `api/src/employee-archives/employee-archives.module.ts`: 注册并导出入职服务。
- Modify `api/src/employee-archives/employee-data-reviews.service.ts`: 审核通过/退回再入职申请并调用统一生效逻辑。
- Modify `api/src/employee-archives/employee-data-reviews.service.spec.ts`: 审核、自审、并发和权限重置测试。
- Modify `api/src/employee-archives/employee-effective-date.service.ts`: 幂等生效、工号切换、当前投影和钉钉恢复。
- Modify `api/src/employee-archives/employee-effective-date.service.spec.ts`: 当日、未来、历史、取消和重复生效测试。
- Modify `api/src/auth/auth.module.ts`: 注入员工生效补偿服务。
- Modify `api/src/auth/auth.service.ts`: 本地和钉钉登录前执行指定员工的轻量生效补偿。
- Modify `api/src/auth/auth.service.spec.ts`: 生效日前拒绝、生效日补偿、钉钉冲突测试。
- Modify `api/src/users/dto/user-query.dto.ts`: 增加只返回当前在岗员工的 `direct_manager` 候选类型。
- Modify `api/src/users/users.service.ts`, `api/src/positions/positions.service.ts`, `api/src/departments/departments.service.ts`, `api/src/auth/business-capabilities.service.ts`, `api/src/cycles/cycles.service.ts`, `api/src/cycles/launch.service.ts`: 将待入职排除出当前业务范围。
- Modify对应的 `*.spec.ts`: 固定 `active/probation` 与 `pending_entry` 的范围边界。

### Web

- Modify `web/src/types/enums.ts`: 增加 `pending_entry`。
- Modify `web/src/types/api.types.ts`: 增加 `direct_manager` 候选查询类型。
- Modify `web/src/components/common/UserSelect.vue`: 支持复用当前在岗直属上级候选查询。
- Modify `web/src/api/employee-archives.api.ts`: 增加入职申请类型和 API client。
- Create `web/src/views/admin/components/EmployeeReentryDrawer.vue`: 再入职发起、查看、修订、取消和流程展示。
- Create `web/e2e/specs/58-employee-reentry-drawer.spec.ts`: 通过受控接口响应验证抽屉字段、提醒、流程和操作。
- Modify `web/src/views/admin/UserManageView.vue`: 增加“待入职”标签及再入职操作，保持单一员工列表。
- Modify `web/src/views/admin/components/PersonnelPendingReviews.vue`: 以统一表格显示“再入职”审核和变更内容。
- Modify `web/e2e/specs/54-personnel-resignation-archive.spec.ts`: 扩展再入职列表和抽屉验收。
- Modify `web/e2e/specs/23-employee-data-review.spec.ts`: 扩展再入职审核、自审和待入职验收。

### Acceptance evidence

- Create `docs/acceptance/2026-09-18-employee-reentry-onboarding.md`: 记录测试命令、角色路径、迁移与生产发布前检查结果。

---

### Task 1: Extend the lifecycle and employee-number data model

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/20260918120000_employee_reentry_onboarding/migration.sql`
- Modify: `api/test/fixtures/fixture-factory.ts`
- Test: `api/src/employee-archives/employee-onboarding-schema.spec.ts`

**Interfaces:**
- Consumes: 既有 `User`, `EmploymentRecord`, `EmployeeDataChangeRequest`, `ExternalIdentityBinding`。
- Produces: `UserStatus.pending_entry`, `OnboardingIntakeType`, `OnboardingStatus`, `EmployeeNumberStatus`, `EmployeeNumberAssignment`, `EmploymentRecord.employeeNo`, `EmploymentRecord.sourceRequestId`，以及入职申请来源、版本和取消字段。

- [ ] **Step 1: Write a failing schema contract test**

Create `api/src/employee-archives/employee-onboarding-schema.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('employee onboarding schema contract', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it('defines pending-entry, onboarding and employee-number lifecycle fields', () => {
    expect(schema).toContain('pending_entry');
    expect(schema).toContain('enum OnboardingIntakeType');
    expect(schema).toContain('enum OnboardingStatus');
    expect(schema).toContain('enum EmployeeNumberStatus');
    expect(schema).toContain('model EmployeeNumberAssignment');
    expect(schema).toContain('employeeNo       String?');
    expect(schema).toContain('sourceReference');
    expect(schema).toContain('requestVersion');
    expect(schema).toContain('revisionHistory');
    expect(schema).toContain('cancelledAt');
  });
});
```

- [ ] **Step 2: Run the contract test and verify the missing-model failure**

Run from `api`:

```powershell
npm test -- --runInBand src/employee-archives/employee-onboarding-schema.spec.ts
```

Expected: FAIL because `pending_entry` and `EmployeeNumberAssignment` are not yet present.

- [ ] **Step 3: Add the Prisma enums and model fields**

Add these enums to `api/prisma/schema.prisma`:

```prisma
enum UserStatus {
  active
  probation
  pending_entry
  resigned

  @@map("user_status")
}

enum OnboardingIntakeType {
  new_hire
  reentry

  @@map("onboarding_intake_type")
}

enum OnboardingStatus {
  draft
  submitted
  pending_entry
  effective
  cancelled

  @@map("onboarding_status")
}

enum EmployeeNumberStatus {
  reserved
  current
  historical
  released

  @@map("employee_number_status")
}
```

Extend `EmploymentRecord`:

```prisma
  employeeNo      String?                    @map("employee_no") @db.VarChar(30)
  sourceRequestId String?                    @unique @map("source_request_id") @db.Uuid
  sourceRequest   EmployeeDataChangeRequest? @relation("EmploymentSourceRequest", fields: [sourceRequestId], references: [id], onDelete: SetNull)
```

Extend `EmployeeDataChangeRequest`:

```prisma
  sourceSystem      String?               @map("source_system") @db.VarChar(40)
  sourceReference   String?               @map("source_reference") @db.VarChar(100)
  intakeType        OnboardingIntakeType? @map("intake_type")
  onboardingStatus  OnboardingStatus?     @map("onboarding_status")
  requestVersion    Int                   @default(1) @map("request_version")
  revisionHistory   Json                  @default("[]") @map("revision_history") @db.JsonB
  cancelledAt       DateTime?             @map("cancelled_at") @db.Timestamptz(6)
  cancelledById     String?               @map("cancelled_by_id") @db.Uuid
  cancelledReason   String?               @map("cancelled_reason") @db.Text
  cancelledBy       User?                 @relation("EmployeeChangeCancelledBy", fields: [cancelledById], references: [id], onDelete: SetNull)
  employmentRecords EmploymentRecord[]    @relation("EmploymentSourceRequest")
  employeeNumbers   EmployeeNumberAssignment[]

  @@unique([sourceSystem, sourceReference], map: "employee_change_source_key")
  @@index([intakeType, onboardingStatus, createdAt(sort: Desc)])
```

Add to `User`:

```prisma
  employeeNumberAssignments EmployeeNumberAssignment[]
  cancelledEmployeeChanges  EmployeeDataChangeRequest[] @relation("EmployeeChangeCancelledBy")
```

Add the model:

```prisma
model EmployeeNumberAssignment {
  id              String               @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId          String               @map("user_id") @db.Uuid
  employeeNo      String               @map("employee_no") @db.VarChar(30)
  status          EmployeeNumberStatus
  effectiveFrom   DateTime?            @map("effective_from") @db.Date
  effectiveTo     DateTime?            @map("effective_to") @db.Date
  sourceRequestId String?              @map("source_request_id") @db.Uuid
  releasedAt      DateTime?            @map("released_at") @db.Timestamptz(6)
  createdAt       DateTime             @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime             @default(now()) @map("updated_at") @db.Timestamptz(6)

  user          User                       @relation(fields: [userId], references: [id], onDelete: Restrict)
  sourceRequest EmployeeDataChangeRequest? @relation(fields: [sourceRequestId], references: [id], onDelete: SetNull)

  @@unique([userId, employeeNo])
  @@index([employeeNo, status])
  @@index([userId, status])
  @@index([sourceRequestId])
  @@map("employee_number_assignments")
}
```

- [ ] **Step 4: Write the SQL migration with safe backfill and partial uniqueness**

Create `api/prisma/migrations/20260918120000_employee_reentry_onboarding/migration.sql` with these operations in this order:

```sql
ALTER TYPE "user_status" ADD VALUE IF NOT EXISTS 'pending_entry';
CREATE TYPE "onboarding_intake_type" AS ENUM ('new_hire', 'reentry');
CREATE TYPE "onboarding_status" AS ENUM ('draft', 'submitted', 'pending_entry', 'effective', 'cancelled');
CREATE TYPE "employee_number_status" AS ENUM ('reserved', 'current', 'historical', 'released');

ALTER TABLE "employment_records"
  ADD COLUMN "employee_no" VARCHAR(30),
  ADD COLUMN "source_request_id" UUID;

ALTER TABLE "employee_data_change_requests"
  ADD COLUMN "source_system" VARCHAR(40),
  ADD COLUMN "source_reference" VARCHAR(100),
  ADD COLUMN "intake_type" "onboarding_intake_type",
  ADD COLUMN "onboarding_status" "onboarding_status",
  ADD COLUMN "request_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revision_history" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(6),
  ADD COLUMN "cancelled_by_id" UUID,
  ADD COLUMN "cancelled_reason" TEXT;

CREATE TABLE "employee_number_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "employee_no" VARCHAR(30) NOT NULL,
  "status" "employee_number_status" NOT NULL,
  "effective_from" DATE,
  "effective_to" DATE,
  "source_request_id" UUID,
  "released_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_number_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_number_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_number_assignments_source_request_id_fkey" FOREIGN KEY ("source_request_id") REFERENCES "employee_data_change_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "employee_number_assignments_user_id_employee_no_key" UNIQUE ("user_id", "employee_no")
);

CREATE UNIQUE INDEX "employee_change_source_key"
  ON "employee_data_change_requests"("source_system", "source_reference");

CREATE UNIQUE INDEX "employee_number_assignments_occupied_no_key"
  ON "employee_number_assignments"("employee_no")
  WHERE "status" IN ('reserved', 'current', 'historical');

CREATE UNIQUE INDEX "employee_change_one_open_onboarding_per_user"
  ON "employee_data_change_requests"("user_id")
  WHERE "user_id" IS NOT NULL
    AND "intake_type" IN ('new_hire', 'reentry')
    AND "onboarding_status" IN ('draft', 'submitted', 'pending_entry');

CREATE UNIQUE INDEX "employment_records_source_request_id_key"
  ON "employment_records"("source_request_id")
  WHERE "source_request_id" IS NOT NULL;

CREATE INDEX "employee_number_assignments_employee_no_status_idx" ON "employee_number_assignments"("employee_no", "status");
CREATE INDEX "employee_number_assignments_user_id_status_idx" ON "employee_number_assignments"("user_id", "status");
CREATE INDEX "employee_number_assignments_source_request_id_idx" ON "employee_number_assignments"("source_request_id");
CREATE INDEX "employee_change_intake_status_created_idx" ON "employee_data_change_requests"("intake_type", "onboarding_status", "created_at" DESC);

ALTER TABLE "employment_records"
  ADD CONSTRAINT "employment_records_source_request_id_fkey"
  FOREIGN KEY ("source_request_id") REFERENCES "employee_data_change_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_data_change_requests"
  ADD CONSTRAINT "employee_data_change_requests_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

WITH ranked_employment AS (
  SELECT
    er."id",
    er."user_id",
    ROW_NUMBER() OVER (
      PARTITION BY er."user_id"
      ORDER BY er."effective_from" DESC, er."created_at" DESC
    ) AS rn
  FROM "employment_records" er
)
UPDATE "employment_records" er
SET "employee_no" = u."employee_no"
FROM ranked_employment ranked
JOIN "users" u ON u."id" = ranked."user_id"
WHERE er."id" = ranked."id"
  AND ranked.rn = 1
  AND er."employee_no" IS NULL
  AND u."employee_no" IS NOT NULL;

INSERT INTO "employee_number_assignments" ("user_id", "employee_no", "status", "effective_from", "effective_to")
SELECT
  u."id",
  u."employee_no",
  CASE WHEN u."status" IN ('active', 'probation') AND EXISTS (
    SELECT 1
    FROM "employment_records" current_er
    WHERE current_er."user_id" = u."id"
      AND current_er."effective_from" <= CURRENT_DATE
      AND (current_er."effective_to" IS NULL OR current_er."effective_to" >= CURRENT_DATE)
      AND current_er."employee_status" <> 'resigned'
  ) THEN 'current'::"employee_number_status"
  ELSE 'historical'::"employee_number_status" END,
  latest."effective_from",
  latest."effective_to"
FROM "users" u
LEFT JOIN LATERAL (
  SELECT er."effective_from", er."effective_to"
  FROM "employment_records" er
  WHERE er."user_id" = u."id"
  ORDER BY er."effective_from" DESC, er."created_at" DESC
  LIMIT 1
) latest ON TRUE
WHERE u."employee_no" IS NOT NULL
ON CONFLICT ("user_id", "employee_no") DO NOTHING;
```

The legacy schema has only `User.employeeNo`, so the migration must not copy the current number into every old employment and invent false history. It snapshots the known current/last number onto only the latest record; older unknown numbers remain `NULL`. Before production, run this read-only query against the migrated database copy; if rows are returned, stop and report the exact employee numbers and user IDs rather than deleting or reassigning data:

```sql
SELECT "employee_no", COUNT(DISTINCT "user_id")
FROM "employee_number_assignments"
WHERE "status" IN ('reserved', 'current', 'historical')
GROUP BY "employee_no"
HAVING COUNT(DISTINCT "user_id") > 1;
```

- [ ] **Step 5: Generate Prisma and run schema/migration validation**

Run from `api`:

```powershell
npx prisma format
npx prisma validate
npx prisma generate
npm test -- --runInBand src/employee-archives/employee-onboarding-schema.spec.ts
npm run build
```

Expected: schema validation, contract test, and API build all PASS. The migration must not be applied to production in this task.

- [ ] **Step 6: Update E2E fixture cleanup for the new foreign key**

In `api/test/fixtures/fixture-factory.ts`, add `'employee_number_assignments'` to the raw `tables` array in `resetDataTables()` immediately before `'employment_records'`. Keep the existing `TRUNCATE ... CASCADE` loop and unrelated table order unchanged. This prevents a previous test's employee-number ownership record from blocking the next test run.

Run the fixture-backed smoke test from `api`:

```powershell
npm run test:e2e -- --runTestsByPath suites/01-auth-rbac.e2e-spec.ts
```

Expected: the suite can reset and seed the database without a foreign-key error.

- [ ] **Step 7: Commit the data-model change**

```powershell
git add api/prisma/schema.prisma api/prisma/migrations/20260918120000_employee_reentry_onboarding/migration.sql api/test/fixtures/fixture-factory.ts api/src/employee-archives/employee-onboarding-schema.spec.ts
git diff --cached --check
git commit -m "feat(personnel): add reentry lifecycle schema"
```

---

### Task 2: Add reentry DTOs and the onboarding application service

**Files:**
- Create: `api/src/employee-archives/dto/employee-onboarding.dto.ts`
- Create: `api/src/employee-archives/employee-onboarding.service.ts`
- Create: `api/src/employee-archives/employee-onboarding.service.spec.ts`
- Modify: `api/src/employee-archives/employee-archives.module.ts`

**Interfaces:**
- Consumes: Task 1 enums/models and existing `PrismaService`.
- Produces:
  - `EmployeeOnboardingService.createReentry(userId: string, input: CreateEmployeeReentryDto, operatorId: string): Promise<OnboardingRequestView>`
  - `EmployeeOnboardingService.reviseReentry(requestId: string, input: ReviseEmployeeReentryDto, operatorId: string): Promise<OnboardingRequestView>`
  - `EmployeeOnboardingService.cancelReentry(requestId: string, input: CancelEmployeeReentryDto, operatorId: string): Promise<OnboardingRequestView>`
  - `EmployeeOnboardingService.getCurrentReentry(userId: string): Promise<OnboardingRequestView | null>`
  - `EmployeeOnboardingService.createOnboardingIntake(input: CreateOnboardingIntakeDto, operatorId: string): Promise<OnboardingIntakeResult>`
  - `EmployeeOnboardingService.hashIntakePayload(input: CreateOnboardingIntakeDto): string`

- [ ] **Step 1: Define the input and output contracts**

Create `api/src/employee-archives/dto/employee-onboarding.dto.ts` with validated DTOs and exported plain result types:

```ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CompanyCode, EmploymentType, UserStatus } from '@prisma/client';

export class ContractReferenceDto {
  @IsString()
  @MaxLength(100)
  kind!: string;

  @IsString()
  @MaxLength(500)
  reference!: string;
}

export class EmployeeReentryFieldsDto {
  @IsString()
  @MaxLength(30)
  employeeNo!: string;

  @IsEnum(CompanyCode)
  company!: CompanyCode;

  @IsOptional()
  @IsUUID('4')
  deptId?: string | null;

  @IsOptional()
  @IsUUID('4')
  positionId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  position?: string | null;

  @IsOptional()
  @IsUUID('4')
  directManagerId?: string | null;

  @Type(() => Date)
  @IsDate()
  effectiveDate!: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveTo?: Date | null;

  @IsIn([UserStatus.active, UserStatus.probation])
  employeeStatus!: UserStatus;

  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  plannedRegularDate?: Date | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  probationMonths?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractReferenceDto)
  contractReferences?: ContractReferenceDto[];
}

export class CreateEmployeeReentryDto extends EmployeeReentryFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sourceSystem?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceReference?: string;
}

export class ReviseEmployeeReentryDto extends EmployeeReentryFieldsDto {}

export class CancelEmployeeReentryDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class IdentitySnapshotDto {
  @IsString()
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  email?: string;
}

export class CreateOnboardingIntakeDto extends EmployeeReentryFieldsDto {
  @IsString()
  @MaxLength(40)
  sourceSystem!: string;

  @IsString()
  @MaxLength(100)
  sourceReference!: string;

  @IsIn(['new_hire', 'reentry'])
  intakeType!: 'new_hire' | 'reentry';

  @IsOptional()
  @IsUUID('4')
  existingEmployeeId?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => IdentitySnapshotDto)
  identitySnapshot!: IdentitySnapshotDto;
}

export type OnboardingRequestView = {
  id: string;
  userId: string | null;
  employeeName: string;
  employeeNo: string | null;
  intakeType: 'new_hire' | 'reentry' | null;
  onboardingStatus: 'draft' | 'submitted' | 'pending_entry' | 'effective' | 'cancelled' | null;
  requestVersion: number;
  recordStatus: string;
  proposedValue: Record<string, unknown>;
  validationWarnings: Array<{ field: string; message: string }>;
  createdAt: Date;
  updatedAt: Date;
};

export type OnboardingIntakeResult = {
  intakeId: string;
  matchStatus: 'new' | 'matched_reentry' | 'needs_review' | 'conflict';
  matchedEmployeeId: string | null;
  recordStatus: string;
  nextAction: 'complete_new_hire_draft' | 'review_employee_match' | 'submit_hr_review';
};
```

- [ ] **Step 2: Write failing service tests for reuse, reservation, warnings, idempotency and cancellation**

Create `api/src/employee-archives/employee-onboarding.service.spec.ts`. Mock Prisma methods and include these named tests with concrete assertions:

```ts
it('creates a submitted reentry request for the existing user and reserves the number', async () => {
  prisma.user.findUnique.mockResolvedValue(resignedArchivedUser);
  prisma.employeeDataChangeRequest.findFirst.mockResolvedValue(null);
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  prisma.employeeNumberAssignment.upsert.mockResolvedValue(numberReservation);
  prisma.employeeDataChangeRequest.create.mockResolvedValue(submittedRequest);

  const result = await service.createReentry(
    resignedArchivedUser.id,
    validReentryInput,
    hrAdmin.id,
  );

  expect(result.userId).toBe(resignedArchivedUser.id);
  expect(result.onboardingStatus).toBe('submitted');
  expect(prisma.user.create).not.toHaveBeenCalled();
  expect(prisma.employeeNumberAssignment.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        userId_employeeNo: {
          userId: resignedArchivedUser.id,
          employeeNo: validReentryInput.employeeNo,
        },
      },
    }),
  );
});

it('returns the original intake for an identical source payload', async () => {
  prisma.employeeDataChangeRequest.findFirst.mockResolvedValue(existingSourceRequest);

  const result = await service.createOnboardingIntake(repeatedIntake, hrAdmin.id);

  expect(result.intakeId).toBe(existingSourceRequest.id);
  expect(prisma.employeeDataChangeRequest.create).not.toHaveBeenCalled();
});

it('throws a conflict when the same source reference has different content', async () => {
  prisma.employeeDataChangeRequest.findFirst.mockResolvedValue(existingSourceRequest);

  await expect(
    service.createOnboardingIntake(changedRepeatedIntake, hrAdmin.id),
  ).rejects.toThrow('来源编号已存在，但本次内容与原草稿不一致');
});

it('does not match an employee automatically from name or masked contact details', async () => {
  prisma.employeeDataChangeRequest.findFirst.mockResolvedValue(null);
  prisma.user.findMany.mockResolvedValue([resignedArchivedUser]);
  prisma.employeeDataChangeRequest.create.mockResolvedValue(needsReviewRequest);

  const result = await service.createOnboardingIntake(
    { ...newHireIntake, existingEmployeeId: undefined },
    hrAdmin.id,
  );

  expect(result.matchStatus).toBe('needs_review');
  expect(result.matchedEmployeeId).toBeNull();
});

it('releases only the never-effective reservation when pending entry is cancelled', async () => {
  prisma.employeeDataChangeRequest.findUnique.mockResolvedValue(pendingEntryRequest);
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));

  const result = await service.cancelReentry(
    pendingEntryRequest.id,
    { reason: '员工放弃入职' },
    hrAdmin.id,
  );

  expect(result.onboardingStatus).toBe('cancelled');
  expect(prisma.employeeNumberAssignment.updateMany).toHaveBeenCalledWith({
    where: {
      sourceRequestId: pendingEntryRequest.id,
      status: 'reserved',
    },
    data: expect.objectContaining({ status: 'released' }),
  });
  expect(prisma.employeeNumberAssignment.deleteMany).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run the focused tests and verify they fail because the service is absent**

Run from `api`:

```powershell
npm test -- --runInBand src/employee-archives/employee-onboarding.service.spec.ts
```

Expected: FAIL because the service and DTO module do not exist.

- [ ] **Step 4: Implement normalized payload hashing and non-blocking warnings**

In `EmployeeOnboardingService`, implement stable canonical serialization using only the Node standard library:

```ts
private canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => this.canonicalize(item));
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = this.canonicalize((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value instanceof Date ? value.toISOString() : value;
}

hashIntakePayload(input: CreateOnboardingIntakeDto): string {
  return createHash('sha256')
    .update(JSON.stringify(this.canonicalize(input)))
    .digest('hex');
}

private buildWarnings(input: EmployeeReentryFieldsDto) {
  const warnings: Array<{ field: string; message: string }> = [];
  if (!input.contractReferences?.length) {
    warnings.push({ field: 'contractReferences', message: '尚未关联新合同，可提交后补充' });
  }
  if (input.employeeStatus === UserStatus.probation && !input.plannedRegularDate) {
    warnings.push({ field: 'plannedRegularDate', message: '试用期员工尚未填写计划转正日' });
  }
  if (!input.directManagerId) {
    warnings.push({ field: 'directManagerId', message: '尚未设置直属主管，可提交后补充' });
  }
  if (input.effectiveDate < startOfTodayInShanghai()) {
    warnings.push({ field: 'effectiveDate', message: '该日期将作为历史补录处理' });
  }
  return warnings;
}
```

Add a local `startOfTodayInShanghai()` helper next to the service using the repository's existing timezone/date utility; do not add a date library.

- [ ] **Step 5: Implement blocking invariants and reentry creation**

In one Prisma transaction:

1. Fetch the existing user including latest employment and archive state.
2. Compute `historicalOnly = effectiveTo != null && effectiveTo < startOfTodayInShanghai()`. For a current/future reentry, require the user to be resigned or archived and reject any current non-resigned employment. For `historicalOnly`, allow an existing active employee because the record cannot affect current login/projection; retain overlap as a warning unless it would create a second current effective employment. In both modes reject another non-final onboarding request for the same employee.
3. Verify department, position and manager IDs exist; manager must be `active` or `probation`.
4. Reserve the employee number. Convert a released reservation owned by the same user back to `reserved`; reject any occupied assignment owned by another user.
5. Store original `status`, `archivedAt`, `employeeNo` and latest employment in `baseValue`.
6. Store the complete normalized input, warnings and payload hash in `proposedValue`.
7. Set `sourceType='manual_reentry'`, `sourceSystem='manual'` by default, `intakeType='reentry'`, `onboardingStatus='submitted'`, `recordStatus='submitted'`, profile review `pending`, performance review `not_required`.
8. Write `AuditLog.action='submit_employee_reentry'` with the request ID, employee ID, source metadata and masked before/after summary; do not include raw contact or binding identifiers.

Use an explicit unfinished-status predicate in every query:

```ts
const unfinishedStatuses: OnboardingStatus[] = [
  OnboardingStatus.draft,
  OnboardingStatus.submitted,
  OnboardingStatus.pending_entry,
];
```

Do not infer reentry by `EmploymentType.rehire`; persist the exact employment type selected by HR.

- [ ] **Step 6: Implement revision, cancellation and current-request lookup**

Revision must append the prior version before replacing the proposal:

```ts
const revisionEntry = {
  version: request.requestVersion,
  proposedValue: request.proposedValue,
  validationWarnings: request.validationWarnings,
  revisedAt: now.toISOString(),
  revisedById: operatorId,
};

await tx.employeeDataChangeRequest.update({
  where: { id: requestId },
  data: {
    proposedValue: nextProposedValue,
    validationWarnings: nextWarnings,
    requestVersion: { increment: 1 },
    revisionHistory: [...asArray(request.revisionHistory), revisionEntry],
    profileReviewStatus: 'pending',
    profileReviewedById: null,
    profileReviewedAt: null,
    rejectedReason: null,
    recordStatus: 'submitted',
    onboardingStatus: OnboardingStatus.submitted,
  },
});
```

Cancellation is allowed only for `draft`, `submitted`, or `pending_entry`. For `pending_entry`, delete only the never-effective future `EmploymentRecord` whose `sourceRequestId` matches, restore the status/archive/employeeNo snapshot, mark the reservation `released`, and retain the request with `cancelledAt`, `cancelledById`, `cancelledReason`, `recordStatus='cancelled'`, `onboardingStatus='cancelled'`. Never delete an effective or historical employment record.

Revision and cancellation each write an audit row in the same transaction using actions `revise_employee_reentry` and `cancel_employee_reentry`. The audit `newValue` contains only request ID, version/status, operator ID, effective date and masked employee-number transition.

- [ ] **Step 7: Implement the recruitment intake adapter without formal employee creation**

`createOnboardingIntake` must:

- Fetch by `(sourceSystem, sourceReference)` first.
- Return the original request when `proposedValue.payloadHash` matches.
- Throw `ConflictException('来源编号已存在，但本次内容与原草稿不一致')` when it differs.
- If `intakeType='reentry'` and `existingEmployeeId` is valid, create a `draft` request tied to that employee and return `matched_reentry`.
- If the external request omits a confirmed employee ID, use normalized phone/email only inside the transaction to find candidates, then store only masked identity data and candidate user IDs in a non-sensitive `matchCandidates` summary; never persist or log the raw phone/email in `proposedValue`. Return `needs_review` with `matchedEmployeeId=null`.
- If `intakeType='new_hire'`, create an unbound draft (`userId=null`) and return `new`; do not create `User`, `EmploymentRecord`, binding, password, or organization data.
- On first creation, write `AuditLog.action='create_onboarding_intake'` with source system/reference, intake type, match status and request ID only. Identical retries do not create another audit row.

Use these masking helpers before constructing `proposedValue`:

```ts
private maskPhone(phone?: string): string | null {
  const value = phone?.trim();
  if (!value) return null;
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}${'*'.repeat(value.length - 7)}${value.slice(-4)}`;
}

private maskEmail(email?: string): string | null {
  const value = email?.trim().toLowerCase();
  if (!value) return null;
  const [name, domain] = value.split('@');
  if (!domain) return '*'.repeat(value.length);
  return `${name.slice(0, 1)}***@${domain}`;
}
```

- [ ] **Step 8: Register the service and run the test suite**

Add `EmployeeOnboardingService` to `providers` and `exports` in `EmployeeArchivesModule`.

Run from `api`:

```powershell
npx prisma generate
npm test -- --runInBand src/employee-archives/employee-onboarding.service.spec.ts
npm run build
```

Expected: focused service tests and build PASS.

- [ ] **Step 9: Commit the onboarding domain service**

```powershell
git add api/src/employee-archives/dto/employee-onboarding.dto.ts api/src/employee-archives/employee-onboarding.service.ts api/src/employee-archives/employee-onboarding.service.spec.ts api/src/employee-archives/employee-archives.module.ts
git diff --cached --check
git commit -m "feat(personnel): add reentry application service"
```

---

### Task 3: Expose reentry and recruitment-intake APIs

**Files:**
- Modify: `api/src/employee-archives/employee-archives.controller.ts`
- Create: `api/src/employee-archives/employee-archives.controller.spec.ts`
- Test: `api/test/suites/14-employee-onboarding.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2 `EmployeeOnboardingService` methods and DTOs.
- Produces:
  - `POST /api/v1/employee-archives/:userId/reentry`
  - `GET /api/v1/employee-archives/:userId/reentry/current`
  - `PATCH /api/v1/employee-archives/reentry/:requestId`
  - `POST /api/v1/employee-archives/reentry/:requestId/cancel`
  - `POST /api/v1/employee-archives/onboarding-intakes`

- [ ] **Step 1: Write failing controller delegation tests**

Create `employee-archives.controller.spec.ts` with a testing module that injects mocked `EmployeeOnboardingService` and the controller, then add these cases:

```ts
it('creates a reentry request for the selected historical employee', async () => {
  onboardingService.createReentry.mockResolvedValue(requestView);

  await expect(
    controller.createReentry(employeeId, dto, currentUser),
  ).resolves.toEqual(requestView);

  expect(onboardingService.createReentry).toHaveBeenCalledWith(
    employeeId,
    dto,
    currentUser.id,
  );
});

it('cancels a pending reentry through the onboarding service', async () => {
  onboardingService.cancelReentry.mockResolvedValue(cancelledRequestView);

  await expect(
    controller.cancelReentry(requestId, { reason: '员工放弃入职' }, currentUser),
  ).resolves.toEqual(cancelledRequestView);
});

it('creates an idempotent onboarding intake draft', async () => {
  onboardingService.createOnboardingIntake.mockResolvedValue(intakeResult);

  await expect(
    controller.createOnboardingIntake(intakeDto, currentUser),
  ).resolves.toEqual(intakeResult);
});
```

- [ ] **Step 2: Run the controller tests and verify the missing-route failure**

Run from `api`:

```powershell
npm test -- --runInBand src/employee-archives/employee-archives.controller.spec.ts
```

Expected: FAIL because the controller methods and injected service are absent.

- [ ] **Step 3: Add protected controller routes with plain business responses**

Inject `EmployeeOnboardingService` and add routes before the generic `@Get(':userId')` route so `onboarding-intakes` and `reentry` are not treated as user IDs:

```ts
@Post('onboarding-intakes')
@HrCapabilities('employee_archive_edit')
createOnboardingIntake(
  @Body() input: CreateOnboardingIntakeDto,
  @CurrentUser() operator: AuthUser,
) {
  return this.onboardingService.createOnboardingIntake(input, operator.id);
}

@Post(':userId/reentry')
@HrCapabilities('employee_archive_edit')
createReentry(
  @Param('userId', ParseUUIDPipe) userId: string,
  @Body() input: CreateEmployeeReentryDto,
  @CurrentUser() operator: AuthUser,
) {
  return this.onboardingService.createReentry(userId, input, operator.id);
}

@Get(':userId/reentry/current')
@HrCapabilities('employee_archive_edit')
getCurrentReentry(@Param('userId', ParseUUIDPipe) userId: string) {
  return this.onboardingService.getCurrentReentry(userId);
}

@Patch('reentry/:requestId')
@HrCapabilities('employee_archive_edit')
reviseReentry(
  @Param('requestId', ParseUUIDPipe) requestId: string,
  @Body() input: ReviseEmployeeReentryDto,
  @CurrentUser() operator: AuthUser,
) {
  return this.onboardingService.reviseReentry(requestId, input, operator.id);
}

@Post('reentry/:requestId/cancel')
@HrCapabilities('employee_archive_edit')
cancelReentry(
  @Param('requestId', ParseUUIDPipe) requestId: string,
  @Body() input: CancelEmployeeReentryDto,
  @CurrentUser() operator: AuthUser,
) {
  return this.onboardingService.cancelReentry(requestId, input, operator.id);
}
```

Import `CurrentUser` from `@/common/decorators/current-user.decorator`, `HrCapabilities` from `@/common/decorators/hr-capabilities.decorator`, and `AuthUser` from `@/common/types/auth.types`, matching the controller's existing imports. Inject `EmployeeOnboardingService` as `private readonly onboardingService` in the controller constructor.

- [ ] **Step 4: Add request-level tests for validation, idempotency and sensitive output**

Create `api/test/suites/14-employee-onboarding.e2e-spec.ts` with the standard test application and isolated fixture setup:

```ts
import { CompanyCode, SysRole, UserStatus } from '@prisma/client';
import { buildTestApp, closeTestApp, TestApp } from '../test-app';
import { FixtureFactory } from '../fixtures/fixture-factory';
import { login } from '../helpers/auth-helper';

describe('14-employee-onboarding', () => {
  let app: TestApp;
  let factory: FixtureFactory;
  let token: string;
  let resignedUserId: string;
  let deptId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    factory = new FixtureFactory(app.prisma);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    await factory.resetDataTables();
    const dept = await factory.getSeedDept();
    deptId = dept.id;
    const hr = await factory.createUser({
      employeeNo: 'HR-ONBOARD', name: '入职测试HR', sysRole: SysRole.hr, deptId,
    });
    await app.prisma.user.update({
      where: { id: hr.id },
      data: { hrCapabilities: ['employee_archive_edit', 'employee_archive_review', 'cycle_plan_edit'] },
    });
    await app.prisma.employmentRecord.create({
      data: {
        userId: hr.id, effectiveFrom: new Date('2020-01-01'), company: CompanyCode.fuede,
        deptId, employeeStatus: UserStatus.active, changeType: 'hire', employeeNo: 'HR-ONBOARD',
      },
    });
    token = await login(app.http, { employeeNo: 'HR-ONBOARD', password: 'test123' });

    const resigned = await factory.createUser({
      employeeNo: 'OLD-001', name: '历史员工', sysRole: SysRole.employee, deptId,
    });
    await app.prisma.user.update({
      where: { id: resigned.id },
      data: { status: UserStatus.resigned, archivedAt: new Date('2026-08-31'), leaveDate: new Date('2026-08-31') },
    });
    await app.prisma.employmentRecord.create({
      data: {
        userId: resigned.id, effectiveFrom: new Date('2024-01-01'), effectiveTo: new Date('2026-08-31'),
        company: CompanyCode.fuede, deptId, employeeStatus: UserStatus.resigned,
        entryDate: new Date('2024-01-01'), leaveDate: new Date('2026-08-31'),
        changeType: 'resignation', employeeNo: 'OLD-001',
      },
    });
    resignedUserId = resigned.id;
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const validReentry = () => ({
    employeeNo: 'R-2026-001', company: 'fuede', deptId,
    effectiveDate: '2099-10-01', employeeStatus: 'active',
    employmentType: 'full_time', contractReferences: [],
  });
  const createIntake = (body: Record<string, unknown>) => app.http
    .post('/api/v1/employee-archives/onboarding-intakes')
    .set(auth())
    .send(body);
```

Close the `describe` block after the following tests. Cover these exact responses:

```ts
it('rejects a reentry request without an employee number', async () => {
  const body = validReentry();
  delete (body as Partial<typeof body>).employeeNo;
  await app.http
    .post(`/api/v1/employee-archives/${resignedUserId}/reentry`)
    .set(auth())
    .send(body)
    .expect(400);
});

it('returns the same intake id for the same source and payload', async () => {
  const payload = {
    ...validReentry(),
    sourceSystem: 'recruitment', sourceReference: 'offer-001', intakeType: 'reentry',
    existingEmployeeId: resignedUserId,
    identitySnapshot: { name: '历史员工', phone: '13800000000' },
  };
  const first = await createIntake(payload).expect(201);
  const second = await createIntake(payload).expect(201);
  expect(second.body.data.intakeId).toBe(first.body.data.intakeId);
});

it('returns a readable conflict for a changed duplicate source reference', async () => {
  const payload = {
    ...validReentry(),
    sourceSystem: 'recruitment', sourceReference: 'offer-002', intakeType: 'reentry',
    existingEmployeeId: resignedUserId,
    identitySnapshot: { name: '历史员工', email: 'history@example.com' },
  };
  await createIntake(payload).expect(201);
  const conflict = await createIntake({
    ...payload,
    employeeNo: 'NEW-CHANGED',
  }).expect(409);
  expect(conflict.body.message).toContain('来源编号已存在');
});

it('does not return raw contact details or external identity values', async () => {
  const payload = {
    ...validReentry(),
    sourceSystem: 'recruitment', sourceReference: 'offer-003', intakeType: 'reentry',
    existingEmployeeId: resignedUserId,
    identitySnapshot: { name: '历史员工', phone: '13800000000' },
  };
  const response = await createIntake(payload).expect(201);
  expect(JSON.stringify(response.body)).not.toContain(payload.identitySnapshot.phone);
  expect(response.body.data).not.toHaveProperty('externalUnionId');
});
```

- [ ] **Step 5: Run focused API tests and build**

Run from `api`:

```powershell
npm test -- --runInBand src/employee-archives/employee-archives.controller.spec.ts
npm run test:e2e -- --runTestsByPath suites/14-employee-onboarding.e2e-spec.ts
npm run build
```

Expected: controller and request-level tests PASS; unknown IDs return readable `400/404`, duplicate source content returns `409`.

- [ ] **Step 6: Commit the public API contract**

```powershell
git add api/src/employee-archives/employee-archives.controller.ts api/src/employee-archives/employee-archives.controller.spec.ts api/test/suites/14-employee-onboarding.e2e-spec.ts
git diff --cached --check
git commit -m "feat(personnel): expose reentry onboarding APIs"
```

---

### Task 4: Integrate reentry into HR review and approval

**Files:**
- Modify: `api/src/employee-archives/employee-data-reviews.service.ts`
- Modify: `api/src/employee-archives/employee-data-reviews.service.spec.ts`
- Modify: `api/src/employee-archives/employee-onboarding.service.ts`
- Modify: `api/src/employee-archives/employee-effective-date.service.ts`
- Modify: `api/src/employee-archives/employee-effective-date.service.spec.ts`

**Interfaces:**
- Consumes: submitted `EmployeeDataChangeRequest` with `intakeType='reentry'` and Task 2 service.
- Produces:
  - `EmployeeOnboardingService.applyApprovedReentry(tx: Prisma.TransactionClient, requestId: string, reviewerId: string, at?: Date): Promise<'pending_entry' | 'effective' | 'historical'>`
  - `EmployeeEffectiveDateService.activateApprovedOnboarding(tx: Prisma.TransactionClient, requestId: string, at: Date): Promise<{ activated: boolean; historicalOnly: boolean }>` with projection/number status; Task 5 adds binding recovery and login compensation.
  - Existing `EmployeeDataReviewsService.approveBatch` can approve a reentry submitted by the same HR administrator.

- [ ] **Step 1: Write failing review tests for self-review, future state and historical backfill**

Add these cases to `employee-data-reviews.service.spec.ts`:

```ts
it('allows an HR administrator to approve their own reentry request', async () => {
  mockClaimedRequest(reentryRequestCreatedByReviewer);
  onboardingService.applyApprovedReentry.mockResolvedValue('pending_entry');

  const result = await service.approveBatch(
    { requestIds: [reentryRequestCreatedByReviewer.id], scopes: ['profile'] },
    reviewer,
  );

  expect(result.succeeded).toEqual([
    { requestId: reentryRequestCreatedByReviewer.id, scopes: ['profile'] },
  ]);
  expect(onboardingService.applyApprovedReentry).toHaveBeenCalledWith(
    expect.anything(),
    reentryRequestCreatedByReviewer.id,
    reviewer.id,
    expect.any(Date),
  );
});

it('sets future approved reentry to pending entry and resets elevated permissions', async () => {
  prisma.employeeDataChangeRequest.findUnique.mockResolvedValue(futureReentryRequest);
  await onboardingService.applyApprovedReentry(
    prisma,
    futureReentryRequest.id,
    reviewer.id,
    new Date('2026-09-18T00:00:00+08:00'),
  );

  expect(prisma.user.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: futureReentryRequest.userId },
      data: expect.objectContaining({
        status: 'pending_entry',
        archivedAt: null,
        sysRole: 'employee',
        hrCapabilities: { set: [] },
        canViewAll: false,
        isAssessorOnly: false,
      }),
    }),
  );
});

it('creates a historical employment without opening the account when the interval already ended', async () => {
  prisma.employeeDataChangeRequest.findUnique.mockResolvedValue(finishedHistoricalReentry);
  const result = await onboardingService.applyApprovedReentry(
    prisma,
    finishedHistoricalReentry.id,
    reviewer.id,
    new Date('2026-09-18T00:00:00+08:00'),
  );

  expect(result).toBe('historical');
  expect(prisma.user.update).not.toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'active' }) }),
  );
});

it('does not create a second employment when the same approval is retried', async () => {
  prisma.employmentRecord.findUnique.mockResolvedValue(existingRequestEmployment);
  await onboardingService.applyApprovedReentry(prisma, approvedRequest.id, reviewer.id, now);
  expect(prisma.employmentRecord.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused review tests and verify the missing integration failure**

Run from `api`:

```powershell
npm test -- --runInBand src/employee-archives/employee-data-reviews.service.spec.ts
```

Expected: FAIL because reentry requests still follow the generic profile apply path.

- [ ] **Step 3: Implement `applyApprovedReentry` as one transaction-owned operation**

The method receives the transaction opened by `approveBatch`; it must not start a nested transaction. It must:

1. Re-fetch and lock the request and target employee using the existing raw SQL locking helper used by review claims.
2. Return the existing state if the request is already `pending_entry`, `effective` or `cancelled` as an idempotent result.
3. Revalidate no current non-resigned employment and no competing unfinished onboarding request.
4. Revalidate the reserved employee number and all referenced organization IDs.
5. Create exactly one `EmploymentRecord` with `employeeNo`, `sourceRequestId`, `changeType='reentry'`, selected employment type/status, dates and manager.
6. For an already-ended historical interval, mark the number `historical`, retain the employee's current projection, and set the request `effective` only as completed history.
7. For a future interval, unarchive the employee, set `User.status=pending_entry`, set the approved next employee number, reset elevated permissions, and set the request `onboardingStatus=pending_entry`.
8. For an interval effective today or earlier and still current, invoke `EmployeeEffectiveDateService.activateApprovedOnboarding(tx, request.id, now)` inside the transaction. Implement the minimal transaction-owned helper in this task: promote the number to current, archive any previous current number, project the employee fields/standard permissions, and set onboarding status/effective timestamp. Task 5 extends this same helper with DingTalk recovery; it must not create a second activation path.

Use exact permission-reset data:

```ts
const standardUserPermissionReset: Prisma.UserUpdateInput = {
  sysRole: SysRole.employee,
  hrCapabilities: { set: [] },
  canViewAll: false,
  isAssessorOnly: false,
};
```

The method must not change `EmploymentType.rehire` unless the request explicitly selected it.

- [ ] **Step 4: Route reentry requests through the onboarding branch in `approveBatch`**

In the profile-approval branch:

```ts
if (request.intakeType === OnboardingIntakeType.reentry) {
  await this.onboardingService.applyApprovedReentry(
    tx,
    request.id,
    reviewerId,
    now,
  );
} else {
  await this.applyProfile(tx, request, reviewerId, now);
}
```

Keep the existing claim/compare-and-set behavior so two reviewers cannot both apply the same request. Do not add a creator-versus-reviewer restriction; self-review remains allowed for HR administrators.

- [ ] **Step 5: Make rejection preserve the draft and reserved employee number**

When rejecting a reentry request:

- Set `profileReviewStatus='rejected'`, `recordStatus='draft'`, `onboardingStatus='draft'` and retain the reservation.
- Do not unarchive the user, create employment, enable login, or release the number.
- Save the reason in `rejectedReason` and allow `reviseReentry` to submit the next version.

Add this assertion:

```ts
expect(prisma.employeeNumberAssignment.updateMany).not.toHaveBeenCalledWith(
  expect.objectContaining({ data: expect.objectContaining({ status: 'released' }) }),
);
```

- [ ] **Step 6: Run review/onboarding tests and API build**

Run from `api`:

```powershell
npm test -- --runInBand src/employee-archives/employee-onboarding.service.spec.ts src/employee-archives/employee-data-reviews.service.spec.ts src/employee-archives/employee-effective-date.service.spec.ts
npm run build
```

Expected: self-review, future pending, immediate/historical apply, rejection and idempotent retry tests PASS.

- [ ] **Step 7: Commit the review integration**

```powershell
git add api/src/employee-archives/employee-data-reviews.service.ts api/src/employee-archives/employee-data-reviews.service.spec.ts api/src/employee-archives/employee-onboarding.service.ts api/src/employee-archives/employee-effective-date.service.ts api/src/employee-archives/employee-effective-date.service.spec.ts
git diff --cached --check
git commit -m "feat(personnel): approve reentry applications"
```

---

### Task 5: Implement idempotent activation, permission reset and DingTalk restoration

**Files:**
- Modify: `api/src/employee-archives/employee-effective-date.service.ts`
- Modify: `api/src/employee-archives/employee-effective-date.service.spec.ts`
- Modify: `api/src/auth/auth.module.ts`
- Modify: `api/src/auth/auth.service.ts`
- Modify: `api/src/auth/auth.service.spec.ts`
- Modify: `api/src/scheduler/scheduler.service.spec.ts`

**Interfaces:**
- Consumes: Task 4 `activateApprovedOnboarding`, approved pending-entry request, employment source link and employee-number assignment.
- Produces:
  - `EmployeeEffectiveDateService.refreshUserProjection(userId: string, at?: Date): Promise<{ activated: boolean; historicalOnly: boolean }>`
  - Extended `EmployeeEffectiveDateService.activateApprovedOnboarding(...)` with DingTalk binding recovery and activation audit.
  - Existing `refreshEffectiveProjections(at)` delegates per user to the same logic.

- [ ] **Step 1: Write failing activation tests**

Add these cases to `employee-effective-date.service.spec.ts`:

```ts
it('activates a due reentry and projects its number, organization and manager', async () => {
  mockDueReentry();
  await service.refreshUserProjection(employeeId, new Date('2026-09-18T08:00:00+08:00'));

  expect(prisma.user.update).toHaveBeenCalledWith({
    where: { id: employeeId },
    data: expect.objectContaining({
      employeeNo: 'R-2026-001',
      deptId,
      positionId,
      directManagerId,
      status: 'probation',
      archivedAt: null,
      sysRole: 'employee',
      hrCapabilities: [],
      canViewAll: false,
      isAssessorOnly: false,
    }),
  });
});

it('does not activate before the effective date', async () => {
  mockFutureReentry();
  const result = await service.refreshUserProjection(employeeId, beforeEffectiveDate);
  expect(result.activated).toBe(false);
  expect(prisma.externalIdentityBinding.updateMany).not.toHaveBeenCalled();
});

it('reenables only a DingTalk binding disabled by approved resignation', async () => {
  mockDueReentry({ bindingDisabledReason: '员工档案审核为离职' });
  await service.refreshUserProjection(employeeId, effectiveDate);
  expect(prisma.externalIdentityBinding.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: 'enabled',
        disabledAt: null,
        disabledById: null,
        disabledReason: null,
      }),
    }),
  );
});

it('keeps a manually disabled or conflicting DingTalk binding disabled', async () => {
  mockDueReentry({ bindingDisabledReason: '管理员手动停用', conflictingUserId });
  await service.refreshUserProjection(employeeId, effectiveDate);
  expect(prisma.externalIdentityBinding.update).not.toHaveBeenCalled();
  expect(prisma.employeeDataChangeRequest.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        validationWarnings: expect.arrayContaining([
          expect.objectContaining({ field: 'dingtalkBinding' }),
        ]),
      }),
    }),
  );
});

it('is a no-op after the same onboarding request was activated', async () => {
  mockEffectiveRequest();
  const result = await service.refreshUserProjection(employeeId, effectiveDate);
  expect(result.activated).toBe(false);
  expect(prisma.user.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused activation tests and verify they fail**

Run from `api`:

```powershell
npm test -- --runInBand src/employee-archives/employee-effective-date.service.spec.ts
```

Expected: FAIL because single-user activation, employee-number projection and binding restoration are absent.

- [ ] **Step 3: Implement one transaction-safe activation path**

`activateApprovedOnboarding` must:

1. Fetch the request with source employment and number assignment under the caller transaction.
2. Return `{ activated:false, historicalOnly:false }` when status is already `effective/cancelled` or effective date is in the future.
3. When the employment already ended, mark the number historical, mark request effective, and return `{ activated:false, historicalOnly:true }` without changing current `User` or binding.
4. End any prior `current` number assignment for the same user by changing it to `historical` and setting `effectiveTo` to the day before the new record starts.
5. Promote the reserved assignment to `current` and clear `releasedAt`.
6. Project `employeeNo`, `deptId`, `positionId`, `position`, `directManagerId`, dates, employment type and employee status to `User`. Keep `company` canonical on the current `EmploymentRecord` and return it through `currentEmployment`; do not add a second `User.company` field solely for this feature.
7. Reset permissions again as defense in depth.
8. Re-enable only a unique, non-ended DingTalk binding whose `disabledReason` equals the resignation-generated reason. A conflict writes a warning and does not roll back employment activation.
9. Set request `onboardingStatus='effective'`, keep `recordStatus='submitted'` for compatibility with the existing review ledger, and set `appliedAt=at`.
10. Write one `AuditLog.action='activate_employee_reentry'` row in the same transaction. The request status makes retries no-ops, so retries must not duplicate this audit event.

Keep the exact resignation-generated disable reason in one exported constant shared with the review service:

```ts
export const RESIGNATION_BINDING_DISABLED_REASON = '员工档案审核为离职';
```

- [ ] **Step 4: Delegate batch refresh to the per-user method**

`refreshEffectiveProjections(at)` should first select distinct affected user IDs, then call `refreshUserProjection(userId, at)` for each. Preserve the existing scheduler result shape and count only actual activations/updates. Do not duplicate activation logic in the batch method.

- [ ] **Step 5: Write failing local and DingTalk login-compensation tests**

First extend the existing `createService` test factory in `auth.service.spec.ts`:

```ts
import { EmployeeEffectiveDateService } from '../employee-archives/employee-effective-date.service';

const effectiveDateService = {
  refreshUserProjection: jest.fn().mockResolvedValue({
    activated: false,
    historicalOnly: false,
  }),
};

const service = new AuthService(
  prisma as unknown as PrismaService,
  jwt as unknown as JwtService,
  config as unknown as ConfigService,
  dingtalk as unknown as DingtalkService,
  businessCapabilities as unknown as BusinessCapabilitiesService,
  effectiveDateService as unknown as EmployeeEffectiveDateService,
);

return { service, prisma, jwt, dingtalk, businessCapabilities, effectiveDateService };
```

Then add:

```ts
const pendingEmployee = {
  ...eligibleUser,
  id: 'pending-entry-user-id',
  employeeNo: 'R-2026-001',
  status: 'pending_entry',
};
const activeEmployeeAfterRefresh = { ...pendingEmployee, status: 'active' };
const employeeId = pendingEmployee.id;
const resignationDisabledBinding = {
  id: 'binding-reentry', provider: 'dingtalk', externalUnionId: 'union-reentry',
  status: 'disabled', endedAt: null, disabledReason: '员工档案审核为离职',
  user: pendingEmployee,
};
const enabledBindingAfterRefresh = {
  ...resignationDisabledBinding,
  status: 'enabled',
  disabledReason: null,
  user: activeEmployeeAfterRefresh,
};
const manuallyDisabledBinding = {
  ...resignationDisabledBinding,
  externalUnionId: 'union-manually-disabled',
  disabledReason: '管理员手动停用',
};

it('runs due onboarding activation before current-employment validation for local login', async () => {
  const { service, prisma, jwt, effectiveDateService } = createService(false);
  prisma.user.findFirst.mockResolvedValue(pendingEmployee);
  effectiveDateService.refreshUserProjection.mockResolvedValue({ activated: true, historicalOnly: false });
  prisma.user.findUnique.mockResolvedValue(activeEmployeeAfterRefresh);
  prisma.employmentRecord.findFirst.mockResolvedValue({ id: 'employment-due' });
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);

  await service.localLogin({ employeeNo: pendingEmployee.employeeNo!, password: '123456' });

  expect(effectiveDateService.refreshUserProjection).toHaveBeenCalledWith(pendingEmployee.id);
  expect(jwt.signAsync).toHaveBeenCalledTimes(1);
});

it('still rejects local login before the effective date', async () => {
  const { service, prisma, effectiveDateService } = createService(false);
  prisma.user.findFirst.mockResolvedValue(pendingEmployee);
  effectiveDateService.refreshUserProjection.mockResolvedValue({ activated: false, historicalOnly: false });
  prisma.user.findUnique.mockResolvedValue(pendingEmployee);
  prisma.employmentRecord.findFirst.mockResolvedValue(null);
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);

  await expect(service.localLogin({ employeeNo: pendingEmployee.employeeNo!, password: '123456' }))
    .rejects.toBeInstanceOf(UnauthorizedException);
});

it('can inspect a resignation-disabled DingTalk binding only to run activation', async () => {
  const { service, prisma, dingtalk, jwt, effectiveDateService } = createService(false);
  dingtalk.getAuthCodeUnionId.mockResolvedValue('union-reentry');
  prisma.externalIdentityBinding.findFirst
    .mockResolvedValueOnce(resignationDisabledBinding)
    .mockResolvedValueOnce(enabledBindingAfterRefresh);
  effectiveDateService.refreshUserProjection.mockResolvedValue({ activated: true, historicalOnly: false });
  prisma.employmentRecord.findFirst.mockResolvedValue({ id: 'employment-due' });

  await service.dingtalkLogin({ authCode: 'auth-code', loginMode: 'internal' });

  expect(effectiveDateService.refreshUserProjection).toHaveBeenCalledWith(employeeId);
  expect(jwt.signAsync).toHaveBeenCalledTimes(1);
});

it('does not bypass a manually disabled DingTalk binding', async () => {
  const { service, prisma, dingtalk, effectiveDateService } = createService(false);
  dingtalk.getAuthCodeUnionId.mockResolvedValue('union-manually-disabled');
  prisma.externalIdentityBinding.findFirst.mockResolvedValue(manuallyDisabledBinding);
  effectiveDateService.refreshUserProjection.mockResolvedValue({ activated: false, historicalOnly: false });

  await expect(service.dingtalkLogin({ authCode: 'auth-code', loginMode: 'internal' }))
    .rejects.toBeInstanceOf(UnauthorizedException);
});
```

- [ ] **Step 6: Inject the effective-date service into authentication and implement compensation**

Import `EmployeeArchivesModule` in `AuthModule`, inject `EmployeeEffectiveDateService`, and use this sequence for both real login paths:

```ts
await this.effectiveDateService.refreshUserProjection(user.id);
const refreshedUser = await this.prisma.user.findUnique({
  where: { id: user.id },
  include: this.authUserInclude,
});
if (!refreshedUser) {
  throw new UnauthorizedException('账号不存在');
}
await this.assertCurrentEmployment(refreshedUser.id);
```

For DingTalk, locate a unique non-ended binding to identify the user, perform compensation, then refetch and require `status='enabled'`. Never issue tokens using the pre-refresh disabled binding.

- [ ] **Step 7: Verify scheduler delegation and run focused tests**

Add one scheduler assertion that the daily job still calls `refreshEffectiveProjections` with the job timestamp. Run from `api`:

```powershell
npm test -- --runInBand src/employee-archives/employee-effective-date.service.spec.ts src/auth/auth.service.spec.ts src/scheduler/scheduler.service.spec.ts
npm run build
```

Expected: activation, binding, login compensation, scheduler and build tests PASS.

- [ ] **Step 8: Commit activation and login behavior**

```powershell
git add api/src/employee-archives/employee-effective-date.service.ts api/src/employee-archives/employee-effective-date.service.spec.ts api/src/employee-archives/employee-data-reviews.service.ts api/src/auth/auth.module.ts api/src/auth/auth.service.ts api/src/auth/auth.service.spec.ts api/src/scheduler/scheduler.service.spec.ts
git diff --cached --check
git commit -m "feat(personnel): activate reentry by effective date"
```

---

### Task 6: Exclude pending-entry employees from current business scopes

**Files:**
- Create: `api/src/common/personnel/current-worker.ts`
- Modify: `api/src/users/dto/user-query.dto.ts`
- Modify: `api/src/users/users.service.ts`
- Modify: `api/src/users/users.service.spec.ts`
- Modify: `api/src/positions/positions.service.ts`
- Modify: `api/src/positions/positions.service.spec.ts`
- Modify: `api/src/departments/departments.service.ts`
- Modify: `api/src/departments/departments.service.spec.ts`
- Modify: `api/src/auth/business-capabilities.service.ts`
- Modify: `api/src/auth/business-capabilities.service.spec.ts`
- Modify: `api/src/cycles/cycles.service.ts`
- Modify: `api/src/cycles/cycles.service.spec.ts`
- Modify: `api/src/cycles/launch.service.ts`
- Modify: `api/src/cycles/launch.service.spec.ts`

**Interfaces:**
- Consumes: `UserStatus.pending_entry` from Task 1.
- Produces: a single reusable current-worker predicate, `eligibleFor=direct_manager`, and tests proving pending-entry employees remain visible in personnel lists but cannot act as a manager, owner, approver, department member count, position occupant or cycle participant.

- [ ] **Step 1: Add a shared current-worker predicate**

Create or extend the existing personnel query helper under `api/src/common` with this exact value:

```ts
import { Prisma, UserStatus } from '@prisma/client';

export const CURRENT_WORKER_STATUSES: UserStatus[] = [
  UserStatus.active,
  UserStatus.probation,
];

export const currentWorkerWhere: Prisma.UserWhereInput = {
  deletedAt: null,
  archivedAt: null,
  status: { in: CURRENT_WORKER_STATUSES },
};
```

Name the file `api/src/common/personnel/current-worker.ts`; update the file map and imports rather than copying raw status arrays across services.

- [ ] **Step 2: Write failing scope-boundary tests before changing queries**

In each affected service spec, add at least one concrete assertion. The core assertions are:

```ts
expect(prisma.user.findMany).toHaveBeenCalledWith(
  expect.objectContaining({
    where: expect.objectContaining({
      status: { in: ['active', 'probation'] },
    }),
  }),
);
```

Add named cases:

```ts
it('keeps pending-entry employees visible in the personnel list pending-entry filter');
it('does not return pending-entry users as cycle owners');
it('returns only active or probation employees as direct-manager candidates');
it('does not count pending-entry users as active position occupants');
it('does not count pending-entry users as current department members');
it('does not grant manager business capabilities to pending-entry users');
it('does not offer pending-entry users as cycle HR owners or approvers');
it('does not include pending-entry users in cycle launch candidates');
```

For the personnel-list case, assert the explicit status filter remains supported:

```ts
await service.findAll({ status: UserStatus.pending_entry });
expect(prisma.user.findMany).toHaveBeenCalledWith(
  expect.objectContaining({
    where: expect.objectContaining({ status: UserStatus.pending_entry }),
  }),
);
```

- [ ] **Step 3: Run the focused scope tests and verify current broad filters fail**

Run from `api`:

```powershell
npm test -- --runInBand src/users/users.service.spec.ts src/positions/positions.service.spec.ts src/departments/departments.service.spec.ts src/auth/business-capabilities.service.spec.ts src/cycles/cycles.service.spec.ts src/cycles/launch.service.spec.ts
```

Expected: at least the tests covering existing `{ not: resigned }` queries FAIL.

- [ ] **Step 4: Replace only business-scope uses of `not: resigned`**

Use `CURRENT_WORKER_STATUSES` for:

- cycle-owner/HR-owner/approver candidate queries;
- manager and direct-report business capabilities;
- department member and position occupant counts;
- cycle launch participant and reviewer discovery;
- reentry manager-reference validation.

Do not globally replace every `not: resigned` occurrence. The employee personnel list must still support `all`, `pending_entry`, `resigned`, `draft` and `archived` views. Local authentication may load a pending employee only long enough to run Task 5 activation, but token issuance still requires a current employment.

Extend `api/src/users/dto/user-query.dto.ts` so `eligibleFor` accepts both existing `cycle_owner` and new `direct_manager` values:

```ts
@IsOptional()
@IsIn(['cycle_owner', 'direct_manager'])
eligibleFor?: 'cycle_owner' | 'direct_manager';
```

In `UsersService.findAll`, keep the existing HR-specific `cycle_owner` rules unchanged except for replacing broad status checks with `CURRENT_WORKER_STATUSES`. Add a separate `direct_manager` branch that applies the current-worker predicate and employee account type but does not require an HR capability:

```ts
if (dto.eligibleFor === 'direct_manager') {
  Object.assign(where, currentWorkerWhere, {
    accountType: AccountType.employee,
  });
}
```

The existing data-scope restriction must continue to apply. Self-selection is prevented by the UI's `disabledIds`, while the onboarding service remains the authoritative blocker for self-reference and stale IDs.

- [ ] **Step 5: Add an integration regression test for business invisibility**

In `api/test/suites/14-employee-onboarding.e2e-spec.ts`, create and approve a future reentry, then assert through real HTTP endpoints:

```ts
const created = await app.http
  .post(`/api/v1/employee-archives/${resignedUserId}/reentry`)
  .set(auth())
  .send({ ...validReentry(), effectiveDate: '2099-10-01' })
  .expect(201);
const requestId = created.body.data.id as string;

await app.http
  .post('/api/v1/employee-archives/reviews/approve')
  .set(auth())
  .send({ requestIds: [requestId], scopes: ['profile'] })
  .expect(201);

const pending = await app.http
  .get('/api/v1/users?status=pending_entry')
  .set(auth())
  .expect(200);
expect(pending.body.data.items).toContainEqual(
  expect.objectContaining({ id: resignedUserId, status: 'pending_entry' }),
);

const owners = await app.http
  .get('/api/v1/users?eligibleFor=cycle_owner')
  .set(auth())
  .expect(200);
expect(owners.body.data.items).not.toContainEqual(
  expect.objectContaining({ id: resignedUserId }),
);

const managers = await app.http
  .get('/api/v1/users?eligibleFor=direct_manager')
  .set(auth())
  .expect(200);
expect(managers.body.data.items).not.toContainEqual(
  expect.objectContaining({ id: resignedUserId }),
);

const participants = await app.http
  .get('/api/v1/cycles/participant-candidates')
  .set(auth())
  .expect(200);
expect(participants.body.data.items).not.toContainEqual(
  expect.objectContaining({ id: resignedUserId }),
);
```

- [ ] **Step 6: Run scope tests and API build**

Run from `api`:

```powershell
npm test -- --runInBand src/users/users.service.spec.ts src/positions/positions.service.spec.ts src/departments/departments.service.spec.ts src/auth/business-capabilities.service.spec.ts src/cycles/cycles.service.spec.ts src/cycles/launch.service.spec.ts
npm run test:e2e -- --runTestsByPath suites/14-employee-onboarding.e2e-spec.ts
npm run build
```

Expected: all focused tests and build PASS.

- [ ] **Step 7: Commit the scope boundary**

```powershell
git add api/src/common/personnel/current-worker.ts api/src/users/dto/user-query.dto.ts api/src/users/users.service.ts api/src/users/users.service.spec.ts api/src/positions/positions.service.ts api/src/positions/positions.service.spec.ts api/src/departments/departments.service.ts api/src/departments/departments.service.spec.ts api/src/auth/business-capabilities.service.ts api/src/auth/business-capabilities.service.spec.ts api/src/cycles/cycles.service.ts api/src/cycles/cycles.service.spec.ts api/src/cycles/launch.service.ts api/src/cycles/launch.service.spec.ts api/test/suites/14-employee-onboarding.e2e-spec.ts
git diff --cached --check
git commit -m "fix(personnel): isolate pending entry from active scopes"
```

---

### Task 7: Add the Web API client and compact reentry drawer

**Files:**
- Modify: `web/src/types/enums.ts`
- Modify: `web/src/types/api.types.ts`
- Modify: `web/src/components/common/UserSelect.vue`
- Modify: `web/src/api/employee-archives.api.ts`
- Create: `web/src/views/admin/components/EmployeeReentryDrawer.vue`
- Create: `web/e2e/specs/58-employee-reentry-drawer.spec.ts`

**Interfaces:**
- Consumes: Task 3 HTTP routes and Task 1 `pending_entry` status.
- Produces:
  - `employeeArchivesApi.createReentry(userId, payload)`
  - `employeeArchivesApi.getCurrentReentry(userId)`
  - `employeeArchivesApi.reviseReentry(requestId, payload)`
  - `employeeArchivesApi.cancelReentry(requestId, reason)`
  - `EmployeeReentryDrawer` props `modelValue`, `employee`, `request`; emits `update:modelValue`, `submitted`, `cancelled`.

- [ ] **Step 1: Extend Web types with exact API shapes**

In `web/src/types/enums.ts`:

```ts
export type UserStatus = 'active' | 'probation' | 'pending_entry' | 'resigned'
```

In `employee-archives.api.ts`, add:

```ts
import type { CompanyCode, EmploymentType } from '@/types/enums'

export type OnboardingStatus = 'draft' | 'submitted' | 'pending_entry' | 'effective' | 'cancelled'

export interface EmployeeReentryPayload {
  employeeNo: string
  company: CompanyCode
  deptId?: string | null
  positionId?: string | null
  position?: string | null
  directManagerId?: string | null
  effectiveDate: string
  effectiveTo?: string | null
  employeeStatus: 'active' | 'probation'
  employmentType: EmploymentType
  plannedRegularDate?: string | null
  probationMonths?: number | null
  contractReferences?: Array<{ kind: string; reference: string }>
  sourceSystem?: string
  sourceReference?: string
}

export interface EmployeeReentryRequest {
  id: string
  userId: string | null
  employeeName: string
  employeeNo: string | null
  intakeType: 'new_hire' | 'reentry' | null
  onboardingStatus: OnboardingStatus | null
  requestVersion: number
  recordStatus: string
  proposedValue: EmployeeReentryPayload
  validationWarnings: Array<{ field: string; message: string }>
  createdAt: string
  updatedAt: string
}
```

Extend the existing `EmployeeDataReview` interface with:

```ts
sourceSystem?: string | null
sourceReference?: string | null
intakeType?: 'new_hire' | 'reentry' | null
onboardingStatus?: OnboardingStatus | null
requestVersion?: number
revisionHistory?: Array<Record<string, unknown>>
validationWarnings: Array<{ field: string; message: string }>
```

Also extend `EmployeeArchive.status`, `EmployeeArchive.currentEmployment.employeeStatus` and the corresponding `employmentHistory` item status unions with `'pending_entry'`. Keep `EmployeeDataReview.validationWarnings` backward-compatible as `Array<string | { field: string; message: string }>` while legacy roster reviews still return string warnings.

Add client methods using the exact Task 3 paths.

- [ ] **Step 2: Write a failing isolated Playwright drawer test**

Create `web/e2e/specs/58-employee-reentry-drawer.spec.ts`. Install the same mocked HR session pattern as the existing personnel specs, intercept the employee/reentry routes, and keep all fixture data synthetic:

```ts
import { expect, test, type Page } from '@playwright/test'

const apiResponse = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() })

async function installHrSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-hr-token')
    localStorage.setItem('expiresAt', String(Date.now() + 600_000))
  })
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: apiResponse(0) }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    json: apiResponse({
      id: '30000000-0000-4000-8000-000000000001',
      name: 'HR管理员',
      sysRole: 'hr',
      canViewAll: true,
      hrCapabilities: ['employee_archive_edit', 'employee_archive_review'],
    }),
  }))
}

test('shows compact reentry sections, local warnings, flow and cancellation', async ({ page }) => {
  const submitted: Array<Record<string, unknown>> = []
  await installHrSession(page)
  const pendingEmployee = {
    id: '22222222-2222-4222-8222-222222222222',
    name: '测试员工',
    employeeNo: 'R-2026-001',
    deptId: null,
    deptName: null,
    position: '测试岗位',
    employmentType: 'full_time',
    status: 'pending_entry',
    directManagerId: null,
    directManagerName: null,
    sysRole: 'employee',
    systemPermission: 'standard_user',
    businessIdentities: ['员工'],
    isAssessorOnly: false,
    canViewAll: false,
    dingtalkBindingState: 'disabled',
    archivedAt: null,
    leaveDate: '2026-08-31',
  }
  await page.route('**/api/v1/users**', (route) => route.fulfill({
    json: apiResponse({ total: 1, page: 1, pageSize: 20, items: [pendingEmployee] }),
  }))
  await page.route('**/api/v1/departments**', (route) => route.fulfill({ json: apiResponse([]) }))
  await page.route('**/api/v1/positions**', (route) => route.fulfill({ json: apiResponse([]) }))
  await page.route('**/api/v1/employee-archives/drafts/list**', (route) => route.fulfill({
    json: apiResponse({ total: 0, page: 1, pageSize: 20, items: [] }),
  }))
  await page.route(`**/api/v1/employee-archives/${pendingEmployee.id}`, (route) => route.fulfill({
    json: apiResponse({
      ...pendingEmployee,
      dept: null,
      currentEmployment: null,
      employmentHistory: [{
        id: '40000000-0000-4000-8000-000000000001',
        employeeNo: 'OLD-001',
        effectiveFrom: '2024-01-01',
        effectiveTo: '2026-08-31',
        company: 'fuede',
        position: '历史岗位',
        employeeStatus: 'resigned',
      }],
      employeeContracts: [],
      dingtalkBinding: { status: 'disabled', disabledReason: '员工档案审核为离职' },
    }),
  }))
  await page.route('**/api/v1/employee-archives/*/reentry/current', async (route) => {
    await route.fulfill({
      json: {
        id: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        employeeName: '测试员工',
        employeeNo: 'R-2026-001',
        intakeType: 'reentry',
        onboardingStatus: 'pending_entry',
        requestVersion: 1,
        recordStatus: 'applied',
        proposedValue: {
          employeeNo: 'R-2026-001',
          company: 'fuede',
          deptId: null,
          positionId: null,
          position: '测试岗位',
          directManagerId: null,
          effectiveDate: '2026-10-01',
          employeeStatus: 'active',
          employmentType: 'full_time',
          contractReferences: [],
        },
        validationWarnings: [
          { field: 'contractReferences', message: '尚未关联新合同，可提交后补充' },
          { field: 'directManagerId', message: '尚未设置直属主管，可提交后补充' },
        ],
        createdAt: '2026-09-18T08:00:00.000Z',
        updatedAt: '2026-09-18T08:00:00.000Z',
      },
    })
  })
  await page.route('**/api/v1/employee-archives/reentry/*/cancel', async (route) => {
    submitted.push(route.request().postDataJSON())
    await route.fulfill({ json: { onboardingStatus: 'cancelled' } })
  })

  await page.goto('/users?status=pending_entry')
  await page.getByRole('button', { name: '查看入职' }).first().click()
  await expect(page.getByRole('heading', { name: '历史身份' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '本次入职' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '关联信息' })).toBeVisible()
  await expect(page.getByText('已创建')).toBeVisible()
  await expect(page.getByText('HR 审核')).toBeVisible()
  await expect(page.getByText('待入职')).toBeVisible()
  await expect(page.getByText('已生效')).toBeVisible()
  await expect(page.locator('[data-field-warning="contractReferences"]')).toContainText('尚未关联新合同')
  await expect(page.locator('[data-field-warning="directManagerId"]')).toContainText('尚未设置直属主管')

  await page.getByRole('button', { name: '取消入职' }).click()
  await page.getByLabel('取消原因').fill('员工放弃入职')
  await page.getByRole('button', { name: '确认取消入职' }).click()
  expect(submitted).toEqual([{ reason: '员工放弃入职' }])
})
```

- [ ] **Step 3: Run the isolated drawer test and verify the component is missing**

Run from `web`:

```powershell
npx playwright test e2e/specs/58-employee-reentry-drawer.spec.ts --project=chromium
```

Expected: FAIL because the reentry drawer and its actions do not exist.

- [ ] **Step 4: Build the drawer with three compact sections**

Required visible structure:

```vue
<el-drawer v-model="visible" title="办理再入职" size="min(720px, 100vw)" class="employee-reentry-drawer">
  <div class="drawer-scroll-body">
    <section aria-labelledby="reentry-history-title">
      <h3 id="reentry-history-title">历史身份</h3>
      <el-descriptions :column="2" size="small">
        <el-descriptions-item label="姓名">{{ employee.name }}</el-descriptions-item>
        <el-descriptions-item label="历史工号">{{ employee.employeeNo || '未设置' }}</el-descriptions-item>
        <el-descriptions-item label="最近部门">{{ employee.dept?.name || '未设置' }}</el-descriptions-item>
        <el-descriptions-item label="最近岗位">{{ employee.position || '未设置' }}</el-descriptions-item>
        <el-descriptions-item label="离职日期">{{ employee.leaveDate || '未记录' }}</el-descriptions-item>
      </el-descriptions>
    </section>
    <section aria-labelledby="reentry-fields-title">
      <h3 id="reentry-fields-title">本次入职</h3>
      <el-form :model="form" label-position="top">
        <el-form-item label="工号"><el-input v-model="form.employeeNo" /></el-form-item>
        <el-form-item label="公司">
          <el-select v-model="form.company">
            <el-option v-for="option in companyOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="部门">
          <el-tree-select v-model="form.deptId" :data="departmentTree" node-key="id" check-strictly clearable />
        </el-form-item>
        <el-form-item label="岗位">
          <el-select v-model="form.positionId" clearable>
            <el-option v-for="option in positionOptions" :key="option.id" :label="option.name" :value="option.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="直属主管">
          <UserSelect
            v-model="form.directManagerId"
            eligible-for="direct_manager"
            :disabled-ids="[employee.id]"
            clearable
          />
        </el-form-item>
        <el-form-item label="计划入职日"><el-date-picker v-model="form.effectiveDate" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="历史补录结束日"><el-date-picker v-model="form.effectiveTo" value-format="YYYY-MM-DD" clearable /></el-form-item>
        <el-form-item label="入职后状态">
          <el-radio-group v-model="form.employeeStatus">
            <el-radio value="active">在职</el-radio>
            <el-radio value="probation">试用期</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="用工类型">
          <el-select v-model="form.employmentType">
            <el-option label="全职" value="full_time" />
            <el-option label="兼职" value="part_time" />
            <el-option label="返聘" value="rehire" />
            <el-option label="外部" value="external" />
          </el-select>
        </el-form-item>
        <el-form-item label="试用期（月）"><el-input-number v-model="form.probationMonths" :min="0" :max="60" /></el-form-item>
        <el-form-item label="计划转正日"><el-date-picker v-model="form.plannedRegularDate" value-format="YYYY-MM-DD" /></el-form-item>
      </el-form>
    </section>
    <section aria-labelledby="reentry-links-title">
      <h3 id="reentry-links-title">关联信息</h3>
      <el-form-item label="合同附件引用">
        <el-input v-model="contractReferenceText" placeholder="可选，可在提交后补充" />
      </el-form-item>
      <el-descriptions :column="1" size="small">
        <el-descriptions-item label="钉钉登录">{{ dingtalkBindingLabel }}</el-descriptions-item>
        <el-descriptions-item label="来源">{{ sourceLabel }}</el-descriptions-item>
      </el-descriptions>
    </section>
    <el-steps :active="approvalStep" finish-status="success" align-center>
      <el-step title="已创建" />
      <el-step title="HR 审核" />
      <el-step title="待入职" />
      <el-step title="已生效" />
    </el-steps>
  </div>
  <template #footer>
    <div class="drawer-actions">
      <el-button @click="close">取消</el-button>
      <el-button
        v-if="canCancelPending"
        data-action="cancel-entry"
        @click="openCancelReason"
      >取消入职</el-button>
      <el-button
        type="primary"
        data-action="submit-review"
        :loading="submitting"
        @click="submitForReview"
      >提交审核</el-button>
    </div>
  </template>
</el-drawer>
```

Small internal presentation helpers may remain in the same component if each is under 80 lines; do not create a generic workflow engine. The drawer body scrolls independently and the footer stays fixed on PC and mobile.

Load `departmentTree` and `positionOptions` from the existing HRM department and position endpoints. Extend the `UserQuery.eligibleFor` union in `web/src/types/api.types.ts` and the matching prop union in `web/src/components/common/UserSelect.vue` to accept `'direct_manager'`; the existing `usersApi.findAll` then calls `/users?eligibleFor=direct_manager`, which Task 6 constrains to active/probation HRM employees without requiring an HR role. Import and reuse `UserSelect` in the drawer, and pass the subject employee through `disabledIds` to prevent self-selection in the form. Do not use `cycle_owner` here because that is an HR-cycle-owner filter, and do not read DingTalk organization or manager data. Convert a non-empty `contractReferenceText` to `[{ kind: 'attachment', reference: contractReferenceText.trim() }]`; an empty value sends `[]` and only produces the field warning.

- [ ] **Step 5: Implement field-local warnings and question-mark explanations**

Map `validationWarnings` by `field` and render the warning directly below that form control:

```vue
<p
  v-if="warningByField.contractReferences"
  data-field-warning="contractReferences"
  class="field-warning"
>
  {{ warningByField.contractReferences }}
</p>
```

Use a small question-mark tooltip for explanatory copy. Tooltip content must use line breaks for: what the field means, when it takes effect, and whether it blocks submission. Do not repeat the same explanation as persistent paragraphs.

- [ ] **Step 6: Implement mode behavior**

- `create`: resigned/archived employee, editable form, submit through `createReentry`.
- `historical`: any existing employee, requires `effectiveTo` before today, labels the action “补录历史再入职”, and submits through `createReentry` without changing current account state.
- `view`: submitted request, read-only values and current flow node.
- `revise`: rejected or pending-entry request, editable key fields, submit through `reviseReentry`; user-facing button is “修改并重新审核”.
- `cancel`: pending-entry request, require a concise reason and call `cancelReentry`.
- `effective`: read-only history; no cancellation action.

The drawer never changes an employee to active locally; it waits for the API response and list refresh.

- [ ] **Step 7: Run drawer E2E, type-check and build checks**

Run from `web`:

```powershell
npx playwright test e2e/specs/58-employee-reentry-drawer.spec.ts --project=chromium
npm run type-check
npm run build
```

Expected: drawer E2E, type-check and build PASS.

- [ ] **Step 8: Commit the drawer and API client**

```powershell
git add web/src/types/enums.ts web/src/types/api.types.ts web/src/components/common/UserSelect.vue web/src/api/employee-archives.api.ts web/src/views/admin/components/EmployeeReentryDrawer.vue web/e2e/specs/58-employee-reentry-drawer.spec.ts
git diff --cached --check
git commit -m "feat(web): add employee reentry drawer"
```

---

### Task 8: Integrate pending-entry status and reentry actions into the employee list

**Files:**
- Modify: `web/src/views/admin/UserManageView.vue`
- Modify: `web/e2e/specs/54-personnel-resignation-archive.spec.ts`

**Interfaces:**
- Consumes: Task 7 `EmployeeReentryDrawer`, `UserStatus.pending_entry`, request client methods.
- Produces: employee-list tab order `全部｜在职｜试用期｜待入职｜已离职｜草稿｜已归档` and row actions appropriate to each lifecycle state.

- [ ] **Step 1: Write failing Playwright assertions for tabs and row actions**

Extend the existing synthetic fixtures and request router in `54-personnel-resignation-archive.spec.ts`:

```ts
const pendingEmployee = {
  ...activeEmployee,
  id: '10000000-0000-4000-8000-000000000004',
  name: '待入职员工',
  employeeNo: 'R-004',
  status: 'pending_entry',
  dingtalkBindingState: 'disabled',
}

// Add this branch to the existing **/api/v1/users** route handler.
if (url.searchParams.get('status') === 'pending_entry') items = [pendingEmployee]

// Add these assertions after the existing page.goto('/users').
const tabs = page.getByRole('tablist', { name: '员工状态' })
await expect(tabs.getByRole('tab')).toHaveText([
  '全部', '在职', '试用期', '待入职', '已离职', '草稿', '已归档',
])

await tabs.getByRole('tab', { name: '已离职' }).click()
await expect(page.getByRole('button', { name: '办理再入职' }).first()).toBeVisible()

await tabs.getByRole('tab', { name: '待入职' }).click()
await expect(page.getByRole('button', { name: '查看入职' }).first()).toBeVisible()
await expect(page.getByRole('button', { name: '修改并重新审核' }).first()).toBeVisible()
await expect(page.getByRole('button', { name: '取消入职' }).first()).toBeVisible()

await tabs.getByRole('tab', { name: '在职' }).click()
await page.getByRole('row', { name: /在职员工/ }).getByRole('button', { name: '查看档案' }).click()
await expect(page.getByRole('dialog', { name: '员工档案' }).getByRole('button', { name: '补录历史再入职' })).toBeVisible()
```

Add a regression assertion that the page contains exactly one employee table and no duplicate organization tree:

```ts
await expect(page.getByRole('tree', { name: '部门范围' })).toHaveCount(0);
await expect(page.locator('[data-testid="employee-list-table"]')).toHaveCount(1);
```

- [ ] **Step 2: Run the focused Playwright test and verify it fails**

Run from `web` with the repository's existing test server/config:

```powershell
npx playwright test e2e/specs/54-personnel-resignation-archive.spec.ts --project=chromium
```

Expected: FAIL because the pending-entry tab and actions are absent.

- [ ] **Step 3: Add the pending-entry tab in the confirmed order**

Use one lifecycle config array as the rendering and query source:

```ts
const lifecycleTabs = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '在职' },
  { key: 'probation', label: '试用期' },
  { key: 'pending_entry', label: '待入职' },
  { key: 'resigned', label: '已离职' },
  { key: 'draft', label: '草稿' },
  { key: 'archived', label: '已归档' },
] as const
```

Query mapping:

- `pending_entry` -> users API `status=pending_entry`, `archived=false`.
- `resigned` -> `status=resigned`, `archived=false`.
- `archived` -> `archived=true` without hiding resigned records.
- `all` -> employee records excluding drafts but including pending-entry/resigned/archived only according to the existing list contract; do not merge draft rows into users.

- [ ] **Step 4: Add lifecycle-specific operations and drawer wiring**

Rules:

```ts
const canStartReentry = (row: UserRow) =>
  row.status === 'resigned' || Boolean(row.archivedAt)

const isPendingEntry = (row: UserRow) =>
  row.status === 'pending_entry' && !row.archivedAt
```

- Resigned/archived: show `办理再入职`.
- Pending-entry: show `查看入职`, `修改并重新审核`, `取消入职`.
- Active/probation: retain existing row actions and never show “办理再入职” in the row. In the existing employee archive drawer's “任职记录” section, add a secondary `补录历史再入职` button that opens the reentry drawer in `historical` mode; this is the only active-employee entry point.
- After emitted `submitted/cancelled`, close the drawer, refresh only the active list query, and show a plain success message describing the actual state.

Use messages:

- New/revised request: `再入职申请已提交审核`.
- Future approval observed after refresh: `申请已审核，员工将在生效日转为在职`.
- Cancellation: `待入职申请已取消，员工档案已恢复原状态`.

- [ ] **Step 5: Keep filter/tabs/list layout compact and independently scrollable**

The page order must remain:

```text
标题与主要操作
查询面板
状态标签
员工列表
分页
```

Do not reintroduce a department tree. The list body scrolls inside the content panel; page title/actions, query panel, status tabs and pagination remain reachable at desktop heights and on mobile.

- [ ] **Step 6: Run Playwright, type-check and build**

Run from `web`:

```powershell
npx playwright test e2e/specs/54-personnel-resignation-archive.spec.ts --project=chromium
npm run type-check
npm run build
```

Expected: employee-list lifecycle test, type-check and production build PASS.

- [ ] **Step 7: Commit employee-list integration**

```powershell
git add web/src/views/admin/UserManageView.vue web/e2e/specs/54-personnel-resignation-archive.spec.ts
git diff --cached --check
git commit -m "feat(web): manage pending employee reentry"
```

---

### Task 9: Present reentry requests in the unified HR review table

**Files:**
- Modify: `web/src/views/admin/components/PersonnelPendingReviews.vue`
- Modify: `web/src/views/admin/PersonnelReviewView.vue`
- Modify: `web/e2e/specs/23-employee-data-review.spec.ts`

**Interfaces:**
- Consumes: existing review API plus `intakeType`, `onboardingStatus`, `proposedValue`, warnings and request versions from Tasks 1-4.
- Produces: the same selectable table structure for employee archive, organization, position and reentry changes; reentry rows support single/batch approve and return.

- [ ] **Step 1: Write failing Playwright assertions for the reentry review row**

Extend the existing `reviews` fixture in `23-employee-data-review.spec.ts` with this synthetic request:

```ts
reviews.push({
  id: '55555555-5555-4555-8555-555555555555',
  userId: 'employee-reentry-1',
  employeeNo: 'R-2026-001',
  employeeName: '王大',
  sourceType: 'manual_reentry',
  sourceSystem: 'manual',
  sourceReference: null,
  intakeType: 'reentry',
  onboardingStatus: 'submitted',
  requestVersion: 1,
  profileReviewStatus: 'pending',
  performanceReviewStatus: 'not_required',
  validationErrors: [],
  validationWarnings: [],
  baseValue: { employee: { status: 'resigned', employeeNo: 'OLD-001' } },
  proposedValue: {
    employeeNo: 'R-2026-001',
    company: 'fuede',
    deptId: 'dept-hr',
    departmentName: '人事行政部',
    position: '人事专员',
    directManagerId: 'manager-hr',
    directManagerName: '方圆',
    effectiveDate: '2026-10-01',
    employeeStatus: 'active',
    employmentType: 'full_time',
    contractReferences: [],
  },
  recordStatus: 'submitted',
  createdBy: { id: 'mock-admin-id', name: '测试·系统管理员', sysRole: 'system_admin' },
  createdAt: '2026-09-18T08:00:00.000Z',
  updatedAt: '2026-09-18T08:00:00.000Z',
})

// Add these assertions after the existing page.goto(`${webBaseUrl}/personnel-change-reviews`).
const row = page.getByRole('row', { name: /再入职 .* 王大/ })
await expect(row.getByRole('cell', { name: '再入职' })).toBeVisible()
await expect(row.getByRole('cell', { name: '王大' })).toBeVisible()
await expect(row.getByText(/工号.*R-2026-001/)).toBeVisible()
await expect(row.getByText(/部门.*人事行政部/)).toBeVisible()
await expect(row.getByText(/计划入职日.*2026-10-01/)).toBeVisible()
await expect(row.getByRole('button', { name: '退回' })).toBeVisible()
await expect(row.getByRole('button', { name: '通过' })).toBeVisible()

await row.getByRole('checkbox').check()
await expect(page.getByRole('button', { name: /批量通过/ })).toBeEnabled()
```

Add a post-approval assertion:

```ts
await row.getByRole('button', { name: '通过' }).click();
await expect(page.getByText('已通过 1 人')).toBeVisible();
expect(approveBody).toEqual({
  requestIds: ['55555555-5555-4555-8555-555555555555'],
  scopes: ['profile'],
});
```

- [ ] **Step 2: Run the focused review test and verify the reentry presentation fails**

Run from `web`:

```powershell
npx playwright test e2e/specs/23-employee-data-review.spec.ts --project=chromium
```

Expected: FAIL because reentry is not mapped to the unified table content.

- [ ] **Step 3: Extend the existing employee type and summary functions**

Keep the table structure unchanged. Add a reentry branch to the existing `employeeChangeType` and `employeeChangeSummary` functions in `PersonnelPendingReviews.vue`:

```ts
function employeeChangeType(row: EmployeeDataReview): string {
  if (row.intakeType === 'reentry') return '再入职'
  const profilePending = row.profileReviewStatus === 'pending'
  const performancePending = row.performanceReviewStatus === 'pending'
  if (profilePending && performancePending) return '档案及关系'
  if (performancePending) return '绩效关系'
  return '档案变更'
}

function employeeChangeSummary(row: EmployeeDataReview): string {
  if (row.intakeType === 'reentry') {
    const value = row.proposedValue as EmployeeReentryPayload & {
      departmentName?: string | null
      directManagerName?: string | null
    }
    return [
      `工号：${value.employeeNo}`,
      `部门：${value.departmentName || '未设置'}`,
      `岗位：${value.position || '未设置'}`,
      `直属主管：${value.directManagerName || '未设置'}`,
      `计划入职日：${String(value.effectiveDate).slice(0, 10)}`,
      `员工状态：${value.employeeStatus === 'probation' ? '试用期' : '在职'}`,
    ].join('；')
  }
  return existingEmployeeChangeSummary(row)
}
```

Before replacing the existing function, extract its current non-reentry body verbatim to a new local function named `existingEmployeeChangeSummary(row: EmployeeDataReview): string`; do not alter its field-diff behavior.

Render the same columns as other review sections:

```text
勾选｜序号｜变更类型｜审核对象｜变更内容｜提交人｜提交时间｜操作
```

The operation column contains real buttons `退回` and `通过`, never a passive “可审核” label.

- [ ] **Step 4: Put details and warnings in the existing review drawer**

The expanded/drawer view must show:

- historical identity summary;
- current proposal and changed fields;
- request version and prior revisions;
- contract/DingTalk warnings next to their fields;
- approval flow and current node.

Persistent table cells contain only the concise content list. Put explanatory text behind a question-mark tooltip with explicit line breaks. Do not add a second table style or a large descriptive header card.

- [ ] **Step 5: Preserve batch selection and self-review**

The existing selected-ID collection must accept reentry request IDs. Batch approval calls the same employee profile review endpoint and reports exact counts. The UI must not disable a row because `createdById === currentUser.id`; authorization is determined by the HR capability and backend self-review rule.

Add component assertions:

```ts
expect(canReview(reentryCreatedByCurrentHr)).toBe(true)
expect(batchPayload()).toEqual({
  requestIds: [reentryRequestId],
  scopes: ['profile'],
})
```

- [ ] **Step 6: Run review/list E2E, type-check and build**

Run from `web`:

```powershell
npx playwright test e2e/specs/23-employee-data-review.spec.ts e2e/specs/54-personnel-resignation-archive.spec.ts --project=chromium
npm run type-check
npm run build
```

Expected: review and employee-list E2E tests, type-check and build PASS.

- [ ] **Step 7: Commit the review UI**

```powershell
git add web/src/views/admin/components/PersonnelPendingReviews.vue web/src/views/admin/PersonnelReviewView.vue web/e2e/specs/23-employee-data-review.spec.ts
git diff --cached --check
git commit -m "feat(web): review employee reentry requests"
```

---

### Task 10: Verify end-to-end behavior and record release evidence

**Files:**
- Create: `docs/acceptance/2026-09-18-employee-reentry-onboarding.md`
- Modify only if verification exposes defects: files from Tasks 1-9 that directly cause the failed check.

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: fresh evidence separating code implemented, committed, pushed, deploy-ready, deployed and business-accepted states.

- [ ] **Step 1: Verify repository and migration state before broad tests**

From the repository root:

```powershell
git status --short --branch
git diff --check
git branch --no-merged main
git worktree list
```

Expected: no unrelated changes are staged or modified. Investigate registered worktrees/branches before merging anything; do not automatically merge old branches.

From `api`:

```powershell
npx prisma format
npx prisma validate
npx prisma generate
git diff --check
```

Expected: all commands PASS and `prisma format` produces no uncommitted schema change.

- [ ] **Step 2: Run the complete API test/build gate**

From `api`:

```powershell
npm test -- --runInBand
npm run test:e2e -- --runTestsByPath suites/14-employee-onboarding.e2e-spec.ts
npm run build
```

Expected: all API unit tests, onboarding E2E and build PASS. If an unrelated historical test fails, record its exact command, test name and error separately; do not report the feature as fully passing until the directly related suites are green.

- [ ] **Step 3: Run the complete Web gate and focused browser acceptance**

From `web`:

```powershell
npm run type-check
npm run build
npx playwright test e2e/specs/23-employee-data-review.spec.ts e2e/specs/54-personnel-resignation-archive.spec.ts e2e/specs/58-employee-reentry-drawer.spec.ts --project=chromium
```

Then run the mobile project already defined in the Playwright config for the same two specs. Expected:

- PC and mobile drawers scroll independently and keep actions reachable.
- One employee appears as one row before and after reentry.
- Future effective employee appears only in “待入职”.
- Self-submitted HR application can be approved.
- Pre-effective local/DingTalk login fails; due-date login compensation succeeds.
- Historical elevated permissions remain removed.

- [ ] **Step 4: Exercise the exact API lifecycle against an isolated test database**

Use fixture IDs only. Execute these actions through HTTP or the existing test helper, never by editing production rows:

```text
1. Select one resigned archived fixture employee.
2. Submit reentry with a future effective date and a new employee number.
3. Approve as the same HR administrator.
4. Confirm User.id is unchanged, status is pending_entry, archivedAt is cleared and login is rejected.
5. Revise a key field and confirm a new request version requires review.
6. Approve, then cancel before effective date; confirm original status/archive/employee number are restored and reservation is released.
7. Submit again with effective date today; approve and confirm immediate activation, standard permissions and unique DingTalk restoration.
8. Submit a finished historical interval for another fixture; confirm history grows without changing current login/status.
9. Submit the same recruitment source twice; confirm the same intake ID, then change content and confirm 409 conflict.
```

Record the fixture IDs only in local test output, not in committed screenshots or documents containing personal data.

- [ ] **Step 5: Perform a migration rehearsal on a disposable production-like database**

Before any production authorization:

```powershell
npx prisma migrate status
npx prisma migrate deploy
```

Run on a disposable database restored from a sanitized production schema/data sample. Verify:

```sql
SELECT COUNT(*) FROM "employee_number_assignments" WHERE "status" IN ('current', 'historical');
SELECT "employee_no", COUNT(DISTINCT "user_id")
FROM "employee_number_assignments"
WHERE "status" IN ('reserved', 'current', 'historical')
GROUP BY "employee_no"
HAVING COUNT(DISTINCT "user_id") > 1;
```

Expected: migration deploys once, re-running reports no pending migration, and the conflict query returns zero rows. If it returns rows, stop and prepare a data-specific remediation proposal for user approval; do not delete or reassign records automatically.

- [ ] **Step 6: Create the acceptance evidence document**

Create `docs/acceptance/2026-09-18-employee-reentry-onboarding.md` with this exact structure and replace each result with the observed command/output:

```markdown
# 员工再入职与招聘入职接收验收记录

## 状态
- 代码实现：已完成/未完成
- 已提交：提交哈希
- 已推送：本地 HEAD 与 origin/main 哈希
- 生产上线：未授权/已完成及时间
- 业务验收：未开始/通过/遗留项

## 数据与迁移
- Prisma 校验：命令与结果
- 迁移演练：数据库范围与结果
- 工号冲突检查：结果

## API 验收
- 自动化测试：命令、通过数、失败数
- 再入职复用 User.id：结果
- 待入职登录隔离：结果
- 生效补偿：结果
- 权限重置：结果
- 钉钉身份恢复/冲突：结果
- 招聘来源幂等：结果

## Web 与角色验收
- HR 发起与本人审核：结果
- 待入职查看/修订/取消：结果
- PC：结果
- 手机：结果

## 遗留风险
- 仅列出仍存在且有证据的风险；没有则写“无已知阻断项”。
```

- [ ] **Step 7: Commit only verification evidence and direct fixes**

```powershell
git add docs/acceptance/2026-09-18-employee-reentry-onboarding.md
git diff --cached --name-only
git diff --cached --check
git commit -m "test(personnel): verify employee reentry workflow"
```

If verification exposes a direct defect, return to the owning task, add only the exact changed implementation/test files listed by `git status --short`, rerun that task's focused gate, and commit the fix separately before creating this evidence commit. Never stage whole `api`/`web` directories, build output, local environment files, database dumps, screenshots with personal data, or unrelated changes.

- [ ] **Step 8: Prepare but do not execute production release without fresh authorization**

After all gates pass, push only when the implementation authorization includes repository integration:

```powershell
git push origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: hashes match. Report this as “已推送、待发布” unless the user has explicitly authorized production deployment in the current implementation turn.

When production deployment is authorized, follow `AGENTS.md` and the repository deployment runbook:

1. Reconfirm target `https://1260cw31az927.vicp.fun`, Compose project `kayford-deploy`, current live commit, database backup, migration and rollback image.
2. Keep `ENABLE_TEST_QUICK_LOGIN=false` for formal production.
3. Back up PostgreSQL before `prisma migrate deploy`.
4. Build and replace only API/Web services; do not rebuild PostgreSQL, Redis or MinIO.
5. Verify external health, migration state, static asset version and the real HR/employee paths above.
6. Compare deployed commit to intended `main` hash and record it in the acceptance document.

Do not call container startup alone a successful release; production is complete only after the live URL and role paths are verified.

---

## Final Completion Checklist

- [ ] Existing resigned/archived employee reuses the same `User.id` and remains one list row.
- [ ] New employee number is preserved on the new employment; prior official numbers remain occupied as history.
- [ ] Future-approved application shows `待入职`, cannot log in and is absent from current business scopes.
- [ ] Due-date activation is idempotent from scheduler and login compensation.
- [ ] Reentry resets system permissions to standard user and does not restore historical HR/admin authority.
- [ ] DingTalk identity is restored only when the binding belongs to the same employee, is non-ended and was disabled by resignation; DingTalk organization never writes HRM organization data.
- [ ] HR administrator can create and review their own request.
- [ ] Key-field revision increments the request version and requires a new review.
- [ ] Cancellation restores the pre-approval state and releases only a never-effective reservation.
- [ ] Completed historical backfill adds history without opening login or changing the current projection.
- [ ] Recruitment intake is idempotent, creates a draft only and never auto-matches by name/contact details.
- [ ] Employee list, reentry drawer and review table are compact, consistent and usable on PC/mobile.
- [ ] API tests, Web type-check/build, focused Playwright and migration rehearsal all have fresh recorded evidence.
- [ ] Commit, push, deployment and business acceptance are reported as separate states.
