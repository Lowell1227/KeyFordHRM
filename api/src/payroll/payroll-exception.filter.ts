import { ArgumentsHost, Catch, ConflictException, HttpException, InternalServerErrorException, Logger } from '@nestjs/common';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';

@Catch()
export class PayrollExceptionFilter extends HttpExceptionFilter {
  private readonly payrollLogger = new Logger('Payroll');

  override catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof HttpException) return super.catch(exception, host);
    const code = (exception as { code?: unknown } | null)?.code;
    if (code === 'P2002' || code === 'P2034') {
      return super.catch(new ConflictException('记录已被其他操作更新，请刷新核对后重试'), host);
    }
    // Prisma messages can contain query values; never log or return a salary payload.
    this.payrollLogger.error('Payroll operation failed; private payload omitted');
    return super.catch(new InternalServerErrorException('薪酬操作未完成，请联系管理员核对服务状态'), host);
  }
}
