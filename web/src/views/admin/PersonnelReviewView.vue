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
const canReviewPosition = canReviewDepartment;
</script>

<template>
  <div class="personnel-review-page page-stack">
    <PersonnelPendingReviews
      :can-review-employee="canReviewEmployee"
      :can-review-department="canReviewDepartment"
      :can-review-position="canReviewPosition"
    />
  </div>
</template>

<style scoped>
.personnel-review-page { max-width: 1600px; margin: 0 auto; }
:deep(.pending-review-workspace) { margin-top: 0; }
</style>
