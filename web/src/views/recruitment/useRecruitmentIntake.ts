import { computed, onScopeDispose, reactive, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { recruitmentIntakesApi } from '@/api/recruitment-intakes.api';
import { talentPoolApi } from '@/api/talent-pool.api';
import { talentRecruitmentApi } from '@/api/talent-recruitment.api';
import { useAuthStore } from '@/stores/auth.store';
import { useTalentPermissions } from '@/views/talent/useTalentPermissions';
import { prepareTalentFile, TALENT_FILE_EXTENSIONS, TALENT_MAX_FILE_BYTES } from '@/views/talent/components/talent-file-upload';
import { talentSalaryYuan } from '@/utils/talent-salary';
import type { IntakeConfirm, IntakeCreate, IntakeFields, IntakeState, RecruitmentIntake } from '@/types/recruitment-intake.types';
import type { TalentApplicationView, TalentCandidateDetail, TalentCandidateInput, TalentPhoneCheckResult, TalentSourceChannel } from '@/types/talent.types';
import { applyIntakeSuggestions, intakeError, validateIntakeDraft } from './intake-presentation';

function compactDraft(value: TalentCandidateInput): TalentCandidateInput {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== '' && item !== undefined)) as TalentCandidateInput;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function useRecruitmentIntake(onSaved?: () => Promise<void>) {
  const auth = useAuthStore(), { canEdit } = useTalentPermissions();
  const current = ref<RecruitmentIntake | null>(null), opened = ref(false), loading = ref(false), busy = ref(false);
  const preparing = ref(false);
  const error = ref(''), result = ref(''), revision = ref(0), blocked = ref(false), unknown = ref(false);
  const draft = ref<TalentCandidateInput>({}), application = reactive({ deptId: '', positionName: '', ownerId: '' });
  const form = reactive({ state: 'awaiting_resume' as IntakeState, ownerId: '', sourceChannel: '' as TalentSourceChannel | '', postingId: '', demandId: '', positionName: '', sourceNotes: '', nextFollowUpAt: '' });
  const phone = ref<TalentPhoneCheckResult | null>(null), checkedPhone = ref(''), checkingPhone = ref(false), reuseExisting = ref(false);
  const existingProfile = ref<TalentCandidateDetail | null>(null), existingApplications = ref<TalentApplicationView[]>([]), existingApplicationId = ref(''), existingLoading = ref(false), existingError = ref('');
  let existingLoad: Promise<void> | null = null;
  const chosenSuggestions = ref<string[]>([]), closeReason = ref('');
  const fieldErrors = ref<Record<string, string>>({});
  const createIntent = ref<IntakeCreate | null>(null), confirmIntent = ref<IntakeConfirm | null>(null);
  let epoch = 0, phoneEpoch = 0;
  const baseline = ref('');
  let parseTimer: ReturnType<typeof setTimeout> | undefined;
  function stopPolling() { if (parseTimer !== undefined) clearTimeout(parseTimer); parseTimer = undefined; }
  function sourceVersion(row: RecruitmentIntake, includeState = true) {
    return JSON.stringify([row.id, row.ownerId, includeState ? row.state : null, row.sourceChannel, row.postingId, row.demandId, row.positionName, row.sourceNotes,
      row.nextFollowUpAt, row.candidateDraft, row.applicationDraft, row.files, row.associatedFromIds, row.associatedToId,
      row.candidateId, row.applicationId, row.transport, row.mail]);
  }
  function pollParsing(row: RecruitmentIntake) {
    stopPolling(); if (row.parseStatus !== 'processing' || !canEdit.value || !opened.value) return;
    const token = epoch, id = row.id, source = sourceVersion(row), unchangedFields = sourceVersion(row, false), deadline = Date.now() + 150000;
    async function next() {
      parseTimer = undefined;
      if (token !== epoch || !canEdit.value || !opened.value || current.value?.id !== id) return;
      if (Date.now() >= deadline) { blocked.value = true; error.value = '解析等待已达时限，请刷新记录确认最终状态；手填资料已保留。'; return; }
      try {
        const latest = await recruitmentIntakesApi.detail(id);
        if (token !== epoch || !canEdit.value || !opened.value || current.value?.id !== id) return;
        current.value = latest;
        const ownTerminal = latest.revision === row.revision + 1 && sourceVersion(latest, false) === unchangedFields &&
          ((latest.parseStatus === 'failed' && latest.state === 'needs_material') || (latest.parseStatus === 'succeeded' && latest.state === 'pending_review'));
        const unchangedProcessing = latest.revision === row.revision && latest.parseStatus === 'processing' && sourceVersion(latest) === source;
        if (!ownTerminal && !unchangedProcessing) { blocked.value = true; error.value = '解析期间收件资料已变化，手填内容已保留，请核对新版本。'; return; }
        if (ownTerminal) {
          if (form.state === row.state) form.state = latest.state;
          const saved = JSON.parse(baseline.value) as IntakeFields;
          if (saved.state === row.state) { saved.state = latest.state; baseline.value = JSON.stringify(saved); }
          result.value = latest.parseStatus === 'succeeded' ? '解析已完成，请逐项核对建议。' : '';
        }
        revision.value = latest.revision;
        if (latest.parseStatus === 'processing') parseTimer = setTimeout(next, 2000);
      } catch (cause) { if (token === epoch) { blocked.value = true; error.value = intakeError(cause); } }
    }
    parseTimer = setTimeout(next, 2000);
  }
  const editable = computed(() => canEdit.value && !['completed', 'closed'].includes(current.value?.state || '') && !current.value?.associatedToId);
  function fields(): IntakeFields {
    return { state: form.state, ownerId: form.ownerId, sourceChannel: form.sourceChannel || null, postingId: form.postingId || null,
      demandId: form.demandId || null, positionName: form.positionName.trim() || null, sourceNotes: form.sourceNotes.trim() || null,
      nextFollowUpAt: form.nextFollowUpAt ? new Date(form.nextFollowUpAt).toISOString() : null,
      candidateDraft: compactDraft({ ...draft.value, sourceChannel: form.sourceChannel || undefined }), applicationDraft: { ...(application.deptId ? { deptId: application.deptId } : {}),
        ...(application.positionName.trim() ? { positionName: application.positionName.trim() } : {}), ...(application.ownerId ? { ownerId: application.ownerId } : {}) } };
  }
  const dirty = computed(() => {
    try { return JSON.stringify(fields()) !== baseline.value; } catch { return true; }
  });
  function fill(row?: RecruitmentIntake) {
    Object.assign(form, { state: row?.state || 'awaiting_resume', ownerId: row?.ownerId || auth.user?.id || '', sourceChannel: row?.sourceChannel || '',
      postingId: row?.postingId || '', demandId: row?.demandId || '', positionName: row?.positionName || '', sourceNotes: row?.sourceNotes || '', nextFollowUpAt: row?.nextFollowUpAt || '' });
    draft.value = copy(row?.candidateDraft || { gender: 'unknown' });
    draft.value.sourceChannel = form.sourceChannel || undefined;
    if (draft.value.expectSalaryMin !== undefined || draft.value.expectSalaryMax !== undefined) {
      const salary = talentSalaryYuan(draft.value); draft.value.expectSalaryMinYuan = salary.min; draft.value.expectSalaryMaxYuan = salary.max;
      delete draft.value.expectSalaryMin; delete draft.value.expectSalaryMax;
    }
    Object.assign(application, { deptId: row?.applicationDraft?.deptId || '', positionName: row?.applicationDraft?.positionName || row?.positionName || '', ownerId: row?.applicationDraft?.ownerId || row?.ownerId || auth.user?.id || '' });
    baseline.value = JSON.stringify(fields());
  }
  function reset() {
    stopPolling();
    ++epoch; ++phoneEpoch; current.value = null; opened.value = false; loading.value = false; busy.value = false; preparing.value = false;
    error.value = ''; result.value = ''; blocked.value = false; unknown.value = false; revision.value = 0;
    createIntent.value = null; confirmIntent.value = null; phone.value = null; checkedPhone.value = ''; reuseExisting.value = false;
    checkingPhone.value = false; chosenSuggestions.value = []; closeReason.value = ''; fieldErrors.value = {}; fill();
    existingProfile.value = null; existingApplications.value = []; existingApplicationId.value = ''; existingLoading.value = false; existingError.value = ''; existingLoad = null;
  }
  async function open(id: string) {
    if (!canEdit.value || busy.value) return;
    reset(); const token = epoch; opened.value = true; loading.value = true;
    try { const row = await recruitmentIntakesApi.detail(id); if (token !== epoch || !canEdit.value) return; current.value = row; revision.value = row.revision; fill(row); pollParsing(row); }
    catch (cause) { if (token === epoch) error.value = intakeError(cause); }
    finally { if (token === epoch) loading.value = false; }
  }
  function start(state: 'awaiting_resume' | 'pending_review', context: Partial<IntakeFields> = {}) {
    if (!canEdit.value || busy.value) return;
    if (createIntent.value && unknown.value) { opened.value = true; return; }
    reset(); opened.value = true; Object.assign(form, { ...context, state, sourceChannel: context.sourceChannel || '', postingId: context.postingId || '', demandId: context.demandId || '' });
    if (context.applicationDraft) Object.assign(application, context.applicationDraft);
    if (context.candidateDraft) draft.value = copy(context.candidateDraft);
    baseline.value = JSON.stringify(fields());
  }
  async function accept(row: RecruitmentIntake, message: string) {
    const changedRecord = current.value && current.value.id !== row.id;
    current.value = row; revision.value = row.revision;
    if (changedRecord) {
      fill(row); chosenSuggestions.value = []; phone.value = null; checkedPhone.value = ''; reuseExisting.value = false;
      existingProfile.value = null; existingApplications.value = []; existingApplicationId.value = '';
    } else form.state = row.state;
    baseline.value = JSON.stringify(fields()); error.value = ''; result.value = message;
    pollParsing(row);
    if (onSaved) { try { await onSaved(); } catch { result.value = `${message} 列表刷新失败，请手动刷新列表。`; } }
  }
  function failure(cause: unknown, operation: 'save' | 'confirm' | 'other') {
    const status = (cause as { response?: { status?: number } }).response?.status;
    unknown.value = !status || status >= 500;
    blocked.value = [403, 404, 409].includes(status || 0) || (unknown.value && operation !== 'confirm' && !!current.value);
    error.value = unknown.value ? '暂不能确认操作结果，原内容已保留。请先核对本次结果，不要另开重复记录。' : intakeError(cause);
    if (!unknown.value && operation === 'confirm') confirmIntent.value = null;
    if (!unknown.value && !current.value && status !== 409) createIntent.value = null;
  }
  async function save() {
    if (!editable.value || busy.value || blocked.value || (unknown.value && !!confirmIntent.value)) return;
    if (current.value?.parseStatus === 'processing') { error.value = '解析中，手填内容已保留，请等待解析结束再保存。'; return; }
    fieldErrors.value = validateIntakeDraft(draft.value);
    if (Object.keys(fieldErrors.value).length) { error.value = '请核对标红的候选人字段。'; return; }
    if (!form.ownerId || form.sourceNotes.length > 2000 || form.positionName.length > 100) { error.value = '请核对经办负责人、岗位和来源说明。'; return; }
    let body: IntakeFields;
    try { body = fields(); } catch { error.value = '请填写有效的下次跟进时间。'; return; }
    const token = epoch, row = current.value;
    if (!row && !createIntent.value) createIntent.value = { ...copy(body), requestId: crypto.randomUUID() };
    busy.value = true; error.value = ''; result.value = '';
    try {
      const saved = row ? await recruitmentIntakesApi.update(row.id, { ...body, expectedRevision: revision.value }) : await recruitmentIntakesApi.create(copy(createIntent.value!));
      if (token !== epoch || !canEdit.value) return;
      createIntent.value = null; unknown.value = false; await accept(saved, '收件草稿已保存。');
    } catch (cause) { if (token === epoch) failure(cause, 'save'); }
    finally { if (token === epoch) busy.value = false; }
  }
  async function refresh() {
    const row = current.value;
    if (!canEdit.value || !row || busy.value) return null;
    const token = epoch; loading.value = true;
    try { const latest = await recruitmentIntakesApi.detail(row.id); if (token !== epoch) return; current.value = latest;
      if (['completed', 'closed'].includes(latest.state)) { unknown.value = false; blocked.value = false; confirmIntent.value = null; result.value = '已取得最新办理结果。'; }
      return current.value;
    } catch (cause) { if (token === epoch) { blocked.value = true; error.value = intakeError(cause); } return null; }
    finally { if (token === epoch) loading.value = false; }
  }
  async function reconfirm() {
    if (!canEdit.value || !current.value || busy.value || (unknown.value && !!confirmIntent.value)) return;
    const row = await refresh(), token = epoch;
    if (!row || !editable.value || loading.value) return;
    try { await ElMessageBox.confirm(`最新记录为版本 ${row.revision}。保留当前输入，核对后使用此版本继续办理吗？`, '重新核对版本', { confirmButtonText: '已核对，保留输入', cancelButtonText: '暂不继续', type: 'warning' }); }
    catch { return; }
    if (token !== epoch || !canEdit.value || busy.value || current.value !== row) return;
    revision.value = row.revision; blocked.value = false; unknown.value = false; error.value = ''; confirmIntent.value = null;
  }
  async function checkPhone() {
    const value = draft.value.phone?.trim() || '';
    if (!canEdit.value || !/^1\d{10}$/.test(value) || unknown.value) { phone.value = null; checkedPhone.value = ''; return; }
    const token = ++phoneEpoch; checkingPhone.value = true;
    try { const result = await talentPoolApi.checkPhone(value); if (token !== phoneEpoch || !canEdit.value || value !== draft.value.phone?.trim()) return; phone.value = result; checkedPhone.value = value; }
    catch (cause) { if (token === phoneEpoch) { error.value = intakeError(cause); checkedPhone.value = ''; } }
    finally { if (token === phoneEpoch) checkingPhone.value = false; }
  }
  async function confirm(mode: IntakeConfirm['mode']) {
    const row = current.value;
    if (!editable.value || !row || busy.value || preparing.value || loading.value || blocked.value || checkingPhone.value) return;
    const context = epoch; preparing.value = true;
    try {
    if (confirmIntent.value && confirmIntent.value.mode !== mode) { error.value = '请先核对原办理结果，不能改用另一种入库方式。'; return; }
    if (!confirmIntent.value) {
      if (form.state !== 'pending_review') { error.value = '请先补齐资料并选择待核对状态。'; return; }
      if (!form.sourceChannel) { fieldErrors.value = { sourceChannel: '请选择实际资料来源' }; error.value = '实际来源待核实，请先核对并保存。'; return; }
      draft.value.sourceChannel = form.sourceChannel;
      fieldErrors.value = validateIntakeDraft(draft.value, true);
      if (Object.keys(fieldErrors.value).length) { error.value = '请核对标红的候选人字段。'; return; }
      if (checkedPhone.value !== draft.value.phone?.trim()) { await checkPhone(); if (checkedPhone.value !== draft.value.phone?.trim()) return; }
      if (phone.value?.exists && (!reuseExisting.value || !phone.value.candidate?.id)) { error.value = '手机号已有档案，请核实同一人后明确确认复用；不会覆盖原资料。'; return; }
      if (phone.value?.exists) { await loadExisting(); if (!existingProfile.value || existingError.value) { error.value = '请先读取并核对已有档案及应聘。'; return; } }
      const existingApp = existingApplications.value.find(item => item.id === existingApplicationId.value);
      if (mode === 'candidate_application' && existingApplicationId.value && (!reuseExisting.value || !existingApp || existingApp.candidateId !== phone.value?.candidate?.id || existingApp.deptId !== application.deptId || existingApp.positionName !== application.positionName.trim())) { error.value = '请重新核对已有应聘的人员、部门和岗位。'; return; }
      if (mode === 'candidate_application' && existingApp && existingApp.intentDemandId && existingApp.intentDemandId !== (form.demandId || null)) {
        error.value = '已有应聘的意向需求与本次收件不同，请先到原应聘核对归属；当前输入已保留，不会自动改归属。'; return;
      }
      if (mode === 'candidate_application' && existingApp) {
        if (!Number.isSafeInteger(existingApp.revision) || existingApp.revision < 0) { error.value = '已有应聘版本不可用，请重新读取原应聘后核对。'; return; }
        if (!existingApp.intentDemandId && form.demandId) {
          const selection = JSON.stringify([existingApplicationId.value, form.demandId, form.sourceChannel, application]);
          try { await ElMessageBox.confirm('该应聘尚无意向需求。本次将明确关联到已核对的收件需求，保留原应聘来源和历史录用快照。', '确认首次关联意向需求', { confirmButtonText: '关联需求并复用应聘', cancelButtonText: '继续核对', type: 'warning' }); }
          catch { return; }
          if (context !== epoch || selection !== JSON.stringify([existingApplicationId.value, form.demandId, form.sourceChannel, application])) return;
        }
      }
      if (mode === 'candidate_application' && !existingApplicationId.value && (!application.deptId || !application.positionName.trim() || !application.ownerId)) { error.value = '请明确确认本次应聘的部门、岗位和负责人。'; return; }
      if (context !== epoch || !canEdit.value || current.value?.id !== row.id) return;
      if (dirty.value) {
        await save();
        if (context !== epoch || !canEdit.value || blocked.value || unknown.value || dirty.value || current.value?.id !== row.id || current.value?.state !== 'pending_review') return;
      }
      confirmIntent.value = { requestId: crypto.randomUUID(), expectedRevision: revision.value, mode,
        ...(phone.value?.exists ? { existingCandidateId: phone.value.candidate!.id } : { candidate: { ...compactDraft(draft.value), ownerId: form.ownerId } }),
        ...(mode === 'candidate_application' ? { application: { deptId: application.deptId, positionName: application.positionName.trim(), ownerId: application.ownerId,
          intentDemandId: form.demandId || null, sourceChannel: form.sourceChannel || null }, ...(existingApp ? { existingApplicationId: existingApp.id, expectedExistingApplicationRevision: existingApp.revision } : {}) } : {}) };
    }
    const token = epoch; busy.value = true; error.value = ''; result.value = '';
    try { const saved = await recruitmentIntakesApi.confirm(row.id, copy(confirmIntent.value)); if (token !== epoch || !canEdit.value) return;
      unknown.value = false; confirmIntent.value = null; await accept(saved, mode === 'candidate_only' ? '已入库，未创建应聘。' : '已入库并建立本次应聘。');
    } catch (cause) { if (token === epoch) failure(cause, 'confirm'); }
    finally { if (token === epoch) busy.value = false; }
    } finally { if (context === epoch) preparing.value = false; }
  }
  async function loadExisting() {
    const candidateId = phone.value?.candidate?.id;
    if (!canEdit.value || !reuseExisting.value || !candidateId) return;
    if (existingProfile.value?.id === candidateId) return;
    if (existingLoad) return existingLoad;
    const token = epoch, phoneToken = phoneEpoch; existingLoading.value = true; existingError.value = '';
    existingLoad = (async () => {
      try {
        const [profile, applications] = await Promise.all([talentPoolApi.detail(candidateId), talentRecruitmentApi.applications(candidateId)]);
        if (token !== epoch || phoneToken !== phoneEpoch || !canEdit.value || !reuseExisting.value) return;
        if (profile.id !== candidateId || applications.some(item => item.candidateId !== candidateId)) throw new Error('Invalid candidate context');
        existingProfile.value = profile; existingApplications.value = applications;
      } catch (cause) { if (token === epoch && phoneToken === phoneEpoch) { existingError.value = intakeError(cause); existingProfile.value = null; existingApplications.value = []; } }
      finally { if (token === epoch && phoneToken === phoneEpoch) { existingLoading.value = false; existingLoad = null; } }
    })();
    return existingLoad;
  }
  async function material(action: () => Promise<RecruitmentIntake>, message: string) {
    if (!editable.value || !current.value || busy.value || blocked.value || unknown.value) return;
    if (dirty.value) { error.value = '请先保存当前核对草稿。'; return; }
    const token = epoch; busy.value = true; error.value = ''; result.value = '';
    try { const row = await action(); if (token !== epoch || !canEdit.value) return; await accept(row, message); }
    catch (cause) { if (token === epoch) failure(cause, 'other'); }
    finally { if (token === epoch) busy.value = false; }
  }
  async function parse(fileId?: string) {
    const row = current.value; if (!row) return;
    await material(() => recruitmentIntakesApi.parse(row.id, revision.value, fileId), '解析已开始，手填资料会保留。');
  }
  function applySuggestions() {
    if (!editable.value || busy.value || unknown.value || blocked.value) return;
    draft.value = applyIntakeSuggestions(draft.value, current.value?.parseResult?.fields || {}, chosenSuggestions.value); chosenSuggestions.value = [];
  }
  async function upload(file: File) {
    const row = current.value; if (!row) return;
    if (!TALENT_FILE_EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase() || '') || !file.size) { error.value = '请选择 PDF、Word、JPG 或 PNG 简历。'; return; }
    await material(async () => {
      const prepared = await prepareTalentFile(file);
      if (!canEdit.value || current.value?.id !== row.id) throw { response: { status: 403 } };
      if (prepared.size > TALENT_MAX_FILE_BYTES) throw { response: { status: 400, data: { message: '简历文件不能超过10MB。' } } };
      return recruitmentIntakesApi.upload(row.id, revision.value, prepared);
    }, '简历已上传，请核对或发起解析。');
  }
  async function close() {
    const row = current.value; if (!row) return;
    if (!closeReason.value.trim() || closeReason.value.length > 2000) { error.value = '请填写关闭原因（最多2000字）。'; return; }
    await material(() => recruitmentIntakesApi.close(row.id, { expectedRevision: revision.value, reason: closeReason.value.trim() }), '收件已关闭，来源和原跟进记录保留。');
  }
  async function associate(target: RecruitmentIntake) {
    const row = current.value; if (!row || row.transport !== 'email' || target.state !== 'awaiting_resume') return;
    await material(() => recruitmentIntakesApi.associate(row.id, { expectedRevision: revision.value, targetIntakeId: target.id, expectedTargetRevision: target.revision }), '已关联原待收简历，来源及跟进记录保留。');
  }
  watch(() => draft.value.phone, () => { ++phoneEpoch; phone.value = null; checkedPhone.value = ''; reuseExisting.value = false; checkingPhone.value = false; existingProfile.value = null; existingApplications.value = []; existingApplicationId.value = ''; existingLoad = null; });
  watch(() => form.sourceChannel, source => { draft.value.sourceChannel = source || undefined; });
  watch(reuseExisting, reuse => { if (reuse) void loadExisting(); else { existingApplicationId.value = ''; existingProfile.value = null; existingApplications.value = []; } });
  watch(() => ({ ...draft.value }), value => { fieldErrors.value = validateIntakeDraft(value); });
  watch([() => auth.user?.id, canEdit], () => { reset(); });
  watch(opened, value => { if (!value) stopPolling(); });
  onScopeDispose(() => { ++epoch; ++phoneEpoch; stopPolling(); });
  fill();
  return { current, opened, loading, busy: computed(() => busy.value || preparing.value), editable, error, result, revision, blocked, unknown, form, draft, application, dirty,
    phone, checkingPhone, reuseExisting, chosenSuggestions, closeReason, createIntent, confirmIntent, fieldErrors,
    existingProfile, existingApplications, existingApplicationId, existingLoading, existingError,
    open, start, save, refresh, reconfirm, checkPhone, loadExisting, confirm, parse, applySuggestions, upload, close, associate, reset };
}
