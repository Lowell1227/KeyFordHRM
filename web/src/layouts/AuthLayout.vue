<script setup lang="ts"></script>

<template>
  <div class="auth-layout">
    <slot />
  </div>
</template>

<style scoped>
.auth-layout {
  position: relative;
  isolation: isolate;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 32px;
  background:
    radial-gradient(circle at 8% 8%, rgba(59, 190, 178, 0.13), transparent 28%),
    radial-gradient(circle at 90% 88%, rgba(50, 112, 205, 0.12), transparent 32%),
    linear-gradient(135deg, #edf2f5 0%, #f8fafb 52%, #eef5f5 100%);
}

.auth-layout::before {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(13, 49, 85, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(13, 49, 85, 0.025) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: linear-gradient(to bottom right, black, transparent 68%);
  content: '';
}

@media (max-width: 720px) {
  .auth-layout {
    align-items: stretch;
    padding: 0;
    background: #f7f9fa;
  }

  .auth-layout::before {
    display: none;
  }
}
</style>
