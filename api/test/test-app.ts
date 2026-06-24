import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/prisma/prisma.service';
import { MESSAGE_PUSH_PROVIDER } from '@/notifications/message-push.provider';
import { DingtalkSyncService } from '@/dingtalk/dingtalk-sync.service';
import { StorageService } from '@/storage/storage.service';
import { ResponseInterceptor } from '@/common/interceptors/response.interceptor';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import supertest from 'supertest';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  http: supertest.SuperTest<supertest.Test>;
}

export async function buildTestApp(): Promise<TestApp> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MESSAGE_PUSH_PROVIDER)
    .useValue({
      push: async () => ({ channel: 'test' }),
    })
    .overrideProvider(DingtalkSyncService)
    .useValue({
      runSync: () => ({ syncId: 'test-sync', status: 'running' as const, startedAt: new Date() }),
      getResult: () => undefined,
    })
    .overrideProvider(StorageService)
    .useValue({
      uploadFile: async () => ({ name: 'test', url: 'http://test', size: 0 }),
      getPresignedUrl: async () => 'http://test',
      statObject: async () => ({}) as any,
      pipeDownload: async () => undefined,
      ensureBucket: async () => undefined,
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.init();

  const prisma = moduleRef.get(PrismaService);
  const http = supertest(app.getHttpServer()) as unknown as supertest.SuperTest<supertest.Test>;

  return { app, prisma, http };
}

export async function closeTestApp({ app }: TestApp): Promise<void> {
  await app.close();
}
