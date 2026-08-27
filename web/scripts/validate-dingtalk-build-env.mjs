const requiredSettings = [
  'VITE_DINGTALK_APP_KEY',
  'VITE_DINGTALK_CORP_ID',
  'VITE_DINGTALK_REDIRECT_URI',
];

const placeholderPattern = /devdingtalk|dingdev|changeme|placeholder|请填写/i;
const errors = [];

for (const setting of requiredSettings) {
  const value = process.env[setting]?.trim();
  if (!value) {
    errors.push(`${setting} 未配置`);
    continue;
  }
  if (placeholderPattern.test(value)) {
    errors.push(`${setting} 仍是开发占位值`);
  }
}

const redirectUri = process.env.VITE_DINGTALK_REDIRECT_URI?.trim();
if (redirectUri) {
  try {
    const parsed = new URL(redirectUri);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const isLocalHostname = hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '0.0.0.0'
      || hostname === '::'
      || hostname === '::1'
      || /^127(?:\.\d{1,3}){3}$/.test(hostname)
      || hostname.startsWith('::ffff:127.')
      || hostname.startsWith('::ffff:7f')
      || hostname === '::ffff:0:0';

    if (parsed.protocol !== 'https:') errors.push('VITE_DINGTALK_REDIRECT_URI 必须使用 HTTPS');
    if (isLocalHostname) {
      errors.push('VITE_DINGTALK_REDIRECT_URI 不能指向本机');
    }
    if (parsed.pathname !== '/auth/callback') {
      errors.push('VITE_DINGTALK_REDIRECT_URI 必须指向 /auth/callback');
    }
  } catch {
    errors.push('VITE_DINGTALK_REDIRECT_URI 不是有效地址');
  }
}

if (errors.length > 0) {
  console.error(`钉钉生产构建配置无效：${errors.join('；')}`);
  process.exit(1);
}

console.log('钉钉生产构建配置已通过校验');
