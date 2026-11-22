<script setup lang="ts">
const futureScope = [
  '适用主体、人员范围、正式工资结构及计薪规则',
  '复核审批人员、财务授权、期初及入薪凭据',
  '钉钉实际取数、身份匹配及自然月覆盖验收',
];

const excludedScope = [
  '部门奖金、调薪审批和自由公式编辑',
  '银行代发、个税申报及税后实发',
  '员工工资条与通用 OA 审批引擎',
];
</script>

<template>
  <main class="overview-page" data-testid="compensation-overview">
    <header class="overview-hero">
      <div>
        <p class="eyebrow">薪酬建设状态</p>
        <p class="hero-copy">
          首批税前核算已实现，当前仅在隔离预览使用虚构数据。本页不展示员工薪资，不开放正式算薪或工资发放。
        </p>
      </div>
      <span class="status-tag">正式算薪未启用</span>
    </header>

    <section class="boundary-card boundary-card--notice">
      <h2>当前结论</h2>
      <p>
        考勤核算周期为自然月 1 日至月底。隔离预览已接通考勤核对封账、自动核算、复核审批、最终加密工资表及更正补差；代码部署不代表已接入真实钉钉考勤或已核定正式工资规则，现有线下薪酬处理方式不变。
      </p>
    </section>

    <div class="scope-grid">
      <section class="boundary-card">
        <h2>正式启用前待确认</h2>
        <ul>
          <li v-for="item in futureScope" :key="item">{{ item }}</li>
        </ul>
      </section>

      <section class="boundary-card">
        <h2>本批不包含</h2>
        <ul>
          <li v-for="item in excludedScope" :key="item">{{ item }}</li>
        </ul>
      </section>
    </div>

    <p class="permission-note">
      本页仅系统管理员可见。算薪页面按用工主体独立授权，HR、管理员及主管均不自动获得工资权限；正式授权另行确认。
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

h2,
p {
  margin-top: 0;
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
