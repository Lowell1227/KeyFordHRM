import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthUser } from '@/common/types/auth.types';
import { canViewTask } from '@/tasks/task-access-policy';
import { canEmployeeViewResult } from '@/tasks/result-publication';
import { StorageService } from './storage.service';

const taskSelect = {
  employeeId: true, managerId: true, deptHeadId: true, approverId: true,
  status: true, approvedAt: true, publishedAt: true,
  gradeResult: { select: { approvedAt: true, publishedAt: true, isPublished: true } },
  cycle: { select: { publishVisibleFields: true } },
} satisfies Prisma.AssessmentTaskSelect;

type SummaryKind = 'self' | 'manager';

function attachmentUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => item && typeof item === 'object' && typeof item.url === 'string' ? [item.url] : []);
}

function referenceUrls(key: string): string[] {
  return [...new Set([encodeURIComponent(key), key].flatMap((encoded) => [
    `/storage/download?key=${encoded}`, `/api/v1/storage/download?key=${encoded}`,
  ]))];
}

function generalObjectKey(url: string): string | null {
  if (!url.startsWith('/storage/download?') && !url.startsWith('/api/v1/storage/download?')) return null;
  const parsed = new URL(url, 'http://storage.internal');
  const key = parsed.searchParams.get('key');
  return key?.startsWith('uploads/') && referenceUrls(key).includes(url) ? key : null;
}

@Injectable()
export class LegacyTaskAttachmentsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  async assertDownload(key: string, viewer: AuthUser): Promise<void> {
    if (!key.startsWith('uploads/')) throw this.denied();
    const urls = referenceUrls(key);
    const where = { OR: urls.map((url) => ({ attachments: { array_contains: [{ url }] } })) };
    const selfRows = await this.prisma.selfEvalSummary.findMany({ where, select: { task: { select: taskSelect } } });
    const managerRows = await this.prisma.managerEvalSummary.findMany({ where, select: { task: { select: taskSelect } } });
    if (selfRows.some(({ task }) => canViewTask(task, viewer))) return;
    if (managerRows.some(({ task }) => {
      if (!canViewTask(task, viewer)) return false;
      if (task.employeeId !== viewer.id) return true;
      const fields = task.cycle.publishVisibleFields;
      const managerCommentVisible = !fields || typeof fields !== 'object' || Array.isArray(fields)
        || !Object.prototype.hasOwnProperty.call(fields, 'manager_comment') || Boolean(fields.manager_comment);
      return canEmployeeViewResult(task) && managerCommentVisible;
    })) return;
    // Bound files always follow current task permissions, never a past uploader's role.
    if (selfRows.length || managerRows.length) throw this.denied();
    if (await this.isUploader(key, viewer.id)) return;
    throw this.denied();
  }

  async assertCanAttach(taskId: string, kind: SummaryKind, attachments: unknown[] | undefined, viewer: AuthUser): Promise<void> {
    if (!attachments?.length) return;
    const current = kind === 'self'
      ? await this.prisma.selfEvalSummary.findUnique({ where: { taskId }, select: { attachments: true } })
      : await this.prisma.managerEvalSummary.findUnique({ where: { taskId }, select: { attachments: true } });
    const retained = new Set(attachmentUrls(current?.attachments));
    for (const attachment of attachments) {
      const url = attachmentUrls([attachment])[0];
      if (url && retained.has(url)) continue;
      const key = url ? generalObjectKey(url) : null;
      if (!key || !(await this.isUploader(key, viewer.id))) throw this.denied();
      await this.assertDownload(key, viewer);
    }
  }

  private async isUploader(key: string, userId: string): Promise<boolean> {
    try {
      const stat = await this.storage.statObject(key);
      return stat.metaData?.['hrm-uploader'] === userId;
    } catch (error) {
      if (['NoSuchKey', 'NotFound', 'NoSuchObject'].includes((error as { code?: string }).code ?? '')) return false;
      throw error;
    }
  }

  private denied(): ForbiddenException {
    return new ForbiddenException({ code: 'FORBIDDEN', message: '无权限访问或关联该绩效附件' });
  }
}
