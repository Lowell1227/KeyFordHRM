<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { usersApi } from '@/api/users.api';
import type { User } from '@/types/api.types';

const props = defineProps<{
  name: string;
  active: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{ select: [user: User] }>();

const candidates = ref<User[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

function resetSearch() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  generation += 1;
  candidates.value = [];
  total.value = 0;
  error.value = '';
  loading.value = false;
}

function isCurrent(requestId: number, keyword: string) {
  return requestId === generation && props.active && props.name.trim() === keyword;
}

async function search(keyword: string, requestId: number) {
  if (!isCurrent(requestId, keyword)) return;
  try {
    // Archived employees are excluded by default; query both sets explicitly.
    const responses = await Promise.all([
      // Omit false: the existing API's implicit boolean conversion treats "false" as true.
      usersApi.findAll({ keyword, status: 'resigned', page: 1, pageSize: 5 }),
      usersApi.findAll({ keyword, status: 'resigned', archived: true, page: 1, pageSize: 5 }),
    ]);
    if (!isCurrent(requestId, keyword)) return;
    candidates.value = Array.from(
      new Map(responses.flatMap((response) => response.items).map((user) => [user.id, user])).values(),
    ).slice(0, 10);
    total.value = responses.reduce((count, response) => count + response.total, 0);
  } catch {
    if (isCurrent(requestId, keyword)) {
      error.value = '离职员工检索失败，可重试或继续填写新员工信息。';
    }
  } finally {
    if (isCurrent(requestId, keyword)) loading.value = false;
  }
}

function scheduleSearch() {
  resetSearch();
  const keyword = props.name.trim();
  if (!props.active || !keyword) return;
  loading.value = true;
  const requestId = generation;
  timer = setTimeout(() => {
    timer = undefined;
    void search(keyword, requestId);
  }, 300);
}

function retrySearch() {
  resetSearch();
  const keyword = props.name.trim();
  if (!props.active || !keyword) return;
  loading.value = true;
  void search(keyword, generation);
}

function employeeNumbers(user: User) {
  const numbers: string[] = [];
  if (user.employeeNo) numbers.push(`工号 ${user.employeeNo}`);
  if (user.matchedHistoricalEmployeeNo && user.matchedHistoricalEmployeeNo !== user.employeeNo) {
    numbers.push(`历史工号 ${user.matchedHistoricalEmployeeNo}`);
  }
  return numbers.join(' · ') || '无工号';
}

watch([() => props.name, () => props.active], scheduleSearch, { immediate: true, flush: 'sync' });
onUnmounted(resetSearch);
</script>

<template>
  <section
    v-if="active && name.trim() && (loading || error || candidates.length)"
    class="reentry-name-matches"
    data-testid="reentry-name-matches"
    aria-label="同名离职员工"
    :aria-busy="loading"
  >
    <p v-if="loading" class="reentry-name-matches__hint" role="status">正在查找离职员工…</p>
    <div v-else-if="error" class="reentry-name-matches__error" role="status">
      <span>{{ error }}</span>
      <el-button link type="primary" :disabled="disabled" @click="retrySearch">重试</el-button>
    </div>
    <template v-else>
      <div class="reentry-name-matches__heading">
        <span>找到离职员工，请核对后选择</span>
        <span class="reentry-name-matches__count">共 {{ total }} 人</span>
      </div>
      <ul class="reentry-name-matches__list">
        <li v-for="user in candidates" :key="user.id" class="reentry-name-matches__item">
          <div class="reentry-name-matches__identity">
            <div class="reentry-name-matches__name">
              <strong>{{ user.name }}</strong>
              <el-tag v-if="user.archivedAt" size="small" type="info">已归档</el-tag>
            </div>
            <div class="reentry-name-matches__details">
              {{ [employeeNumbers(user), user.deptName, user.position].filter(Boolean).join(' · ') }}
            </div>
          </div>
          <el-button
            link
            type="primary"
            :disabled="disabled"
            :aria-label="`选择 ${user.name}${user.employeeNo ? `（${user.employeeNo}）` : ''} 再入职`"
            @click="emit('select', user)"
          >选择再入职</el-button>
        </li>
      </ul>
      <p v-if="total > candidates.length" class="reentry-name-matches__hint">
        已显示 {{ candidates.length }} 人，请补充姓名以缩小范围。
      </p>
    </template>
  </section>
</template>

<style scoped>
.reentry-name-matches {
  min-width: 0;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-extra-light);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.5;
}
.reentry-name-matches__heading,
.reentry-name-matches__error,
.reentry-name-matches__item,
.reentry-name-matches__name {
  display: flex;
  align-items: center;
  gap: 6px 12px;
}
.reentry-name-matches__heading,
.reentry-name-matches__error,
.reentry-name-matches__name {
  flex-wrap: wrap;
}
.reentry-name-matches__heading { justify-content: space-between; }
.reentry-name-matches__count,
.reentry-name-matches__hint,
.reentry-name-matches__details { color: var(--el-text-color-secondary); }
.reentry-name-matches__hint { margin: 0; }
.reentry-name-matches__error { color: var(--el-color-warning-dark-2); }
.reentry-name-matches__list { margin: 6px 0 0; padding: 0; list-style: none; }
.reentry-name-matches__item { justify-content: space-between; padding: 7px 0; }
.reentry-name-matches__item + .reentry-name-matches__item {
  border-top: 1px solid var(--el-border-color-extra-light);
}
.reentry-name-matches__identity { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.reentry-name-matches__name strong { color: var(--el-text-color-primary); font-weight: 500; }
.reentry-name-matches__details { margin-top: 2px; }
.reentry-name-matches__item > .el-button { flex-shrink: 0; }
@media (max-width: 480px) {
  .reentry-name-matches__item { flex-wrap: wrap; }
  .reentry-name-matches__identity { flex-basis: 100%; }
  .reentry-name-matches__item > .el-button { margin-left: auto; }
}
</style>
