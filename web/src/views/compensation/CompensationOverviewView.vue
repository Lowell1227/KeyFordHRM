<script setup lang="ts">
const futureScope = [
  '调薪记录与生效历史',
  '最终工资结果导入与查询',
  '薪酬业务分析与权限留痕',
];

const excludedScope = [
  '工资项目、公式和核算流程',
  '工资发放、银行代发与个税申报',
  '员工薪资数据录入、查询或导出',
];
</script>

<template>
  <main class="overview-page" data-testid="compensation-overview">
    <header class="overview-hero">
      <div>
        <p class="eyebrow">业务模块规划</p>
        <h1>薪酬（规划中）</h1>
        <p class="hero-copy">
          该入口用于保留后续建设方向，当前不开发工资核算与发放能力，也不接入或展示任何员工薪资数据。
        </p>
      </div>
      <span class="status-tag">已暂缓</span>
    </header>

    <section class="boundary-card boundary-card--notice">
      <h2>当前结论</h2>
      <p>
        薪酬模块尚未立项和排期。本页没有业务操作，不代表工资核算流程已经确定，也不改变现有线下薪酬处理方式。
      </p>
    </section>

    <div class="scope-grid">
      <section class="boundary-card">
        <h2>后续可讨论的方向</h2>
        <ul>
          <li v-for="item in futureScope" :key="item">{{ item }}</li>
        </ul>
      </section>

      <section class="boundary-card">
        <h2>当前明确不建设</h2>
        <ul>
          <li v-for="item in excludedScope" :key="item">{{ item }}</li>
        </ul>
      </section>
    </div>

    <p class="permission-note">
      当前仅系统管理员可见；面向指定 HR 主管的独立薪酬权限尚未建设。
    </p>
  </main>
</template>

<style scoped>
.overview-page {
  min-height: 100%;
  padding: 28px;
  box-sizing: border-box;
  color: #202b4d;
}

.overview-hero,
.boundary-card {
  border: 1px solid #e4e9f2;
  border-radius: 12px;
  background: #fff;
}

.overview-hero {
  padding: 28px 30px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  box-shadow: 0 6px 22px rgb(42 61 105 / 6%);
}

.eyebrow {
  margin: 0 0 8px;
  color: #6c7a9c;
  font-size: 13px;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 10px;
  font-size: 28px;
  line-height: 1.3;
}

h2 {
  margin-bottom: 12px;
  font-size: 17px;
}

.hero-copy,
.boundary-card p,
.boundary-card li,
.permission-note {
  color: #5f6984;
  font-size: 14px;
  line-height: 1.8;
}

.hero-copy {
  max-width: 720px;
  margin-bottom: 0;
}

.status-tag {
  flex-shrink: 0;
  padding: 6px 12px;
  border: 1px solid #f0c36d;
  border-radius: 999px;
  color: #8a5a00;
  background: #fff7e6;
  font-size: 13px;
  font-weight: 700;
}

.boundary-card {
  padding: 22px 24px;
}

.boundary-card--notice {
  margin-top: 18px;
  border-color: #d9e5ff;
  background: #f6f9ff;
}

.boundary-card p {
  margin-bottom: 0;
}

.scope-grid {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

ul {
  margin: 0;
  padding-left: 20px;
}

li + li {
  margin-top: 8px;
}

.permission-note {
  margin: 18px 2px 0;
}

@media (max-width: 768px) {
  .overview-page {
    padding: 16px;
  }

  .overview-hero {
    padding: 22px 20px;
  }

  .scope-grid {
    grid-template-columns: 1fr;
  }

  h1 {
    font-size: 23px;
  }
}
</style>
