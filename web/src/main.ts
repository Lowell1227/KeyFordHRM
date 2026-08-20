import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus, { ElMessage } from 'element-plus';
import 'element-plus/dist/index.css';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import App from './App.vue';
import router from './router';
import './styles/theme.css';

const app = createApp(App);
app.config.errorHandler = (err, instance, info) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled Vue error:', err, instance, info);
  ElMessage.error('页面出错');
};

app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn });

async function bootstrap() {
  await router.isReady();
  app.mount('#app');
}

void bootstrap();
