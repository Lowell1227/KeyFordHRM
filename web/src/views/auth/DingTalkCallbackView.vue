<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

onMounted(async () => {
  const authCode = (route.query.authCode as string) || (route.query.code as string);
  const redirect = (route.query.redirect as string) || '/dashboard';

  if (!authCode) {
    ElMessage.error('缺少钉钉授权码');
    router.replace({ name: 'Login', query: { redirect } });
    return;
  }

  try {
    await auth.loginWithDingTalk(authCode);
    router.replace(redirect);
  } catch {
    ElMessage.error('钉钉登录失败，请使用账号密码登录');
    router.replace({ name: 'Login', query: { redirect } });
  }
});
</script>

<template>
  <el-card>
    <p v-loading="true">正在登录...</p>
  </el-card>
</template>
