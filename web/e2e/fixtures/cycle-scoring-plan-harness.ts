import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import CycleScoringPlanHarness from './CycleScoringPlanHarness.vue';

export function mountCycleScoringPlanContractHarness(target: Element) {
  const app = createApp(CycleScoringPlanHarness);
  app.use(ElementPlus, { locale: zhCn });
  app.mount(target);
  return app;
}
