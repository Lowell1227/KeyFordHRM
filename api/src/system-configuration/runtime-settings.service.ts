import {
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/prisma/prisma.service";
import {
  CONFIGURATION_PREFIX,
  ConfigurationValues,
  DEFINITIONS,
  definition,
  isMailConfiguration,
} from "./configuration-definitions";
import { decryptConfiguration } from "./configuration-crypto";

@Injectable()
export class RuntimeSettingsService implements OnModuleInit {
  private readonly applied = new Map<
    string,
    { revision: number; values: ConfigurationValues | null }
  >();
  constructor(
    private readonly prisma: PrismaService,
    private readonly deployment: ConfigService,
  ) {}
  async onModuleInit() {
    await this.reloadApplied();
  }
  async reloadApplied() {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: CONFIGURATION_PREFIX } },
    });
    const next = new Map<
      string,
      { revision: number; values: ConfigurationValues | null }
    >();
    const definitions = [
      ...DEFINITIONS,
      ...rows
        .filter((row) =>
          row.key.startsWith(CONFIGURATION_PREFIX + "recruitment-mail:"),
        )
        .map((row) => definition(row.key.slice(CONFIGURATION_PREFIX.length))),
    ];
    for (const def of definitions) {
      const row = rows.find(
        (item) => item.key === CONFIGURATION_PREFIX + def.id,
      );
      if (!row) continue;
      const stored = row.value as any;
      if (stored?.appliedRevision === 0 && stored.applied === null) continue;
      try {
        if (
          !Number.isSafeInteger(stored?.appliedRevision) ||
          stored.appliedRevision < 1
        )
          throw new Error();
        next.set(def.id, {
          revision: stored.appliedRevision,
          values: decryptConfiguration(this.deployment, def.id, stored.applied),
        });
      } catch {
        next.set(def.id, { revision: Number.MAX_SAFE_INTEGER, values: null });
      }
    }
    this.applied.clear();
    next.forEach((value, key) => this.applied.set(key, value));
  }
  install(id: string, revision: number, values: ConfigurationValues) {
    // A slower post-commit callback must never replace a later applied revision.
    const old = this.applied.get(id);
    if (old?.values && old.revision > revision) return;
    this.applied.set(id, { revision, values: Object.freeze({ ...values }) });
  }
  hasApplied(id: string) {
    return this.applied.has(definition(id).id);
  }
  mailboxConfigurations(): Array<{
    id: string;
    values: ConfigurationValues | null;
  }> {
    return [...this.applied.entries()]
      .filter(([id]) => isMailConfiguration(id))
      .map(([id, stored]) => ({ id, values: stored.values }));
  }
  get<T = any>(key: string, fallback?: T): T {
    if (
      this.deployment.get("HRM_PREVIEW") === "true" &&
      [
        "DINGTALK_NOTIFICATION_ENABLED",
        "DINGTALK_INTERVIEW_CALENDAR_ENABLED",
        "DINGTALK_ATTENDANCE_SYNC_ENABLED",
        "RECRUITMENT_MAIL_ENABLED",
      ].includes(key)
    )
      return "false" as T;
    const def = DEFINITIONS.find((item) =>
      item.fields.some((field) => field.key === key),
    );
    const snapshot = def && this.applied.get(def.id);
    if (snapshot) {
      if (!snapshot.values)
        throw new ServiceUnavailableException(
          "配置不可读取，请管理员检查生效配置",
        );
      const value = snapshot.values[key];
      // An applied group owns all its keys; missing entries never borrow deployment credentials.
      return (
        typeof value === "boolean" ? String(value) : (value ?? fallback)
      ) as T;
    }
    return this.deployment.get<T>(key, fallback as T) as T;
  }
}
