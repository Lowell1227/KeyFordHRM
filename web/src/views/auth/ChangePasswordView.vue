<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';

const auth = useAuthStore();
const router = useRouter();
const saving = ref(false);
const form = reactive({ password: '', confirmPassword: '' });

async function submit() {
  if (!/^\d{4,6}$/.test(form.password)) {
    ElMessage.warning('新密码须为 4—6 位数字');
    return;
  }
  if (form.password === '0000') {
    ElMessage.warning('新密码不能继续使用初始密码 0000');
    return;
  }
  if (form.password !== form.confirmPassword) {
    ElMessage.warning('两次输入的密码不一致');
    return;
  }
  saving.value = true;
  try {
    await auth.changePassword(form.password, form.confirmPassword);
    ElMessage.success('密码修改成功');
    await router.replace({ name: 'Dashboard' });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="change-password-page">
    <section class="change-password-card">
      <img src="/brand/logo-2025.png" alt="KAYFORD 孚德" class="logo" />
      <h1>请先修改初始密码</h1>
      <p>为保障账号安全，首次使用工号和初始密码登录后必须修改密码。</p>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="新密码">
          <el-input
            v-model="form.password"
            type="password"
            inputmode="numeric"
            maxlength="6"
            placeholder="请输入 4—6 位数字"
            show-password
            autocomplete="new-password"
          />
        </el-form-item>
        <el-form-item label="再次输入新密码">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            inputmode="numeric"
            maxlength="6"
            placeholder="请再次输入"
            show-password
            autocomplete="new-password"
          />
        </el-form-item>
        <el-button class="submit" type="primary" native-type="submit" :loading="saving">保存并进入系统</el-button>
      </el-form>
      <small>密码仅校验为 4—6 位数字，两次输入一致即可；不能继续使用 0000。</small>
    </section>
  </main>
</template>

<style scoped>
.change-password-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f4f7fb; }
.change-password-card { width: min(440px, 100%); padding: 40px; border-radius: 18px; background: #fff; box-shadow: 0 18px 48px rgb(32 59 92 / 12%); }
.logo { width: 138px; margin-bottom: 28px; }
h1 { margin: 0 0 10px; color: #1f2d3d; font-size: 26px; }
p { margin: 0 0 28px; color: #667085; line-height: 1.7; }
.submit { width: 100%; margin-top: 6px; }
small { display: block; margin-top: 18px; color: #98a2b3; line-height: 1.6; }
</style>
