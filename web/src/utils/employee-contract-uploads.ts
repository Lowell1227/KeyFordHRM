import { computed, shallowReactive } from 'vue';
import { ElMessage } from 'element-plus';
import { uploadApi } from '@/api/upload.api';
import type { Attachment } from '@/types/api.types';

type MaterialKind = 'images' | 'attachments';
type Contract = Record<string, unknown> & { images?: Attachment[]; attachments?: Attachment[] };
type UploadTask = { id: number; contract: Contract; kind: MaterialKind; file: File; status: 'uploading' | 'failed'; error: string };

export function useContractUploads(isCurrent: (contract: Contract) => boolean) {
  const tasks = shallowReactive<UploadTask[]>([]);
  let nextId = 0;
  const forContract = (contract: Contract, kind?: MaterialKind) => tasks.filter(task => task.contract === contract && (!kind || task.kind === kind));
  const count = (contract: Contract, kind: MaterialKind) => (contract[kind]?.length ?? 0) + forContract(contract, kind).length;
  const blocked = computed(() => tasks.some(task => isCurrent(task.contract)));
  const message = computed(() => tasks.some(task => isCurrent(task.contract) && task.status === 'uploading')
    ? '合同材料上传中，请完成后提交' : blocked.value ? '合同材料上传失败，请重试或移除后提交' : '');
  function remove(task: UploadTask) {
    const index = tasks.indexOf(task);
    if (index >= 0) tasks.splice(index, 1);
  }
  function cancelContract(contract: Contract) { forContract(contract).forEach(remove); }
  function clear() { tasks.splice(0); }

  async function run(task: UploadTask) {
    if (!tasks.includes(task) || !isCurrent(task.contract)) return;
    task.status = 'uploading';
    task.error = '';
    try {
      const image = task.kind === 'images';
      const file = task.file, extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
      if (file.size > (image ? 2 : 10) * 1024 * 1024) throw new Error(image ? '合同图片单张不能超过 2MB' : '合同附件单个不能超过 10MB');
      const types = image ? ['image/jpeg', 'image/png', 'image/webp'] : ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
      const extensions = image ? ['.jpg', '.jpeg', '.png', '.webp'] : ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];
      if (!types.includes(file.type) && !extensions.includes(extension)) throw new Error(image ? '合同图片仅支持 JPG、PNG、WEBP' : '合同附件仅支持 PDF、Word、Excel');
      const uploaded = await uploadApi.upload(file, image ? 'employee-contract-image' : 'employee-contract-attachment');
      // Removing a task also invalidates callbacks from a closed editor or removed row.
      if (!tasks.includes(task) || !isCurrent(task.contract)) return;
      task.contract[task.kind] = [...(task.contract[task.kind] ?? []), uploaded];
      remove(task);
      return uploaded;
    } catch (error) {
      if (!tasks.includes(task) || !isCurrent(task.contract)) return;
      task.status = 'failed';
      task.error = error instanceof Error && !('response' in error) && !('request' in error)
        && /^(合同图片|合同附件)/.test(error.message) ? error.message : '上传失败，请重试或移除';
      throw error;
    }
  }
  async function start(contract: Contract, kind: MaterialKind, file: File) {
    if (!isCurrent(contract)) return;
    const limit = kind === 'images' ? 5 : 10;
    if (count(contract, kind) >= limit) {
      ElMessage.warning(kind === 'images' ? '每份合同最多上传 5 张图片（含待处理文件）' : '每份合同最多上传 10 个附件（含待处理文件）');
      return;
    }
    const task = shallowReactive<UploadTask>({ id: ++nextId, contract, kind, file, status: 'uploading', error: '' });
    tasks.push(task);
    return run(task);
  }
  async function retry(task: UploadTask) {
    if (task.status !== 'failed') return;
    await run(task).catch(() => {});
  }
  return { forContract, count, blocked, message, start, retry, remove, cancelContract, clear };
}
