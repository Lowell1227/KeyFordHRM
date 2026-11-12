const formatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function formatInterviewTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function interviewTimeToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) throw new Error('请填写完整的北京时间');
  const date = new Date(`${value.replace(' ', 'T')}+08:00`);
  if (!Number.isFinite(date.getTime()) || formatInterviewTime(date.toISOString()) !== value) throw new Error('北京时间无效');
  return date.toISOString();
}
