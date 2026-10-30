import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ArchiveAssistantController } from './archive-assistant.controller';
import { ArchiveAssistantService } from './archive-assistant.service';

describe('archive assistant HTTP boundary', () => {
  let app: any;
  const assistant = { preview: jest.fn(async () => ({ saved: null })), save: jest.fn(async () => ({ recordStatus: 'draft' })) };
  const token = `sample.${'a'.repeat(43)}`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [ArchiveAssistantController], providers: [
      { provide: ArchiveAssistantService, useValue: assistant },
    ] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it.each(['actor', 'sourceSystem', 'proposal', 'employeeNo'])('rejects arbitrary %s despite permissive global validation', async field => {
    await request(app.getHttpServer()).post('/employee-archives/assistant/save').send({ token, [field]: 'forged' }).expect(400);
    expect(assistant.save).not.toHaveBeenCalled();
  });
  it.each([{}, { token: 123 }, { token: 'x'.repeat(4097) }, { token: 'invalid' }])('rejects missing or malformed token %j', async body => {
    await request(app.getHttpServer()).post('/employee-archives/assistant/save').send(body).expect(400);
    expect(assistant.save).not.toHaveBeenCalled();
  });
  it('only reads preview token from header and saves token-only body', async () => {
    await request(app.getHttpServer()).get('/employee-archives/assistant/preview').set('x-archive-preview', token).expect(200);
    expect(assistant.preview).toHaveBeenCalledWith(token, undefined);
    await request(app.getHttpServer()).post('/employee-archives/assistant/save').send({ token }).expect(201);
    expect(assistant.save).toHaveBeenCalledWith(token, undefined);
  });
});
