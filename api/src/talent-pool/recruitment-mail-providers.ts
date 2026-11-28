export const RECRUITMENT_MAIL_PROVIDERS = {
  alimail: { label: "阿里企业邮箱", host: "imap.qiye.aliyun.com" },
  qq: { label: "QQ 邮箱", host: "imap.qq.com" },
  netease163: { label: "网易 163 邮箱", host: "imap.163.com" },
  netease126: { label: "网易 126 邮箱", host: "imap.126.com" },
} as const;
export type RecruitmentMailProvider = keyof typeof RECRUITMENT_MAIL_PROVIDERS;
