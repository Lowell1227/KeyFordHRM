import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { isISO8601 } from "class-validator";
import { PrismaService } from "@/prisma/prisma.service";
import { AiConfigService } from "@/ai-progress/ai-config.service";
import { DingtalkService } from "@/dingtalk/dingtalk.service";
import { DingtalkRecruitmentService } from "@/dingtalk/dingtalk-recruitment.service";
import { AlimailRecruitmentAdapter } from "@/talent-pool/recruitment-alimail-adapter";
import { readRecruitmentMailSettings } from "@/talent-pool/recruitment-mail-settings";
import { RecruitmentMailProvider } from "@/talent-pool/recruitment-mail-providers";
import {
  CONFIGURATION_PREFIX,
  ConfigurationDefinition,
  ConfigurationValues,
  DEFINITIONS,
  definition,
  FieldDefinition,
  isMailConfiguration,
} from "./configuration-definitions";
import {
  configurationMasterKey,
  decryptConfiguration,
  encryptConfiguration,
} from "./configuration-crypto";
import { RuntimeSettingsService } from "./runtime-settings.service";

type Verification = "unknown" | "untested" | "passed" | "failed";
type TestKind = "connection" | "scope" | "configuration" | "none";
type StoredConfiguration = {
  revision: number;
  draft: string;
  appliedRevision: number;
  applied: string | null;
  verification: Verification;
  verifiedAt: string | null;
  verificationMessage: string;
  testKind: TestKind;
  dependency: string | null;
};
export type SystemConfigurationView = {
  id: string;
  title: string;
  description: string;
  revision: number;
  appliedRevision: number;
  source: "deployment" | "database" | "none";
  encryptionReady: boolean;
  fields: Array<
    FieldDefinition & { value?: string | boolean; configured: boolean }
  >;
  verification: Verification;
  verifiedAt: string | null;
  verificationMessage: string;
  testKind: TestKind;
  requiresSample: boolean;
};
export type SaveConfiguration = {
  expectedRevision: number;
  values: Record<string, unknown>;
};
export type VerifyConfiguration = {
  expectedRevision: number;
  sampleInstanceId?: string;
};

