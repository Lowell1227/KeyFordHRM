<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth.store';
import PersonnelPendingReviews from './components/PersonnelPendingReviews.vue';

const auth = useAuthStore();
const canReviewEmployee = computed(() => (
  ['hr', 'system_admin'].includes(auth.user?.sysRole ?? '')
  || Boolean(auth.user?.hrCapabilities?.includes('employee_archive_review'))
));
const canReviewDepartment = computed(() => ['hr', 'system_admin'].includes(auth.user?.sysRole ?? ''));
</script>

<template>
  <div class="personnel-review-page page-stack">
    <section class="personnel-review-hero">
      <div>
        <span>人员档案</span>
        <h2>人事变更审核</h2>
        <p>集中审核普通 HR 提交的员工档案与部门架构变更；审核通过前不影响正式数据。</p>
      </div>
    </section>
    <PersonnelPendingReviews
      :can-review-employee="canReviewEmployee"
      :can-review-department="canReviewDepartment"
    />
  </div>
</template>

<style scoped>
.personnel-review-page { max-width: 1600px; margin: 0 auto; }
.personnel-review-hero { padding: 22px 24px; border: 1px solid #e5eaf2; border-radius: 16px; background: linear-gradient(135deg, #fff 0%, #f6f8ff 100%); }
.personnel-review-hero span { color: #4f6ef7; font-size: 13px; font-weight: 700; }
.personnel-review-hero h2 { margin: 6px 0; }
.personnel-review-hero p { margin: 0; color: #667085; }
:deep(.pending-review-workspace) { margin-top: 0; }
</style>
