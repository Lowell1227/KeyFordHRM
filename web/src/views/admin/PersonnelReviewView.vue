<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth.store';
import PersonnelPendingReviews from './components/PersonnelPendingReviews.vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';

const auth = useAuthStore();
const canReviewEmployee = computed(() => (
  ['hr', 'system_admin'].includes(auth.user?.sysRole ?? '')
  || Boolean(auth.user?.hrCapabilities?.includes('employee_archive_review'))
));
const canReviewDepartment = computed(() => ['hr', 'system_admin'].includes(auth.user?.sysRole ?? ''));
const canReviewPosition = canReviewDepartment;
</script>

<template>
  <BusinessListPage variant="workflow" :loading="false" class="personnel-review-page">
    <template #workspace>
      <PersonnelPendingReviews
        :can-review-employee="canReviewEmployee"
        :can-review-department="canReviewDepartment"
        :can-review-position="canReviewPosition"
      />
    </template>
  </BusinessListPage>
</template>

<style scoped>
.personnel-review-page { max-width: 1600px; margin: 0 auto; }
:deep(.pending-review-workspace) { margin-top: 0; }
</style>
