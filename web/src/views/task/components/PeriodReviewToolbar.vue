<script setup lang="ts">
withDefaults(defineProps<{
  title: string;
  statusLabel: string;
  dueText: string;
  progressText?: string;
  progressHint?: string;
  showActions?: boolean;
  toolbarTestId?: string;
  actionsTestId?: string;
}>(), {
  progressText: '',
  progressHint: '',
  showActions: false,
  toolbarTestId: undefined,
  actionsTestId: undefined,
});
</script>

<template>
  <header class="period-review-toolbar" :data-testid="toolbarTestId">
    <div class="period-review-toolbar__context">
      <div>
        <strong>{{ title }}</strong>
        <span>{{ statusLabel }}</span>
      </div>
      <small>{{ dueText }}</small>
    </div>
    <div v-if="showActions" class="period-review-toolbar__actions" :data-testid="actionsTestId">
      <div class="period-review-toolbar__progress">
        <strong>{{ progressText }}</strong>
        <span>{{ progressHint }}</span>
      </div>
      <div class="period-review-toolbar__buttons">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.period-review-toolbar {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  padding: 12px 16px;
  border: 1px solid #e5eaf2;
  border-radius: 12px;
  background: #fff;
}

.period-review-toolbar__context {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.period-review-toolbar__context > div {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
}

.period-review-toolbar__context strong {
  overflow: hidden;
  color: #202a3d;
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.period-review-toolbar__context span {
  flex: 0 0 auto;
  padding: 3px 8px;
  border-radius: 4px;
  background: #eef2ff;
  color: #5068d8;
  font-size: 11px;
}

.period-review-toolbar__context small {
  flex: 0 0 auto;
  color: #7c8799;
  font-size: 12px;
}

.period-review-toolbar__actions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-top: 10px;
  border-top: 1px solid #edf0f5;
}

.period-review-toolbar__progress {
  min-width: 130px;
  display: grid;
  gap: 2px;
}

.period-review-toolbar__progress strong {
  color: #30394a;
  font-size: 13px;
}

.period-review-toolbar__progress span {
  max-width: 260px;
  overflow: hidden;
  color: #8a93a3;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.period-review-toolbar__buttons {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
}

.period-review-toolbar__buttons :deep(.el-button) {
  margin-left: 0;
}

@media (max-width: 767px) {
  .period-review-toolbar {
    padding: 12px;
  }

  .period-review-toolbar__context {
    align-items: flex-start;
  }

  .period-review-toolbar__context > div {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .period-review-toolbar__context small {
    max-width: 135px;
    text-align: right;
  }

  .period-review-toolbar__actions {
    position: fixed;
    z-index: 40;
    right: 0;
    bottom: 0;
    left: 0;
    align-items: stretch;
    flex-direction: column;
    gap: 7px;
    padding: 9px 10px calc(9px + env(safe-area-inset-bottom));
    border: 1px solid #dfe5f0;
    background: #fff;
    box-shadow: 0 -8px 24px rgb(31 45 61 / 10%);
  }

  .period-review-toolbar__progress {
    min-width: 0;
  }

  .period-review-toolbar__progress span {
    display: none;
  }

  .period-review-toolbar__buttons {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
  }

  .period-review-toolbar__buttons :deep(.el-button) {
    min-width: 0;
    flex: 1;
    padding-right: 7px;
    padding-left: 7px;
    font-size: 12px;
  }
}
</style>
