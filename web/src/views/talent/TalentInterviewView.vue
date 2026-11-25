<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { Refresh, ArrowLeft } from '@element-plus/icons-vue';
import { talentInterviewsApi, talentPoolApi } from '@/api/talent-pool.api';
import { recruitmentError, talentRecruitmentApi } from '@/api/talent-recruitment.api';
import { APPLICATION_STAGE_LABELS, INTERVIEW_STATUS_LABELS, type TalentApplicationQueueItem, type TalentApplicationStage, type TalentCandidateListItem, type TalentInterviewView } from '@/types/talent.types';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import QueryFilterPanel from '@/components/common/QueryFilterPanel.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import TalentDetailDrawer from './components/TalentDetailDrawer.vue';
import TalentFormDrawer from './components/TalentFormDrawer.vue';
import TalentInterviewContent from './components/TalentInterviewContent.vue';
import TalentInterviewPanel from './components/TalentInterviewPanel.vue';
import { interviewApplicationLabel } from './interview-application';
import { useTalentPermissions } from './useTalentPermissions';
import { formatInterviewTime } from './interview-time';

const route=useRoute(),router=useRouter(),{canEdit,canRead}=useTalentPermissions();
const canManage=canRead;
const mode=ref<'applications'|'interviews'>('applications'),keyword=ref(''),scope=ref('all'),stage=ref<TalentApplicationStage|''>(''),day=ref('');
const bucket=ref<'upcoming'|'feedback'|'history'|'all'>('upcoming'),page=ref(1),pageSize=ref(20),total=ref(0),loading=ref(false),error=ref('');
const overdueOnly=ref(false);
const applications=ref<TalentApplicationQueueItem[]>([]),interviews=ref<TalentInterviewView[]>([]),detail=ref<TalentInterviewView|null>(null);
const drawer=ref<InstanceType<typeof TalentDetailDrawer>>(),singlePanel=ref<InstanceType<typeof TalentInterviewPanel>>(),singleContent=ref<InstanceType<typeof TalentInterviewContent>>();
const drawerOpen=ref(false),candidateId=ref<string|null>(null),applicationId=ref<string|undefined>(),newApplication=ref(false);
const formDrawer=ref<InstanceType<typeof TalentFormDrawer>>(),formOpen=ref(false),editCandidateId=ref<string|null>(null);
const applicationMatch=computed(()=>applicationId.value?{id:applicationId.value}:undefined);
const pickerOpen=ref(false),picking=ref(false),pickerError=ref(''),people=ref<TalentCandidateListItem[]>([]),picked=ref('');
let generation=0,peopleGeneration=0;
const time=(v:string)=>formatInterviewTime(v).slice(0,16);
const nextStep=(row:TalentApplicationQueueItem)=>overdueOnly.value&&['accepted','onboarding'].includes(row.stage)?'核对实际到岗结果':({screening:row.nextInterview?'查看面试安排':'初筛 / 安排面试',interviewing:row.nextInterview?'查看安排 / 反馈':'安排面试 / 决定下一步',hiring_review:'等待独立录用确认',offered:'记录候选人答复',accepted:'办理入职',onboarding:'跟进入职 / 到岗',hired:'查看员工档案',declined:'查看历史',rejected:'查看历史',reserve:'继续沟通 / 安排面试',withdrawn:'查看历史'}[row.stage]);
async function canLeave(){
  if(formOpen.value && formDrawer.value && !await formDrawer.value.prepareToLeave())return false;
  if(drawerOpen.value && drawer.value && !await drawer.value.prepareToLeave())return false;
  return !(singlePanel.value && !await singlePanel.value.prepareToLeave()) && !(singleContent.value && !await singleContent.value.prepareToLeave());
}
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(async(to,from)=>{if(formOpen.value || to.params.id!==from.params.id || to.query.candidateId!==from.query.candidateId || to.query.applicationId!==from.query.applicationId)return canLeave();});
function syncQuery(){
  const q=route.query;mode.value=canManage.value && q.work!=='interviews'?'applications':'interviews';keyword.value=typeof q.keyword==='string'?q.keyword:'';
  const allowed=mode.value==='applications'?['all','owned']:canManage.value?['all','responsible','mine','created']:['mine'];
  scope.value=typeof q.scope==='string'&&allowed.includes(q.scope)?q.scope:allowed[0]!;
  stage.value=typeof q.stage==='string'&&Object.prototype.hasOwnProperty.call(APPLICATION_STAGE_LABELS,q.stage)?q.stage as TalentApplicationStage:'';
  overdueOnly.value=mode.value==='applications'&&q.overdueOnly==='true';
  day.value=typeof q.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(q.day)?q.day:'';
  bucket.value=['upcoming','feedback','history','all'].includes(String(q.bucket))?q.bucket as typeof bucket.value:'upcoming';page.value=Math.max(1,Number(q.page)||1);
  formOpen.value=false;editCandidateId.value=null;
  candidateId.value=canManage.value&&typeof q.candidateId==='string'?q.candidateId:null;applicationId.value=typeof q.applicationId==='string'?q.applicationId:undefined;
  newApplication.value=canEdit.value&&q.newApplication==='1';drawerOpen.value=!!candidateId.value;
}
async function load(){
  const token=++generation;loading.value=true;error.value='';
  try{
    if(typeof route.params.id==='string'){const row=await talentInterviewsApi.detail(route.params.id);if(token===generation)detail.value=row;return;}
    detail.value=null;
    const result=mode.value==='applications'?await talentRecruitmentApi.queue({scope:scope.value as 'owned'|'all',keyword:keyword.value.trim()||undefined,stage:stage.value||undefined,overdueOnly:overdueOnly.value||undefined,page:page.value,pageSize:pageSize.value})
      :await talentInterviewsApi.queue({scope:scope.value as 'mine'|'created'|'responsible'|'all',keyword:keyword.value.trim()||undefined,view:bucket.value,day:day.value||undefined,page:page.value,pageSize:pageSize.value});
    if(token!==generation)return;total.value=result.total;
    if(mode.value==='applications')applications.value=result.items as TalentApplicationQueueItem[];else interviews.value=result.items as TalentInterviewView[];
    if(!result.items.length&&result.total&&page.value>1){page.value=Math.ceil(result.total/pageSize.value);await search(false);}
  }catch(cause){if(token===generation)error.value=recruitmentError(cause);}finally{if(token===generation)loading.value=false;}
}
async function search(reset=true){
  if(reset)page.value=1;
  const q={...route.query,work:mode.value,scope:scope.value,keyword:keyword.value.trim()||undefined,stage:mode.value==='applications'?stage.value||undefined:undefined,
    overdueOnly:mode.value==='applications'&&overdueOnly.value?'true':undefined,candidateId:undefined,applicationId:undefined,newApplication:undefined,
    bucket:mode.value==='interviews'?bucket.value:undefined,day:mode.value==='interviews'?day.value||undefined:undefined,page:String(page.value)};
  if(Object.entries(q).every(([key,value])=>route.query[key]===value)&&!route.query.candidateId)await load();else await router.replace({path:'/talent-interviews',query:q});
}
async function changeMode(value:string|number){if(!await canLeave())return;mode.value=canManage.value&&value==='applications'?'applications':'interviews';scope.value=canManage.value?'all':'mine';await search();}
async function reset(){keyword.value='';stage.value='';day.value='';bucket.value='upcoming';overdueOnly.value=false;scope.value=canManage.value?'all':'mine';await search();}
async function clearOverdueFilter(){overdueOnly.value=false;await search();}
async function openApplication(row:Pick<TalentApplicationQueueItem,'candidateId'|'id'>){await router.push({query:{...route.query,candidateId:row.candidateId,applicationId:row.id}});}
async function closeDrawer(value:boolean){
  // Programmatic hiding during the edit handoff must not remove the selected application.
  if(value || formOpen.value || !drawerOpen.value)return;
  drawerOpen.value=false;
  await router.replace({query:{...route.query,candidateId:undefined,applicationId:undefined,newApplication:undefined}});
}
async function openEdit(id:string){
  if(!canEdit.value || id!==candidateId.value || !await canLeave())return;
  editCandidateId.value=id;formOpen.value=true;drawerOpen.value=false;
}
function closeForm(value:boolean){
  if(value)return;
  formOpen.value=false;drawerOpen.value=!!candidateId.value;
}
function onCandidateSaved(){void load();}
async function openExistingCandidate(id:string){
  if(!await canLeave())return;
  formOpen.value=false;
  if(id===candidateId.value){drawerOpen.value=true;return;}
  await router.push({query:{...route.query,candidateId:id,applicationId:undefined,newApplication:undefined}});
}
function openInterview(row:TalentInterviewView){void router.push({path:`/talent-interviews/${row.id}`,query:{...route.query,work:'interviews',candidateId:undefined,applicationId:undefined}});}
async function searchPeople(value=''){
  const token=++peopleGeneration;picking.value=true;pickerError.value='';
  try{const result=await talentPoolApi.list({keyword:value||undefined,page:1,pageSize:20});if(token===peopleGeneration)people.value=result.items;}
  catch(cause){if(token===peopleGeneration)pickerError.value=recruitmentError(cause);}finally{if(token===peopleGeneration)picking.value=false;}
}
async function addApplication(){if(canEdit.value&&picked.value){pickerOpen.value=false;await router.push({query:{...route.query,candidateId:picked.value,applicationId:undefined,newApplication:'1'}});}}
watch(()=>[route.params.id,route.query,canManage.value],()=>{syncQuery();void load();},{immediate:true});
onBeforeUnmount(()=>{++generation;++peopleGeneration;});
</script>

