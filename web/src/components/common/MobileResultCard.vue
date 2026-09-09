<template>
  <article class="mobile-result-card">
    <header class="mobile-result-card__header">
      <div class="mobile-result-card__title"><slot name="title" /></div>
      <div v-if="$slots.status" class="mobile-result-card__status"><slot name="status" /></div>
    </header>
    <div class="mobile-result-card__body"><slot /></div>
    <footer v-if="$slots.actions" class="mobile-result-card__actions"><slot name="actions" /></footer>
  </article>
</template>

<style scoped>
.mobile-result-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-bg-color);
}

.mobile-result-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.mobile-result-card__title {
  min-width: 0;
  color: var(--el-text-color-primary);
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
  overflow-wrap: anywhere;
}

.mobile-result-card__status {
  flex: 0 0 auto;
}

.mobile-result-card__body {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.mobile-result-card__body :deep(.mobile-result-field) {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.mobile-result-card__body :deep(.mobile-result-field__label) {
  color: var(--el-text-color-secondary);
}

.mobile-result-card__body :deep(.mobile-result-field__value) {
  min-width: 0;
  overflow-wrap: anywhere;
}

.mobile-result-card__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-extra-light);
}

.mobile-result-card__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
