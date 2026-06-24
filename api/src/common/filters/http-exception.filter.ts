import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ERROR_CODE, HTTP_TO_BIZ_CODE } from '../constants/error-codes';

/**
 * 统一异常处理：把所有异常转为 { code, message, data:null, timestamp }。
 * - HttpException：按 HTTP 状态映射业务码；若 response 体含自定义 code 则优先用之。
 * - 其它异常：500 / 5001，并记录日志。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
    let bizCode: number = ERROR_CODE.INTERNAL;
    let message = '服务器内部错误';

    if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      bizCode = HTTP_TO_BIZ_CODE[httpStatus] ?? httpStatus;
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (resp && typeof resp === 'object') {
        const r = resp as Record<string, unknown>;
        // class-validator 错误 message 为数组，取首条
        message = Array.isArray(r.message) ? String(r.message[0]) : String(r.message ?? exception.message);
        if (typeof r.code === 'number') bizCode = r.code; // 业务自定义码
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.message, exception.stack);
    } else {
      this.logger.error('未知异常', JSON.stringify(exception));
    }

    res.status(httpStatus).json({
      code: bizCode,
      message,
      data: null,
      timestamp: Date.now(),
    });
  }
}
