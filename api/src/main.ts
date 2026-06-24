import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);
  const prefix = config.get<string>('API_PREFIX', '/api/v1');
  const port = config.get<number>('PORT', 3000);

  // 全局路由前缀（/api/v1）
  app.setGlobalPrefix(prefix.replace(/^\//, ''));

  // 全局 DTO 校验
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // 统一响应格式 + 统一异常处理
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // 开发环境放开 CORS（生产由 Nginx 同源代理）
  if (config.get('NODE_ENV') !== 'production') {
    app.enableCors({ origin: true, credentials: true });
  }

  await app.listen(port);
  console.log(`🚀 孚德绩效系统 API 已启动：http://localhost:${port}${prefix}`);
}
bootstrap();
