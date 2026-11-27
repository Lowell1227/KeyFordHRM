<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight } from '@element-plus/icons-vue';
import { useRouter } from 'vue-router';
import type { OperationGroup, OperationItem } from '@/api/workbench.api';
const props = defineProps<{ group: OperationGroup | null; loading: boolean }>();
defineEmits<{ page: [page: number] }>();
const router = useRouter();
const queues = computed(() => props.group ? [
  { key: 'actionable', title: '待我办理', ...props.group.actionable },
  { key: 'attention', title: '需要关注', ...props.group.attention },
] : []);
const page = computed(() => props.group?.actionable.page ?? 1);
const hasMore = computed(() => queues.value.some(queue => queue.hasMore));
function open(item: OperationItem) {
  if (item.path.startsWith('/') && !item.path.startsWith('//')) void router.push(item.path);
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }).format(date);
}
</script>
<template>
  <div v-loading="loading" class="operation-rows">
    <template v-for="queue in queues" :key="queue.key">
      <template v-if="queue.items.length || (queue.total ?? 0) > 0">
        <h3>{{ queue.title }} <span>{{ queue.total ?? '暂不可用' }}</span></h3>
        <ul class="workbench-items">
          <li v-for="item in queue.items" :key="`${item.kind}-${item.id}`">
            <button type="button" class="workbench-row" @click="open(item)">
              <span class="workbench-row__body"><strong>{{ item.title }}</strong><small>{{ item.nextAction }}<template v-if="item.month"> · {{ item.month }}</template></small></span>
              <time v-if="item.dueAt">{{ dateLabel(item.dueAt) }}</time><el-icon><ArrowRight/></el-icon>
            </button>
          </li>
        </ul>
        <p class="operation-note">本页 {{ queue.items.length }} 项，共 {{ queue.total ?? '待核对' }} 项</p>
      </template>
    </template>
    <p v-if="group?.status === 'ready' && queues.every(queue => queue.total === 0)" class="operation-note">暂无事项</p>
    <nav v-if="page > 1 || hasMore" class="operation-pages" aria-label="事项翻页">
      <el-button text :disabled="page <= 1 || loading" @click="$emit('page', page - 1)">上一页</el-button>
      <span>第 {{ page }} 页</span><el-button text :disabled="!hasMore || loading" @click="$emit('page', page + 1)">下一页</el-button>
    </nav>
  </div>
</template>
<style scoped>
h3 { font-size:14px; margin:12px 0 6px; display:flex; gap:8px; }
h3 span, .operation-note, .operation-pages { color:var(--el-text-color-secondary); font-size:13px; }
.operation-pages { display:flex; align-items:center; justify-content:flex-end; gap:8px; }
</style>
