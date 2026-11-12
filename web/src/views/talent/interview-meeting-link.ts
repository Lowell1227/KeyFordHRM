const officialMeetingPrefix = /^https:\/\/meeting\.tencent\.com(?::443)?(?:[/?#]|$)/i;

export function safeTencentMeetingLink(value: string): string | null {
  // Check raw input before URL can normalize credentials, controls or slashes.
  if (/[\\\p{Cc}\p{Cf}]/u.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) return null;
  const trimmed = value.trim();
  if (trimmed.length > 1000 || /\s/.test(trimmed)
    || !officialMeetingPrefix.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' && url.hostname === 'meeting.tencent.com' && !url.username && !url.password
      && (!url.port || url.port === '443') ? url.href : null;
  } catch { return null; }
}

export function extractTencentMeetingLink(text: string): { status: 'single'; url: string } | { status: 'none' | 'multiple' } {
  const links: string[] = [];
  let ambiguous = false;
  // Retain tabs/controls/backslashes inside tokens so validation rejects, rather than repairs, them.
  const candidates = text.matchAll(/[a-z][a-z\d+.-]*:\/\/[^ \r\n<>"'\u201c\u201d\u2018\u2019\u3001\u3002\u3008-\u3011\uff01\uff08\uff09\uff0c\uff1a\uff1b\uff1f]+/gi);
  for (const match of candidates) {
    const before = text[(match.index ?? 0) - 1];
    if (before && !/[ \r\n:([{"'<\u201c\u2018\u3001\u3002\u3008-\u3011\uff01\uff08\uff09\uff0c\uff1a\uff1b\uff1f]/.test(before)) continue;
    if (/(?:javascript|data|vbscript):$/i.test(text.slice(0, match.index))) continue;
    // Inspect the uncut authority so Chinese punctuation cannot turn a spoof host into the official host.
    const authorityStart = (match.index ?? 0) + match[0].indexOf('://') + 3;
    const authority = text.slice(authorityStart).split(/[/?# \r\n<>"'\u201c\u201d\u2018\u2019]/, 1)[0];
    if (!/^meeting\.tencent\.com(?::443)?$/i.test(authority ?? '')) continue;
    const parts = match[0].split(/[),;\]\uFF0C\uFF1B\uFF09\u3011]+[(\[\uFF08]*(?=[a-z][a-z\d+.-]*:\/\/)/i);
    for (const part of parts) {
      if (!officialMeetingPrefix.test(part) || part.slice(part.indexOf('://') + 3).includes('://')) continue;
      const hasQuery = /[?#]/.test(part);
      if (hasQuery && /[([{]/.test(before ?? '') && /[)\]}][.,;!]*$/.test(part)) { ambiguous = true; continue; }
      const candidate = hasQuery ? part : part.replace(/[)\]},.;!]+$/, '');
      const link = safeTencentMeetingLink(candidate);
      if (link) links.push(link);
    }
  }
  if (ambiguous) return { status: 'none' };
  if (links.length > 1) return { status: 'multiple' };
  return links.length === 1 ? { status: 'single', url: links[0]! } : { status: 'none' };
}
