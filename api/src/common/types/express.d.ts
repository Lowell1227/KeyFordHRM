import { AuthUser } from './auth.types';

// 扩展 Express Request，附加经 JwtAuthGuard 解析的当前用户
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
