import { ref, computed, watch } from 'vue';

export interface UsePaginationOptions {
  defaultPage?: number;
  defaultPageSize?: number;
  pageSizeOptions?: number[];
}

export function usePagination(options: UsePaginationOptions = {}) {
  const {
    defaultPage = 1,
    defaultPageSize = 20,
    pageSizeOptions = [10, 20, 50, 100],
  } = options;

  const page = ref(defaultPage);
  const pageSize = ref(defaultPageSize);
  const total = ref(0);

  const skip = computed(() => (page.value - 1) * pageSize.value);

  function setPage(value: number) {
    page.value = Math.max(1, value);
  }

  function setPageSize(value: number) {
    pageSize.value = value;
    page.value = 1;
  }

  function setTotal(value: number) {
    total.value = Math.max(0, value);
  }

  function reset() {
    page.value = defaultPage;
    pageSize.value = defaultPageSize;
    total.value = 0;
  }

  /** 合并分页参数到查询对象。 */
  function withParams<T extends Record<string, unknown>>(query: T) {
    return {
      ...query,
      page: page.value,
      pageSize: pageSize.value,
    };
  }

  /** 监听 page/pageSize 变化并触发回调。 */
  function onChange(callback: () => void) {
    watch([page, pageSize], () => callback(), { immediate: false });
  }

  return {
    page,
    pageSize,
    total,
    skip,
    pageSizeOptions,
    setPage,
    setPageSize,
    setTotal,
    reset,
    withParams,
    onChange,
  };
}

export type UsePaginationReturn = ReturnType<typeof usePagination>;
