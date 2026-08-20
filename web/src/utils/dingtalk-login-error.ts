const DEFAULT_MESSAGE = '钉钉登录失败，请重试；如持续失败请联系 HR 或系统管理员';

export function dingtalkLoginErrorMessage(error: unknown): string {
  const message = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;

  if (
    typeof message === 'string'
    && message.includes('AccessTokenPermissionDenied')
  ) {
    return '钉钉应用缺少“获取用户通讯录个人信息”权限，请联系应用管理员开通并重新发布应用';
  }

  if (typeof message === 'string' && message.includes('账号未开通')) {
    return '该钉钉账号尚未同步到系统，请联系 HR 或系统管理员后重试';
  }

  if (typeof message === 'string' && message.includes('钉钉组织不属于本系统企业')) {
    return '当前选择的不是孚德企业，请重新选择钉钉账号或组织';
  }

  return DEFAULT_MESSAGE;
}
