<script setup lang="ts">
import { computed } from 'vue';
import { QuestionFilled } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import PersonnelPendingReviews from './components/PersonnelPendingReviews.vue';

const auth = useAuthStore();
const canReviewEmployee = computed(() => (
  ['hr', 'system_admin'].includes(auth.user?.sysRole ?? '')
  || Boolean(auth.user?.hrCapabilities?.includes('employee_archive_review'))
));
const canReviewDepartment = computed(() => ['hr', 'system_admin'].includes(auth.user?.sysRole ?? ''));
const canReviewPosition = canReviewDepartment;
</script>

<template>
  <div class="personnel-review-page page-stack">
    <section class="personnel-review-hero">
      <div><h2>人事变更审核</h2></div>
      <el-tooltip placement="bottom"><template #content>统一处理员工档案、组织架构和岗位目录的待审核变更。<br>审核通过后，正式数据才会生效。</template><el-icon><QuestionFilled /></el-icon></el-tooltip>
    </section>
    <PersonnelPendingReviews
      :can-review-employee="canReviewEmployee"
      :can-review-department="canReviewDepartment"
      :can-review-position="canReviewPosition"
    />
  </div>
</template>

<style scoped>
.personnel-review-page { max-width: 1600px; margin: 0 auto; }
.personnel-review-hero { display: flex; align-items: center; gap: 8px; padding: 18px 22px; border: 1px solid #e5eaf2; border-radius: 16px; background: #fff; }
.personnel-review-hero h2 { margin: 0; }.personnel-review-hero .el-icon { color: #98a2b3; cursor: help; }
:deep(.pending-review-workspace) { margin-top: 0; }
</style>
