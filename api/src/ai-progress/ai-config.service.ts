import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProviderCredential, Prisma } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '@/prisma/prisma.service';
import {
  AI_PROVIDERS,
  AiProvider,
  SaveAiProviderDto,
  SetAiAllowlistDto,
} from './dto/ai-config.dto';
import { ProviderClient, ProviderClientError } from './provider-client';
import { ProviderRuntimeConfig, RecognitionInput } from './recognition.types';

const ACTIVE = 'ai_progress_active_provider';
const ENABLED = 'ai_progress_bot_enabled';
const ALLOWLIST = 'ai_progress_allowlist';
const SAMPLE: RecognitionInput = {
  message: '连接测试：样例目标已完成2项。',
  goals: [
    {
      id: 'synthetic-goal',
      title: '样例目标',
      targetValue: '10',
      unit: '项',
      periodId: null,
      periodKey: null,
    },
  ],
};

@Injectable()
export class AiConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly client: ProviderClient,
  ) {}

  async getPublicState() {
    const [rows, activeSetting, enabled, allowlist] = await Promise.all([
      this.prisma.aiProviderCredential.findMany(),
      this.prisma.systemConfig.findUnique({ where: { key: ACTIVE } }),
      this.prisma.systemConfig.findUnique({ where: { key: ENABLED } }),
      this.prisma.systemConfig.findUnique({ where: { key: ALLOWLIST } }),
    ]).catch((error) => this.persistenceError(error));
    const activeRow = rows.find((row) => row.provider === activeSetting?.value);
    const activeProvider = activeRow && this.usable(activeRow) ? activeRow.provider : null;
    return {
      encryptionReady: this.masterKey() !== null,
      activeProvider,
      botEnabled: enabled?.value === true && activeProvider !== null,
      allowlist: Array.isArray(allowlist?.value)
        ? allowlist.value.filter((id): id is string => typeof id === 'string')
        : [],
      providers: AI_PROVIDERS.map((provider) => {
        const row = rows.find((item) => item.provider === provider);
        return {
          provider,
          configured: Boolean(row),
          modelId: row?.modelId ?? null,
          region: row?.region ?? null,
          workspaceId: row?.workspaceId ?? null,
          configVersion: row?.configVersion ?? null,
          testedVersion: row?.testedVersion ?? null,
          testedAt: row?.testedAt ?? null,
          tested: Boolean(row && row.testedVersion === row.configVersion),
          active: activeProvider === provider,
        };
      }),
    };
  }

  async saveProvider(provider: AiProvider, dto: SaveAiProviderDto, operatorId: string) {
    this.assertProvider(provider);
    if (
      validateSync(plainToInstance(SaveAiProviderDto, dto), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).length ||
      (provider !== 'qwen' && (dto.region !== undefined || dto.workspaceId !== undefined)) ||
      (provider === 'qwen' &&
        ['eu-central-1', 'ap-northeast-1'].includes(dto.region ?? '') &&
        !dto.workspaceId)
    ) {
      throw new BadRequestException('服务商配置格式不正确');
    }
    if (!this.masterKey()) throw new BadRequestException('AI 凭据主密钥未配置或无效');
    await this.mutate(async (tx) => {
      const old = await tx.aiProviderCredential.findUnique({
        where: { provider },
      });
      if (!dto.apiKey && !old) throw new BadRequestException('请填写服务商 API Key');
      const encryptedKey = dto.apiKey ? this.encrypt(provider, dto.apiKey) : old!.encryptedKey;
      if (!dto.apiKey) this.decrypt(old!);
      const data = {
        encryptedKey,
        modelId: dto.modelId,
        region: dto.region ?? null,
        workspaceId: dto.workspaceId ?? null,
        testedVersion: null,
        testedAt: null,
      };
      const saved = await tx.aiProviderCredential.upsert({
        where: { provider },
        create: { provider, ...data, configVersion: 1 },
        update: { ...data, configVersion: { increment: 1 } },
      });
      await this.deactivateIfActive(tx, provider, operatorId);
      await this.audit(tx, operatorId, 'ai_provider_saved', {
        provider,
        configVersion: saved.configVersion,
        credentialReplaced: dto.apiKey !== undefined,
      });
    });
    return this.getPublicState();
  }

  async testProvider(provider: AiProvider, operatorId: string) {
    this.assertProvider(provider);
    const row = await this.prisma.aiProviderCredential
      .findUnique({ where: { provider } })
      .catch((error) => this.persistenceError(error));
    if (!row) throw new BadRequestException('请先保存服务商配置');
    let errorCode: string | null = null;
    try {
      await this.client.recognize(SAMPLE, this.runtime(row));
    } catch (error) {
      errorCode =
        error instanceof ProviderClientError
          ? error.code
          : error instanceof BadRequestException
            ? 'credential_unavailable'
            : 'provider_failed';
    }
    return this.mutate(async (tx) => {
      // The network call is outside the transaction; a changed version cannot inherit its result.
      const changed = await tx.aiProviderCredential.updateMany({
        where: { provider, configVersion: row.configVersion },
        data: {
          testedVersion: errorCode ? null : row.configVersion,
          testedAt: errorCode ? null : new Date(),
        },
      });
      if (!changed.count) errorCode = 'config_changed';
      if (changed.count && errorCode) await this.deactivateIfActive(tx, provider, operatorId);
      await this.audit(tx, operatorId, 'ai_provider_tested', {
        provider,
        configVersion: row.configVersion,
        success: !errorCode,
        errorCode,
      });
      return {
        success: !errorCode,
        errorCode,
        configVersion: row.configVersion,
      };
    });
  }

  async activate(provider: AiProvider, operatorId: string) {
    this.assertProvider(provider);
    await this.mutate(async (tx) => {
      const row = await tx.aiProviderCredential.findUnique({
        where: { provider },
      });
      if (!row || row.testedVersion !== row.configVersion)
        throw new BadRequestException('请先测试当前配置，测试成功后再启用');
      this.decrypt(row);
      await this.setting(tx, ACTIVE, provider, operatorId);
      await this.audit(tx, operatorId, 'ai_provider_activated', {
        provider,
        configVersion: row.configVersion,
      });
    });
    return this.getPublicState();
  }

  async setBotEnabled(enabled: boolean, operatorId: string) {
    if (typeof enabled !== 'boolean') throw new BadRequestException('机器人开关格式不正确');
    await this.mutate(async (tx) => {
      if (enabled && !(await this.activeRuntime(tx)))
        throw new BadRequestException('请先配置并测试启用有效的 AI 服务商');
      await this.setting(tx, ENABLED, enabled, operatorId);
      await this.audit(tx, operatorId, 'ai_progress_bot_updated', { enabled });
    });
    return this.getPublicState();
  }

  async setAllowlist(userIds: string[], operatorId: string) {
    if (validateSync(plainToInstance(SetAiAllowlistDto, { userIds })).length)
      throw new BadRequestException('试运行名单必须为有效且不重复的 HRM 用户 ID');
    await this.mutate(async (tx) => {
      const count = await tx.user.count({
        where: { id: { in: userIds }, deletedAt: null },
      });
      if (count !== userIds.length)
        throw new BadRequestException('试运行名单包含不存在或已删除的 HRM 用户');
      await this.setting(tx, ALLOWLIST, userIds, operatorId);
      await this.audit(tx, operatorId, 'ai_progress_allowlist_updated', {
        userCount: userIds.length,
      });
    });
    return this.getPublicState();
  }

  async getActiveRuntimeConfig(): Promise<
    (ProviderRuntimeConfig & { configVersion: number }) | null
  > {
    // One snapshot prevents a concurrent disable/edit from mixing settings and credentials.
    return this.prisma
      .$transaction(
        async (tx) => {
          const enabled = await tx.systemConfig.findUnique({
            where: { key: ENABLED },
          });
          return enabled?.value === true ? this.activeRuntime(tx) : null;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      )
      .catch((error) => this.persistenceError(error));
  }

  private async activeRuntime(tx: Prisma.TransactionClient) {
    const active = await tx.systemConfig.findUnique({ where: { key: ACTIVE } });
    if (typeof active?.value !== 'string' || !AI_PROVIDERS.includes(active.value as AiProvider))
      return null;
    const row = await tx.aiProviderCredential.findUnique({
      where: { provider: active.value },
    });
    if (!row || row.testedVersion !== row.configVersion) return null;
    try {
      return this.runtime(row);
    } catch {
      return null;
    }
  }

  private runtime(row: AiProviderCredential): ProviderRuntimeConfig & { configVersion: number } {
    this.assertProvider(row.provider);
    return {
      provider: row.provider,
      apiKey: this.decrypt(row),
      modelId: row.modelId,
      ...(row.region ? { region: row.region } : {}),
      ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
      configVersion: row.configVersion,
    };
  }

  private usable(row: AiProviderCredential) {
    if (row.testedVersion !== row.configVersion) return false;
    try {
      this.runtime(row);
      return true;
    } catch {
      return false;
    }
  }

  private assertProvider(provider: string): asserts provider is AiProvider {
    if (!AI_PROVIDERS.includes(provider as AiProvider))
      throw new BadRequestException('不支持的 AI 服务商');
  }

  private masterKey(): Buffer | null {
    const value = this.config.get<string>('AI_PROVIDER_ENCRYPTION_KEY');
    if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
    const bytes = Buffer.from(value, 'base64');
    return bytes.length === 32 && bytes.toString('base64') === value ? bytes : null;
  }

  private encrypt(provider: string, value: string): Buffer {
    const master = this.masterKey();
    if (!master) throw new BadRequestException('AI 凭据主密钥未配置或无效');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', master, iv);
    cipher.setAAD(Buffer.from(`ai-provider:v1:${provider}`));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
  }

  private decrypt(row: AiProviderCredential): string {
    try {
      const master = this.masterKey();
      const encrypted = Buffer.from(row.encryptedKey);
      if (!master || encrypted.length < 30 || encrypted[0] !== 1) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', master, encrypted.subarray(1, 13));
      decipher.setAAD(Buffer.from(`ai-provider:v1:${row.provider}`));
      decipher.setAuthTag(encrypted.subarray(13, 29));
      return Buffer.concat([decipher.update(encrypted.subarray(29)), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new BadRequestException('AI 凭据不可用，请检查独立主密钥或重新录入凭据');
    }
  }

  private mutate<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma
      .$transaction(async (tx) => {
        // Serialize admin edits across API instances, including first-time provider creation.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(126012, 3)`;
        return work(tx);
      })
      .catch((error) => this.persistenceError(error));
  }

  private persistenceError(error: unknown): never {
    if (error instanceof BadRequestException) throw error;
    throw new ServiceUnavailableException('AI 配置暂时不可用，请稍后重试');
  }

  private async deactivateIfActive(
    tx: Prisma.TransactionClient,
    provider: string,
    operatorId: string,
  ) {
    const active = await tx.systemConfig.findUnique({ where: { key: ACTIVE } });
    if (active?.value === provider) {
      await this.setting(tx, ACTIVE, Prisma.JsonNull, operatorId);
      await this.setting(tx, ENABLED, false, operatorId);
    }
  }

  private setting(
    tx: Prisma.TransactionClient,
    key: string,
    value: Prisma.InputJsonValue | typeof Prisma.JsonNull,
    operatorId: string,
  ) {
    return tx.systemConfig.upsert({
      where: { key },
      create: { key, value, updatedBy: operatorId },
      update: { value, updatedBy: operatorId, updatedAt: new Date() },
    });
  }

  private audit(
    tx: Prisma.TransactionClient,
    userId: string,
    action: string,
    newValue: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: { userId, action, entityType: 'ai_progress_config', newValue },
    });
  }
}
