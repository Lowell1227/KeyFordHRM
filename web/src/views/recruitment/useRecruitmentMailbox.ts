import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { recruitmentIntakesApi } from '@/api/recruitment-intakes.api';
import { useAuthStore } from '@/stores/auth.store';
import type { MailboxChoice } from '@/types/recruitment-intake.types';
import { intakeError } from './intake-presentation';

export function useRecruitmentMailbox(canEdit: Readonly<Ref<boolean>>, onSynced: () => Promise<void>) {
  const auth = useAuthStore();
  const mailboxes = ref<MailboxChoice[]>([]), selectedMailboxId = ref('');
  const mailboxConfigured = ref<boolean | null>(null), mailboxError = ref(''), mailMessage = ref('');
  const syncing = ref(false), mailboxesLoading = ref(false);
  let context = 0, statusVersion = 0, choicesVersion = 0;
  async function readMailboxStatus() {
    const token = ++statusVersion, actor = auth.user?.id, id = selectedMailboxId.value;
    mailboxConfigured.value = null; mailboxError.value = '';
    if (!canEdit.value || !id) return;
    try {
      const result = await recruitmentIntakesApi.mailStatus(id);
      if (token === statusVersion && canEdit.value && actor === auth.user?.id && id === selectedMailboxId.value) mailboxConfigured.value = result.configured;
    } catch (cause) { if (token === statusVersion && canEdit.value && actor === auth.user?.id) mailboxError.value = intakeError(cause); }
  }
  async function loadMailboxes() {
    if (!canEdit.value) return;
    const token = ++choicesVersion, actor = auth.user?.id;
    mailboxesLoading.value = true; mailboxError.value = '';
    try {
      const choices = await recruitmentIntakesApi.mailboxes();
      if (token !== choicesVersion || !canEdit.value || actor !== auth.user?.id) return;
      mailboxes.value = choices;
      const usable = choices.filter(row => row.enabled && row.configured);
      const previous = selectedMailboxId.value;
      if (!usable.some(row => row.id === previous)) selectedMailboxId.value = usable.length === 1 ? usable[0]!.id : '';
      if (!selectedMailboxId.value) mailboxConfigured.value = usable.length ? null : false;
      else if (previous === selectedMailboxId.value) await readMailboxStatus();
    } catch (cause) {
      if (token === choicesVersion && canEdit.value && actor === auth.user?.id) { mailboxes.value = []; mailboxConfigured.value = null; mailboxError.value = intakeError(cause); }
    } finally { if (token === choicesVersion) mailboxesLoading.value = false; }
  }
  async function syncMailbox() {
    const choice = mailboxes.value.find(row => row.id === selectedMailboxId.value);
    if (!canEdit.value || !choice?.enabled || !choice.configured || !mailboxConfigured.value || syncing.value) return;
    const token = context, actor = auth.user?.id;
    syncing.value = true; mailboxError.value = ''; mailMessage.value = '';
    try {
      const response = await recruitmentIntakesApi.syncMail(10, choice.id);
      if (token !== context || !canEdit.value || actor !== auth.user?.id) return;
      mailMessage.value = `${choice.name}：本次收到 ${response.synced} 条，跳过 ${response.skipped} 条，失败 ${response.failed} 条。${response.complete && !response.hasMore && response.failed === 0 ? '本批读取完成。' : '尚未读完，请核对后继续读取。'}`;
      await onSynced();
    } catch (cause) { if (token === context && canEdit.value && actor === auth.user?.id) mailboxError.value = intakeError(cause); }
    finally { syncing.value = false; }
  }
  watch(selectedMailboxId, () => { mailMessage.value = ''; void readMailboxStatus(); });
  watch([canEdit, () => auth.user?.id], () => {
    context++; statusVersion++; choicesVersion++;
    mailboxes.value = []; selectedMailboxId.value = ''; mailboxConfigured.value = null;
    mailboxError.value = ''; mailMessage.value = ''; mailboxesLoading.value = false;
    if (canEdit.value) void loadMailboxes();
  }, { immediate: true });
  onScopeDispose(() => { context++; statusVersion++; choicesVersion++; });
  return { mailboxes, selectedMailboxId, mailboxConfigured, mailboxError, mailMessage, syncing, mailboxesLoading,
    readMailboxStatus, loadMailboxes, syncMailbox };
}
