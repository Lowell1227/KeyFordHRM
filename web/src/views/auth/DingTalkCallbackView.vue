<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';
import { dingtalkLoginErrorMessage } from '@/utils/dingtalk-login-error';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

function resolveRedirect(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/dashboard';
}

onMounted(async () => {
  const authCode = (route.query.authCode as string) || (route.query.code as string);
  const redirect = resolveRedirect(route.query.redirect);

  if (!authCode) {
    ElMessage.error('缺少钉钉授权码');
    router.replace({ name: 'Login', query: { redirect } });
    return;
  }

  try {
    await auth.loginWithDingTalk(authCode, 'oauth');
    window.location.replace(redirect);
  } catch (error) {
    ElMessage.error(dingtalkLoginErrorMessage(error));
    router.replace({ name: 'Login', query: { redirect } });
  }
});
</script>

<template>
  <el-card>
    <p v-loading="true">正在登录...</p>
  </el-card>
</template>
