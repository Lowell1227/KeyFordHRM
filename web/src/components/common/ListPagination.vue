<script setup lang="ts">
withDefaults(defineProps<{
  currentPage: number;
  pageSize: number;
  total: number;
  pageSizes?: number[];
  disabled?: boolean;
  showPageSize?: boolean;
}>(), {
  pageSizes: () => [10, 20, 50],
  showPageSize: true,
});

const emit = defineEmits<{
  'update:currentPage': [value: number];
  'update:pageSize': [value: number];
  change: [];
}>();

function handleCurrentChange(value: number) {
  emit('update:currentPage', value);
  emit('change');
}

function handleSizeChange(value: number) {
  emit('update:currentPage', 1);
  emit('update:pageSize', value);
  emit('change');
}
</script>

<template>
  <div v-if="total > 0" class="app-pager list-pagination">
    <el-pagination
      class="list-pagination__control"
      :current-page="currentPage"
      :page-size="pageSize"
      :page-sizes="pageSizes"
      :total="total"
      :pager-count="5"
      :layout="showPageSize ? 'total, sizes, prev, pager, next' : 'total, prev, pager, next'"
      background
      :disabled="disabled"
      @current-change="handleCurrentChange"
      @size-change="handleSizeChange"
    />
  </div>
</template>

<style scoped>
@media (max-width: 768px) {
  .list-pagination {
    justify-content: space-between;
    overflow: visible;
  }

  .list-pagination__control {
    display: flex;
    width: 100%;
    justify-content: space-between;
  }

  .list-pagination__control :deep(.el-pagination__total) {
    display: block;
    margin-right: auto;
  }

  .list-pagination__control :deep(.el-pagination__sizes) {
    display: none;
  }
}
</style>
