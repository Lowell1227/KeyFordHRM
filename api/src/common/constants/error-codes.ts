/**
 * 业务错误码（对照后端设计文档 2.3）。
 * code=0 成功；其余为业务错误码，HTTP 状态由 HttpExceptionFilter 映射。
 */
export const ERROR_CODE = {
  SUCCESS: 0,
  PARAM_INVALID: 4001, // 400 参数校验失败
  FORBIDDEN: 4003, // 403 无权限
  NOT_FOUND: 4004, // 404 资源不存在
  CONFLICT: 4009, // 409 状态冲突
  UNAUTHORIZED: 4010, // 401 Token 过期或无效
  RATE_LIMITED: 4029, // 429 请求频率超限
  INTERNAL: 5001, // 500 服务器内部错误
} as const;

// HTTP 状态码 → 业务错误码映射（用于异常过滤器兜底）
export const HTTP_TO_BIZ_CODE: Record<number, number> = {
  400: ERROR_CODE.PARAM_INVALID,
  401: ERROR_CODE.UNAUTHORIZED,
  403: ERROR_CODE.FORBIDDEN,
  404: ERROR_CODE.NOT_FOUND,
  409: ERROR_CODE.CONFLICT,
  429: ERROR_CODE.RATE_LIMITED,
  500: ERROR_CODE.INTERNAL,
};