@Injectable()
export class SystemConfigurationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly runtime: RuntimeSettingsService,
    private readonly ai: AiConfigService,
  ) {}

  async get(id: string, actorId: string): Promise<SystemConfigurationView> {
    const def = definition(id);
    return this.safe(async () => {
      await this.assertAdmin(this.prisma, actorId);
      const row = await this.prisma.systemConfig.findUnique({
        where: { key: CONFIGURATION_PREFIX + def.id },
      });
      return this.view(id, def, row ? this.stored(row.value) : null);
    });
  }

  async mailboxes(actorId: string): Promise<SystemConfigurationView[]> {
    return this.safe(async () => {
      await this.assertAdmin(this.prisma, actorId);
      const rows = await this.prisma.systemConfig.findMany({
        where: {
          key: { startsWith: CONFIGURATION_PREFIX + "recruitment-mail" },
        },
      });
      const views = rows.map((row) => {
        const id = row.key.slice(CONFIGURATION_PREFIX.length),
          def = definition(id);
        try {
          return this.view(id, def, this.stored(row.value));
        } catch {
          return this.unreadableView(id, def, row.value);
        }
      });
      if (!views.some((view) => view.id === "recruitment-mail")) {
        try {
          views.unshift(
            this.view("recruitment-mail", definition("recruitment-mail"), null),
          );
        } catch {
          views.unshift(
            this.unreadableView(
              "recruitment-mail",
              definition("recruitment-mail"),
              null,
            ),
          );
        }
      }
      return views;
    });
  }
  async createMailbox(actorId: string): Promise<SystemConfigurationView> {
    return this.save(
      `recruitment-mail:${randomUUID()}`,
      { expectedRevision: 0, values: { RECRUITMENT_MAIL_ENABLED: false } },
      actorId,
    );
  }

  async status(actorId: string) {
    await this.assertAdmin(this.prisma, actorId);
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: CONFIGURATION_PREFIX } },
    });
    return DEFINITIONS.map((def) => {
      const row = rows.find(
        (item) => item.key === CONFIGURATION_PREFIX + def.id,
      );
      try {
        return this.view(def.id, def, row ? this.stored(row.value) : null);
      } catch {
        return {
          id: def.id,
          revision: null,
          appliedRevision: null,
          verification: "unknown",
          verifiedAt: null,
          verificationMessage: "配置不可读取，请检查加密主密钥",
          testKind: "none",
          fields: [],
        };
      }
    });
  }

  async save(
    id: string,
    dto: SaveConfiguration,
    actorId: string,
  ): Promise<SystemConfigurationView> {
    const def = definition(id);
    this.revision(dto?.expectedRevision);
    if (
      !dto ||
      Object.keys(dto).some(
        (key) => !["expectedRevision", "values"].includes(key),
      ) ||
      !dto.values ||
      typeof dto.values !== "object" ||
      Array.isArray(dto.values)
    )
      throw new BadRequestException("配置格式不正确");
    const changes = this.validateValues(def, dto.values);
    await this.mutate(actorId, async (tx) => {
      const old = await this.read(tx, def, dto.expectedRevision);
      const values = old
        ? decryptConfiguration(this.config, def.id, old.draft)
        : this.deploymentValues(def);
      if (isMailConfiguration(def.id) && !values.RECRUITMENT_MAIL_PROVIDER)
        values.RECRUITMENT_MAIL_PROVIDER = "alimail";
      for (const [key, value] of Object.entries(changes)) {
        if (
          def.fields.find((field) => field.key === key)?.type === "secret" &&
          value === ""
        )
          continue;
        values[key] = value;
      }
      const next: StoredConfiguration = {
        revision: (old?.revision ?? 0) + 1,
        draft: encryptConfiguration(this.config, def.id, values),
        appliedRevision: old?.appliedRevision ?? 0,
        applied: old?.applied ?? null,
        verification: "untested",
        verifiedAt: null,
        verificationMessage: "当前草稿尚未核验",
        testKind: "none",
        dependency: null,
      };
      await this.write(
        tx,
        def,
        next,
        actorId,
        "configuration_saved",
        Object.keys(changes),
      );
    });
    return this.get(id, actorId);
  }

  async test(
    id: string,
    dto: VerifyConfiguration,
    actorId: string,
  ): Promise<SystemConfigurationView> {
    const def = definition(id);
    this.testDto(dto, true);
    const initial = await this.mutate(actorId, async (tx) => {
      const stored = await this.read(tx, def, dto.expectedRevision);
      if (!stored) throw new BadRequestException("请先保存配置草稿");
      const shared = def.dependency ? await this.sharedInDb(tx) : null;
      return { stored, shared, dependency: this.sharedFingerprint(shared) };
    });
    const values = decryptConfiguration(
      this.config,
      def.id,
      initial.stored.draft,
    );
    const dependency = initial.dependency;
    let kind: TestKind = "configuration",
      passed = false,
      message = "配置核对未通过，请检查必填项及依赖配置";
    try {
      this.required(def, values);
      const snapshot = this.snapshot({ ...(initial.shared ?? {}), ...values });
      const enabled = !def.enabledKey || values[def.enabledKey] === true;
      if (isMailConfiguration(def.id) && enabled) {
        kind = "connection";
        if (this.config.get("HRM_PREVIEW") === "true")
          throw new BadRequestException(
            "隔离预览禁止连接真实邮箱；请在正式配置窗口核验指定文件夹",
          );
        await new AlimailRecruitmentAdapter(this.mailValues(values)).probe();
        message = "已只读连接指定文件夹；未读取邮件正文或附件，未同步资料";
      } else if (def.id === "dingtalk-app") {
        kind = "connection";
        await new DingtalkService(snapshot).getAccessToken(
          AbortSignal.timeout(12_000),
        );
        message = "应用凭据连接成功；消息、日程、考勤和审批读取权限尚未验收";
      } else if (def.id === "recruitment-demand") {
        kind = "scope";
        if (!dto.sampleInstanceId)
          throw new BadRequestException("请填写已获准只读核验的审批样本 ID");
        const adapter = new DingtalkRecruitmentService(
          new DingtalkService(snapshot),
          snapshot,
        );
        if (!adapter.status().configured)
          throw new BadRequestException("招聘审批配置不完整或字段无效");
        await adapter.readInstance(dto.sampleInstanceId);
        message =
          "指定审批样本只读核验成功；未导入需求，范围及更正关系仍按原业务门槛核验";
      } else if (def.id === "ai-resume" && enabled) {
        if (!(await this.ai.getProviderRuntimeConfig("deepseek")))
          throw new BadRequestException(
            "请先在 AI 服务配置中保存并核验 DeepSeek",
          );
        message = "解析开关及已核验 DeepSeek 凭据已核对；未调用模型解析简历";
      } else {
        if (def.dependency && enabled)
          this.requireShared(def.id === "dingtalk-notifications", snapshot);
        message = enabled
          ? "配置及依赖已核对；未调用真实业务接口，业务权限仍需单独验收"
          : "关闭状态已核对；未调用第三方服务";
      }
      passed = true;
    } catch (error) {
      // Only our local validation text is public; never persist upstream errors or responses.
      if (error instanceof BadRequestException) message = error.message;
      else
        message =
          kind === "connection"
            ? "连接核验未通过，请检查凭据、平台权限及网络配置"
            : "只读核验未通过，请检查样本、字段、平台权限及读取范围";
    }
    await this.mutate(actorId, async (tx) => {
      const current = await this.read(tx, def, dto.expectedRevision);
      if (
        !current ||
        current.draft !== initial.stored.draft ||
        (await this.dependencyInDb(tx, def)) !== dependency
      )
        throw new ConflictException("配置或共享应用已变更，请刷新后重新核验");
      await this.write(
        tx,
        def,
        {
          ...current,
          verification: passed ? "passed" : "failed",
          verifiedAt: new Date().toISOString(),
          verificationMessage: message,
          testKind: kind,
          dependency,
        },
        actorId,
        "configuration_tested",
        [],
      );
    });
    return this.get(id, actorId);
  }

  async apply(
    id: string,
    dto: VerifyConfiguration,
    actorId: string,
  ): Promise<SystemConfigurationView> {
    const def = definition(id);
    this.testDto(dto, false);
    const result = await this.mutate(actorId, async (tx) => {
      const stored = await this.read(tx, def, dto.expectedRevision);
      if (
        !stored ||
        stored.verification !== "passed" ||
        stored.dependency !== (await this.dependencyInDb(tx, def))
      )
        throw new BadRequestException(
          "请先核验当前草稿；共享应用变更后需要重新核验",
        );
      const values = decryptConfiguration(this.config, def.id, stored.draft);
      this.required(def, values);
      if (
        def.id === "ai-resume" &&
        values.AI_RESUME_PARSING_ENABLED === true &&
        !(await this.ai.getProviderRuntimeConfig("deepseek"))
      )
        throw new BadRequestException(
          "DeepSeek 当前凭据已变化，请先重新核验 AI 服务配置",
        );
      await this.write(
        tx,
        def,
        { ...stored, applied: stored.draft, appliedRevision: stored.revision },
        actorId,
        "configuration_applied",
        def.fields.map((field) => field.key),
      );
      return { revision: stored.revision, values };
    });
    this.runtime.install(def.id, result.revision, result.values);
    return this.get(id, actorId);
  }

  publicLogin() {
    if (this.config.get("HRM_PREVIEW") === "true")
      return {
        enabled: false,
        corpId: "",
        appKey: "",
        agentId: "",
        redirectUri: "",
      };
    try {
      const read = (key: string) =>
        this.runtime.get<string>(key, "")?.trim() ?? "";
      const corpId = read("DINGTALK_CORP_ID"),
        appKey = read("DINGTALK_APP_KEY"),
        agentId = read("DINGTALK_AGENT_ID"),
        redirectUri = read("DINGTALK_REDIRECT_URI");
      return {
        enabled: !!(corpId && appKey && read("DINGTALK_APP_SECRET")),
        corpId,
        appKey,
        agentId,
        redirectUri,
      };
    } catch {
      return {
        enabled: false,
        corpId: "",
        appKey: "",
        agentId: "",
        redirectUri: "",
      };
    }
  }

  private view(
    id: string,
    def: ConfigurationDefinition,
    stored: StoredConfiguration | null,
  ): SystemConfigurationView {
    const values = stored
      ? decryptConfiguration(this.config, def.id, stored.draft)
      : this.deploymentValues(def);
    if (isMailConfiguration(def.id) && !values.RECRUITMENT_MAIL_PROVIDER)
      values.RECRUITMENT_MAIL_PROVIDER = "alimail";
    let current = false,
      dependencyAvailable = true;
    try {
      current =
        !!stored &&
        (stored.verification === "untested" ||
          stored.dependency === this.dependency(def));
    } catch {
      dependencyAvailable = false;
    }
    return {
      id,
      title: def.title,
      description: def.description,
      revision: stored?.revision ?? 0,
      appliedRevision: stored?.appliedRevision ?? 0,
      source: stored
        ? "database"
        : Object.entries(values).some(
              ([key, value]) =>
                key !== "RECRUITMENT_MAIL_PROVIDER" &&
                value !== "" &&
                value !== false,
            )
          ? "deployment"
          : "none",
      encryptionReady: !!configurationMasterKey(this.config),
      fields: def.fields.map((field) => ({
        ...field,
        ...(field.type === "secret"
          ? {}
          : {
              value:
                values[field.key] ?? (field.type === "boolean" ? false : ""),
            }),
        configured:
          field.type === "boolean"
            ? typeof values[field.key] === "boolean"
            : typeof values[field.key] === "string" &&
              !!(values[field.key] as string).trim(),
      })),
      verification: stored
        ? current
          ? stored.verification
          : "untested"
        : "unknown",
      verifiedAt: stored?.verifiedAt ?? null,
      verificationMessage: !dependencyAvailable
        ? "共享钉钉应用配置不可读取；可保存草稿，修复共享应用后再核验"
        : stored
          ? current
            ? stored.verificationMessage
            : "共享应用配置已变化，请重新核验"
          : "部署配置尚未通过此页面核验",
      testKind:
        stored?.testKind && stored.testKind !== "none"
          ? stored.testKind
          : this.plannedKind(def, values),
      requiresSample: def.id === "recruitment-demand",
    };
  }
  private unreadableView(
    id: string,
    def: ConfigurationDefinition,
    value: unknown,
  ): SystemConfigurationView {
    const stored = value as StoredConfiguration;
    return {
      id,
      title: def.title,
      description: def.description,
      revision: Number.isSafeInteger(stored?.revision) ? stored.revision : 0,
      appliedRevision: Number.isSafeInteger(stored?.appliedRevision)
        ? stored.appliedRevision
        : 0,
      source: "database",
      encryptionReady: !!configurationMasterKey(this.config),
      fields: [],
      verification: "unknown",
      verifiedAt: null,
      verificationMessage:
        "此邮箱配置不可读取，请检查加密主密钥；其他邮箱不受影响",
      testKind: "none",
      requiresSample: false,
    };
  }
  private plannedKind(
    def: ConfigurationDefinition,
    values: ConfigurationValues,
  ): TestKind {
    if (def.id === "recruitment-demand") return "scope";
    if (
      def.id === "dingtalk-app" ||
      (isMailConfiguration(def.id) && values.RECRUITMENT_MAIL_ENABLED === true)
    )
      return "connection";
    return "configuration";
  }
  private deploymentValues(def: ConfigurationDefinition): ConfigurationValues {
    const values: ConfigurationValues = Object.fromEntries(
      def.fields.map((field) => {
        const value = this.config.get<unknown>(field.key);
        return [
          field.key,
          field.type === "boolean"
            ? value === true || value === "true"
            : typeof value === "string"
              ? value
              : "",
        ];
      }),
    );
    if (isMailConfiguration(def.id))
      values.RECRUITMENT_MAIL_PROVIDER = "alimail";
    if (def.id.startsWith("recruitment-mail:"))
      return {
        ...Object.fromEntries(
          def.fields.map((field) => [
            field.key,
            field.type === "boolean" ? false : "",
          ]),
        ),
        RECRUITMENT_MAIL_PROVIDER: "alimail",
      };
    if (
      def.id === "recruitment-mail" &&
      this.config.get("RECRUITMENT_MAIL_CONFIG_FILE")
    ) {
      const settings = readRecruitmentMailSettings({
        get: ((key: string) =>
          key === "RECRUITMENT_MAIL_ENABLED"
            ? "true"
            : this.config.get(key)) as ConfigService["get"],
      });
      if (settings)
        Object.assign(values, {
          RECRUITMENT_MAIL_ACCOUNT: settings.account,
          RECRUITMENT_MAIL_PASSWORD: settings.password,
          RECRUITMENT_MAIL_FOLDER: settings.folder,
          RECRUITMENT_MAIL_AUTHORIZED_FROM: settings.authorizedFrom,
        });
      if (settings)
        values.__legacyMailboxScope = createHash("sha256")
          .update(
            JSON.stringify([
              settings.account,
              settings.folder,
              new Date(settings.authorizedFrom).toISOString(),
            ]),
          )
          .digest("hex");
    }
    return values;
  }
  private validateValues(
    def: ConfigurationDefinition,
    input: Record<string, unknown>,
  ): ConfigurationValues {
    const values: ConfigurationValues = {};
    for (const [key, value] of Object.entries(input)) {
      const field = def.fields.find((item) => item.key === key);
      if (!field) throw new BadRequestException("包含不支持的配置字段");
      if (field.type === "boolean") {
        if (typeof value !== "boolean")
          this.fieldError(key, "请选择开启或关闭");
        values[key] = value as boolean;
      } else {
        if (
          typeof value !== "string" ||
          value.length > (field.type === "textarea" ? 4000 : 1000) ||
          (field.type === "textarea"
            ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/
            : /[\u0000-\u001f\u007f-\u009f]/
          ).test(value)
        )
          this.fieldError(key, "字段格式不正确或内容过长");
        const text = value as string;
        if (
          field.type === "select" &&
          !field.options?.some((option) => option.value === text)
        )
          this.fieldError(key, "请选择支持的邮箱服务商");
        if (
          field.type === "datetime" &&
          text &&
          (!isISO8601(text, { strict: true, strictSeparator: true }) ||
            !text.endsWith("Z") ||
            !Number.isFinite(Date.parse(text)))
        )
          this.fieldError(key, "请选择有效的读取起始时间");
        if (key === "DINGTALK_REDIRECT_URI" && text) {
          try {
            const url = new URL(text);
            if (
              !["https:", "http:"].includes(url.protocol) ||
              url.username ||
              url.password ||
              (url.protocol === "http:" &&
                !["localhost", "127.0.0.1"].includes(url.hostname))
            )
              throw new Error();
          } catch {
            this.fieldError(key, "请填写 HTTPS 回调地址，或本机预览地址");
          }
        }
        values[key] = field.type === "secret" ? text : text.trim();
      }
    }
    return values;
  }
  private required(def: ConfigurationDefinition, values: ConfigurationValues) {
    if (def.enabledKey && values[def.enabledKey] !== true) return;
    for (const field of def.fields)
      if (field.required && !values[field.key])
        this.fieldError(field.key, `请填写${field.label}`);
    if (isMailConfiguration(def.id))
      new AlimailRecruitmentAdapter(this.mailValues(values));
  }
  private mailValues(values: ConfigurationValues) {
    return {
      provider: (values.RECRUITMENT_MAIL_PROVIDER ||
        "alimail") as RecruitmentMailProvider,
      account: values.RECRUITMENT_MAIL_ACCOUNT as string,
      password: values.RECRUITMENT_MAIL_PASSWORD as string,
      folder: values.RECRUITMENT_MAIL_FOLDER as string,
      authorizedFrom: values.RECRUITMENT_MAIL_AUTHORIZED_FROM as string,
    };
  }
  private fieldError(key: string, message: string): never {
    throw new BadRequestException({
      message,
      data: { fieldErrors: { [key]: message } },
    });
  }
  private snapshot(values: ConfigurationValues): ConfigService {
    return {
      get: (key: string, fallback?: unknown) =>
        key in values
          ? typeof values[key] === "boolean"
            ? String(values[key])
            : values[key]
          : this.runtime.get(key, fallback),
    } as ConfigService;
  }
  private dependency(def: ConfigurationDefinition) {
    if (!def.dependency) return null;
    return createHash("sha256")
      .update(
        JSON.stringify(
          definition("dingtalk-app").fields.map((field) =>
            this.runtime.get(field.key, ""),
          ),
        ),
      )
      .digest("hex");
  }
  private async sharedInDb(
    tx: Prisma.TransactionClient,
  ): Promise<ConfigurationValues> {
    const def = definition("dingtalk-app");
    const row = await tx.systemConfig.findUnique({
      where: { key: CONFIGURATION_PREFIX + def.id },
    });
    if (!row) return this.deploymentValues(def);
    const stored = this.stored(row.value);
    return stored.appliedRevision > 0
      ? decryptConfiguration(this.config, def.id, stored.applied)
      : this.deploymentValues(def);
  }
  private sharedFingerprint(shared: ConfigurationValues | null) {
    return shared
      ? createHash("sha256")
          .update(
            JSON.stringify(
              definition("dingtalk-app").fields.map(
                (field) => shared[field.key] ?? "",
              ),
            ),
          )
          .digest("hex")
      : null;
  }
  private async dependencyInDb(
    tx: Prisma.TransactionClient,
    def: ConfigurationDefinition,
  ) {
    return def.dependency
      ? this.sharedFingerprint(await this.sharedInDb(tx))
      : null;
  }
  private requireShared(agent: boolean, snapshot: ConfigService) {
    for (const key of [
      "DINGTALK_CORP_ID",
      "DINGTALK_APP_KEY",
      "DINGTALK_APP_SECRET",
      ...(agent ? ["DINGTALK_AGENT_ID"] : []),
    ])
      if (!snapshot.get(key))
        throw new BadRequestException("请先完成并应用共享钉钉企业应用配置");
  }
  private revision(value: unknown) {
    if (!Number.isSafeInteger(value) || (value as number) < 0)
      throw new BadRequestException("配置版本格式不正确");
  }
  private testDto(dto: VerifyConfiguration, sample: boolean) {
    this.revision(dto?.expectedRevision);
    if (
      !dto ||
      Object.keys(dto).some(
        (key) =>
          ![
            "expectedRevision",
            ...(sample ? ["sampleInstanceId"] : []),
          ].includes(key),
      ) ||
      (dto.sampleInstanceId !== undefined &&
        (typeof dto.sampleInstanceId !== "string" ||
          !/^[A-Za-z0-9_-]{1,200}$/.test(dto.sampleInstanceId)))
    )
      throw new BadRequestException("核验参数不正确");
  }
  private stored(value: unknown): StoredConfiguration {
    const item = value as StoredConfiguration;
    if (
      !item ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 1 ||
      !Number.isSafeInteger(item.appliedRevision) ||
      item.appliedRevision < 0 ||
      item.appliedRevision > item.revision ||
      typeof item.draft !== "string" ||
      !["untested", "passed", "failed"].includes(item.verification)
    )
      throw new ServiceUnavailableException(
        "配置不可读取，请管理员核对已保存配置",
      );
    return item;
  }
  private async read(
    tx: Pick<PrismaService, "systemConfig"> | Prisma.TransactionClient,
    def: ConfigurationDefinition,
    revision: number,
  ) {
    const row = await tx.systemConfig.findUnique({
      where: { key: CONFIGURATION_PREFIX + def.id },
    });
    const stored = row ? this.stored(row.value) : null;
    if ((stored?.revision ?? 0) !== revision)
      throw new ConflictException(
        "配置已被其他操作修改，请刷新并核对后重新提交",
      );
    return stored;
  }
  private async assertAdmin(
    tx: Pick<PrismaService, "user"> | Prisma.TransactionClient,
    actorId: string,
  ) {
    if (typeof actorId !== "string" || !actorId)
      throw new ForbiddenException("当前账号无权限维护系统配置");
    const actor = await tx.user.findFirst({
      where: { id: actorId },
      select: {
        sysRole: true,
        status: true,
        deletedAt: true,
        archivedAt: true,
        isAssessorOnly: true,
      },
    });
    if (
      !actor ||
      actor.sysRole !== "system_admin" ||
      !["active", "probation"].includes(actor.status) ||
      actor.deletedAt ||
      actor.archivedAt ||
      actor.isAssessorOnly
    )
      throw new ForbiddenException("当前账号无权限维护系统配置");
  }
  private mutate<T>(
    actorId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.safe(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(126012, 19)`;
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId}::uuid FOR SHARE`;
        await this.assertAdmin(tx, actorId);
        return work(tx);
      }),
    );
  }
  private async write(
    tx: Prisma.TransactionClient,
    def: ConfigurationDefinition,
    stored: StoredConfiguration,
    actorId: string,
    action: string,
    fields: string[],
  ) {
    const value = stored as unknown as Prisma.InputJsonValue,
      key = CONFIGURATION_PREFIX + def.id;
    await tx.systemConfig.upsert({
      where: { key },
      create: { key, value, updatedBy: actorId },
      update: { value, updatedBy: actorId, updatedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action,
        entityType: "system_configuration",
        newValue: {
          id: def.id,
          fields,
          revision: stored.revision,
          appliedRevision: stored.appliedRevision,
        },
      },
    });
  }
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("系统配置暂时不可用，请稍后重试");
    }
  }
}
