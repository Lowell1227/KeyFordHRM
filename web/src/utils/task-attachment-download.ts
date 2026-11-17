import { ElMessage } from 'element-plus';
import { uploadApi } from '@/api/upload.api';
import type { Attachment } from '@/types/api.types';

export async function downloadTaskAttachment(attachment: Pick<Attachment, 'url' | 'name'>): Promise<void> {
  try {
    const url = new URL(attachment.url, window.location.origin);
    if (
      url.origin !== window.location.origin || url.username || url.password || url.hash
      || !['/storage/download', '/api/v1/storage/download'].includes(url.pathname)
      || [...url.searchParams.keys()].length !== 1 || !url.searchParams.get('key')?.trim()
    ) {
      ElMessage.error('附件下载地址无效');
      return;
    }
    // The authenticated client adds /api/v1; never pass an absolute or already-prefixed URL.
    const blob = await uploadApi.download(`/storage/download${url.search}`);
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    try {
      link.href = blobUrl;
      link.download = attachment.name;
      document.body.appendChild(link);
      link.click();
    } finally {
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    }
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    ElMessage.error(status === 403 ? '无权限下载此附件' : '附件下载失败，请稍后重试');
  }
}
