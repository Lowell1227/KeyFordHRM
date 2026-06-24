import { ref } from 'vue';

export interface UseExportOptions {
  /** 默认下载文件名。 */
  filename?: string;
}

/**
 * 触发 Blob 下载。
 * @param fetcher 返回 Blob 的异步函数。
 * @param filename 下载文件名，为空时尝试从响应头解析。
 */
export function useExport(options: UseExportOptions = {}) {
  const loading = ref(false);

  async function download(fetcher: () => Promise<Blob>, filename?: string): Promise<void> {
    loading.value = true;
    try {
      const blob = await fetcher();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? options.filename ?? 'export.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } finally {
      loading.value = false;
    }
  }

  return {
    loading,
    download,
  };
}

export type UseExportReturn = ReturnType<typeof useExport>;
