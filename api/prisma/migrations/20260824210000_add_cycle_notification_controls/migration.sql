ALTER TABLE "assessment_cycles"
ADD COLUMN "notification_mode" VARCHAR(30) NOT NULL DEFAULT 'off';

INSERT INTO "system_configs" ("key", "value", "description")
VALUES (
  'dingtalk_notification_enabled',
  'false'::jsonb,
  '绩效钉钉通知业务总开关；关闭时仅保留系统站内通知'
)
ON CONFLICT ("key") DO NOTHING;
