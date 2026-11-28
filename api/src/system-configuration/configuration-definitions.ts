import { NotFoundException } from "@nestjs/common";
import { RECRUITMENT_MAIL_PROVIDERS } from "@/talent-pool/recruitment-mail-providers";

export type ConfigurationValues = Record<string, string | boolean>;
export type FieldDefinition = {
  key: string;
  label: string;
  type: "text" | "secret" | "boolean" | "datetime" | "textarea" | "select";
  required: boolean;
  help?: string;
  options?: Array<{ label: string; value: string }>;
};
export type ConfigurationDefinition = {
  id: string;
  title: string;
  description: string;
  fields: FieldDefinition[];
  enabledKey?: string;
  dependency?: boolean;
};
const f = (
  key: string,
  label: string,
  type: FieldDefinition["type"] = "text",
  required = true,
  help?: string,
): FieldDefinition => ({
  key,
  label,
  type,
  required,
  ...(help ? { help } : {}),
});
export const CONFIGURATION_PREFIX = "integration_configuration:";
export const DEFINITIONS: ConfigurationDefinition[] = [
  {
    id: "dingtalk-app",
    title: "钉钉企业应用与登录",
    description:
      "各钉钉功能共用此应用身份；连接核验仅验证应用凭据，不代表消息、日程或考勤权限已验收。",
    fields: [
      f("DINGTALK_CORP_ID", "企业 ID"),
      f("DINGTALK_APP_KEY", "AppKey"),
      f("DINGTALK_APP_SECRET", "AppSecret", "secret"),
      f("DINGTALK_AGENT_ID", "Agent ID", "text", false),
      f("DINGTALK_REDIRECT_URI", "登录回调地址", "text", false),
    ],
  },
  {
    id: "dingtalk-notifications",
    title: "钉钉通知通道",
    description:
      "平台通道开关；通知业务总开关继续在原通知设置中维护。核对配置不会发送消息。",
    enabledKey: "DINGTALK_NOTIFICATION_ENABLED",
    dependency: true,
    fields: [
      f("DINGTALK_NOTIFICATION_ENABLED", "启用钉钉通知通道", "boolean", false),
    ],
  },
  {
    id: "dingtalk-calendar",
    title: "面试日程",
    description:
      "使用共享应用身份。核对配置不会创建日程，真实日程权限需要另行验收。",
    enabledKey: "DINGTALK_INTERVIEW_CALENDAR_ENABLED",
    dependency: true,
    fields: [
      f(
        "DINGTALK_INTERVIEW_CALENDAR_ENABLED",
        "启用面试日程",
        "boolean",
        false,
      ),
    ],
  },
  {
    id: "recruitment-demand",
    title: "钉钉招聘需求",
    description:
      "仅按指定审批表单读取；核验样本不导入或修改招聘需求。读取范围证明仍须按原流程确认。",
    dependency: true,
    fields: [
      f("DINGTALK_RECRUITMENT_PROCESS_CODE", "审批表单"),
      f("DINGTALK_RECRUITMENT_DEPARTMENT_CONTROL_ID", "部门字段"),
      f("DINGTALK_RECRUITMENT_POSITION_CONTROL_ID", "岗位字段"),
      f("DINGTALK_RECRUITMENT_HEADCOUNT_CONTROL_ID", "人数字段"),
      f(
        "DINGTALK_RECRUITMENT_VERIFIED_SCOPE",
        "读取范围证明",
        "textarea",
        false,
        "沿用已获确认的范围证明，不可用连接成功替代范围验收。",
      ),
    ],
  },
  {
    id: "payroll-attendance",
    title: "钉钉考勤",
    description: "不获取考勤数据。正式同步仍受薪酬主体授权及预览隔离限制。",
    dependency: true,
    enabledKey: "DINGTALK_ATTENDANCE_SYNC_ENABLED",
    fields: [
      f("DINGTALK_ATTENDANCE_SYNC_ENABLED", "启用考勤同步", "boolean", false),
      f(
        "DINGTALK_ATTENDANCE_WORKFLOW_READ_CONFIRMED",
        "已确认审批读取权限",
        "boolean",
        false,
      ),
    ],
  },
  {
    id: "recruitment-mail",
    title: "招聘邮箱",
    description:
      "支持阿里企业邮箱、QQ 和网易邮箱；各邮箱独立只读指定文件夹。应用配置不会自动同步、搬移或标记邮件。",
    enabledKey: "RECRUITMENT_MAIL_ENABLED",
    fields: [
      f("RECRUITMENT_MAIL_NAME", "邮箱名称", "text", false),
      {
        ...f("RECRUITMENT_MAIL_PROVIDER", "邮箱服务商", "select"),
        options: Object.entries(RECRUITMENT_MAIL_PROVIDERS).map(
          ([value, item]) => ({ value, label: item.label }),
        ),
      },
      f("RECRUITMENT_MAIL_ENABLED", "启用招聘邮箱", "boolean", false),
      f("RECRUITMENT_MAIL_ACCOUNT", "邮箱账号"),
      f(
        "RECRUITMENT_MAIL_PASSWORD",
        "客户端授权码",
        "secret",
        true,
        "先在邮箱设置中开启 IMAP 并生成客户端授权码；不用网页登录密码。网易邮箱若拒绝客户端身份，请核对服务商设置后重新核验。",
      ),
      f("RECRUITMENT_MAIL_FOLDER", "指定文件夹"),
      f("RECRUITMENT_MAIL_AUTHORIZED_FROM", "允许读取起始时间", "datetime"),
    ],
  },
  {
    id: "ai-resume",
    title: "简历解析",
    description:
      "独立使用已核验的 DeepSeek 凭据。服务商凭据沿用 AI 服务配置，此开关不启用目标进展机器人。",
    enabledKey: "AI_RESUME_PARSING_ENABLED",
    fields: [f("AI_RESUME_PARSING_ENABLED", "启用简历解析", "boolean", false)],
  },
  {
    id: "payroll-access",
    title: "薪酬启用",
    description: "仅维护功能开关；主体授权、工资权限及首月签收沿用原业务流程。",
    fields: [
      f("PAYROLL_ENABLED", "启用薪酬功能", "boolean", false),
      f("PAYROLL_FORMAL_ENABLED", "开放正式薪酬入口", "boolean", false),
    ],
  },
];

export function definition(id: string): ConfigurationDefinition {
  if (
    /^recruitment-mail:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    return {
      ...DEFINITIONS.find((item) => item.id === "recruitment-mail")!,
      id,
    };
  const value = DEFINITIONS.find(
    (item) => item.id === (id === "dingtalk-login" ? "dingtalk-app" : id),
  );
  if (!value) throw new NotFoundException("配置项目不存在");
  return value;
}
export const isMailConfiguration = (id: string) =>
  id === "recruitment-mail" || id.startsWith("recruitment-mail:");