<template>
  <section v-if="route.params.id" v-loading="loading" class="interview-detail">
    <div class="detail-toolbar"><el-button :icon="ArrowLeft" @click="router.push({path:'/talent-interviews',query:route.query})">返回面试安排</el-button></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button link @click="load">重试</el-button></el-alert>
    <TalentInterviewPanel v-else-if="detail?.candidateId && canEdit" ref="singlePanel" :candidate-id="detail.candidateId" :invitation-id="detail.id" editable />
    <TalentInterviewContent v-else-if="detail" ref="singleContent" :invitation="detail" />
  </section>
  <BusinessListPage v-else variant="workflow" :loading="loading">
    <template #primary-action><el-button v-if="canEdit" type="primary" @click="pickerOpen=true;picked='';searchPeople()">新增应聘</el-button><el-button :icon="Refresh" @click="load">刷新</el-button></template>
    <template #filters>
      <QueryFilterPanel><el-input v-model="keyword" clearable placeholder="搜索候选人或应聘岗位" @keyup.enter="search()" />
        <el-select v-model="scope" aria-label="负责范围"><template v-if="mode==='applications'"><el-option label="全部授权应聘" value="all"/><el-option label="我负责的应聘" value="owned"/></template><template v-else><el-option v-if="canManage" label="全部授权面试" value="all"/><el-option v-if="canManage" label="我负责应聘的面试" value="responsible"/><el-option label="我参与的面试" value="mine"/><el-option v-if="canManage" label="我发起的面试" value="created"/></template></el-select>
        <el-select v-if="mode==='applications'" v-model="stage" clearable placeholder="全部应聘阶段" aria-label="应聘阶段"><el-option v-for="(label,value) in APPLICATION_STAGE_LABELS" :key="value" :label="label" :value="value"/></el-select>
        <el-date-picker v-else v-model="day" type="date" value-format="YYYY-MM-DD" placeholder="面试日期（北京时间）" aria-label="面试日期"/>
        <el-button type="primary" @click="search()">查询</el-button><el-button @click="reset">重置</el-button>
      </QueryFilterPanel>
      <el-tag v-if="mode==='applications'&&overdueOnly" closable @close="clearOverdueFilter">预计到岗已过</el-tag>
      <el-tabs v-if="canManage" :model-value="mode" @tab-change="changeMode"><el-tab-pane label="应聘办理" name="applications"/><el-tab-pane label="面试安排" name="interviews"/></el-tabs>
      <el-radio-group v-if="mode==='interviews'" v-model="bucket" class="interview-buckets" aria-label="面试待办" @change="search()"><el-radio-button value="upcoming">待进行 / 待确认结果</el-radio-button><el-radio-button value="feedback">待本人反馈</el-radio-button><el-radio-button value="history">历史记录</el-radio-button><el-radio-button value="all">全部</el-radio-button></el-radio-group>
    </template>
    <template #feedback><el-alert v-if="error" :title="error" type="error" :closable="false"><el-button link @click="load">重试</el-button></el-alert></template>
    <template #desktop-list>
      <el-table v-if="mode==='applications'" v-loading="loading" :data="applications" row-key="id" empty-text="暂无匹配的应聘记录" class="app-table">
        <el-table-column prop="candidateName" label="候选人" min-width="120"/><el-table-column prop="positionName" label="应聘岗位" min-width="150"/>
        <el-table-column label="进度" min-width="130"><template #default="{row}">{{ APPLICATION_STAGE_LABELS[row.stage as TalentApplicationStage] }}</template></el-table-column><el-table-column prop="ownerName" label="负责人" min-width="100"/>
        <el-table-column v-if="overdueOnly" label="预计到岗" width="115"><template #default="{row}">{{ row.expectedEntryDate ? row.expectedEntryDate.slice(0, 10) : '未填写' }}</template></el-table-column>
        <el-table-column label="面试安排" min-width="175"><template #default="{row}">{{ row.nextInterview?time(row.nextInterview.startsAt):'尚未安排' }}</template></el-table-column><el-table-column label="下一步" min-width="175"><template #default="{row}">{{ nextStep(row as TalentApplicationQueueItem) }}</template></el-table-column><el-table-column label="操作" width="90" fixed="right"><template #default="{row}"><el-button link type="primary" @click="openApplication(row as TalentApplicationQueueItem)">{{ canEdit ? '办理' : '查看' }}</el-button></template></el-table-column>
      </el-table>
      <el-table v-else v-loading="loading" :data="interviews" row-key="id" empty-text="暂无匹配的面试安排" class="app-table"><el-table-column prop="candidateNameSnapshot" label="候选人" min-width="120"/><el-table-column v-if="canManage" label="关联应聘" min-width="175"><template #default="{row}">{{ interviewApplicationLabel(row.application) }}</template></el-table-column><el-table-column label="北京时间" min-width="175"><template #default="{row}">{{ time(row.startsAt) }}</template></el-table-column><el-table-column label="进度" min-width="120"><template #default="{row}">{{ row.status==='scheduled'&&Date.parse(row.endsAt)<Date.now()?'待确认实际结果':INTERVIEW_STATUS_LABELS[row.status as keyof typeof INTERVIEW_STATUS_LABELS] }}</template></el-table-column><el-table-column label="参与人" min-width="160"><template #default="{row}">{{ row.participantNames.join('、') }}</template></el-table-column><el-table-column label="操作" width="130" fixed="right"><template #default="{row}"><el-button link type="primary" @click="openInterview(row as TalentInterviewView)">{{ bucket==='feedback'?'填写本人反馈':'查看安排' }}</el-button></template></el-table-column></el-table>
    </template>
    <template #mobile-list>
      <template v-if="mode==='applications'"><el-empty v-if="!loading&&!applications.length" description="暂无匹配的应聘记录" :image-size="50"/><MobileResultCard v-for="row in applications" :key="row.id"><template #title>{{ row.candidateName }} · {{ row.positionName }}</template><template #status>{{ APPLICATION_STAGE_LABELS[row.stage] }}</template><p>负责人：{{ row.ownerName||'未指定' }}</p><p v-if="overdueOnly">预计到岗：{{ row.expectedEntryDate?.slice(0, 10) || '未填写' }}</p><p v-else>面试：{{ row.nextInterview?time(row.nextInterview.startsAt):'尚未安排' }}</p><p>下一步：{{ nextStep(row as TalentApplicationQueueItem) }}</p><template #actions><el-button link type="primary" @click="openApplication(row as TalentApplicationQueueItem)">{{ canEdit ? '办理' : '查看' }}</el-button></template></MobileResultCard></template>
      <template v-else><el-empty v-if="!loading&&!interviews.length" description="暂无匹配的面试安排" :image-size="50"/><MobileResultCard v-for="row in interviews" :key="row.id"><template #title>{{ row.candidateNameSnapshot }}</template><template #status>{{ INTERVIEW_STATUS_LABELS[row.status] }}</template><p v-if="canManage">{{ interviewApplicationLabel(row.application) }}</p><p>{{ time(row.startsAt) }}（北京时间）</p><p>{{ row.participantNames.join('、') }}</p><template #actions><el-button link type="primary" @click="openInterview(row as TalentInterviewView)">{{ bucket==='feedback'?'填写本人反馈':'查看安排' }}</el-button></template></MobileResultCard></template>
    </template>
    <template #pagination><ListPagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" @change="search(false)"/></template>
    <template #detail>
      <TalentDetailDrawer v-if="!formOpen" ref="drawer" :model-value="drawerOpen" :candidate-id="candidateId" :application-match="applicationMatch" :start-application="newApplication" @update:model-value="closeDrawer" @edit="openEdit" @changed="load"/>
      <TalentFormDrawer v-if="canEdit" ref="formDrawer" :model-value="formOpen" :candidate-id="editCandidateId" @update:model-value="closeForm" @saved="onCandidateSaved" @open-existing="openExistingCandidate"/>
      <el-dialog v-if="canEdit" v-model="pickerOpen" title="选择人才，新增本次应聘" width="min(480px, 96vw)"><el-select v-model="picked" remote filterable :remote-method="searchPeople" :loading="picking" placeholder="搜索已有候选人" class="candidate-picker"><el-option v-for="person in people" :key="person.id" :value="person.id" :label="`${person.name} · ${person.appliedPosition||'岗位待填'}`"/></el-select><p>没有这位候选人时，请先在人才库新增资料。</p><el-alert v-if="pickerError" :title="pickerError" type="error" :closable="false"/><template #footer><el-button @click="pickerOpen=false">返回</el-button><el-button type="primary" :disabled="!picked" @click="addApplication">填写应聘</el-button></template></el-dialog>
    </template>
  </BusinessListPage>
</template>

<style scoped>
.interview-detail{min-width:0;max-width:960px;margin:auto;padding:16px}.detail-toolbar{margin-bottom:16px}.candidate-picker{width:100%}.interview-buckets{margin:10px 0}.mobile-result-card p{font-size:13px;margin:8px 0;overflow-wrap:anywhere}.query-filter-panel{display:flex;flex-wrap:wrap;gap:10px}.query-filter-panel>.el-input{flex:2;min-width:200px}.query-filter-panel>.el-select,.query-filter-panel>:deep(.el-date-editor){flex:1;min-width:170px}.interview-buckets :deep(.el-radio-button__inner){white-space:normal}
@media(max-width:768px){.query-filter-panel>*{width:100%;flex-basis:100%}.interview-buckets{display:flex;flex-wrap:wrap}.interview-detail{padding:8px}}
</style>
