import * as Minio from 'minio';
import JSZip from 'jszip';
import { StorageService } from './storage.service';

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    putObject: jest.fn().mockResolvedValue(undefined),
    bucketExists: jest.fn().mockResolvedValue(true),
  })),
}));

describe('StorageService contract material policies', () => {
  const config = {
    getOrThrow: jest.fn((key: string) => ({
      MINIO_ENDPOINT: 'localhost',
      MINIO_BUCKET: 'test-bucket',
      MINIO_ACCESS_KEY: 'test-access',
      MINIO_SECRET_KEY: 'test-secret',
    })[key]),
    get: jest.fn((_key: string, fallback: string) => fallback),
  };

  const file = (
    name: string,
    mimeType: string,
    size: number,
    buffer: Buffer = Buffer.alloc(1),
  ): Express.Multer.File => ({
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: mimeType,
    size,
    buffer,
    stream: null as any,
    destination: '',
    filename: '',
    path: '',
  });

  beforeEach(() => jest.clearAllMocks());

  it('合同图片上传限制为 JPG/PNG/WEBP 且单张不超过 2MB', async () => {
    const service = new StorageService(config as any);

    await expect(service.uploadFile(
      file('合同.jpg', 'image/jpeg', 2 * 1024 * 1024 + 1),
      'employee-contract-image',
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '合同图片单张不能超过 2MB' }) });
    await expect(service.uploadFile(
      file('合同.gif', 'image/gif', 1024),
      'employee-contract-image',
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '合同图片仅支持 JPG、PNG、WEBP' }) });
  });

  it('合同附件限制为业务文档且单个不超过 10MB', async () => {
    const service = new StorageService(config as any);

    await expect(service.uploadFile(
      file('合同.pdf', 'application/pdf', 10 * 1024 * 1024 + 1),
      'employee-contract-attachment',
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '合同附件单个不能超过 10MB' }) });
    await expect(service.uploadFile(
      file('合同.exe', 'application/octet-stream', 1024),
      'employee-contract-attachment',
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '合同附件仅支持 PDF、DOC、DOCX、XLS、XLSX' }) });
  });

  it('合法合同材料保存到专用私有目录并返回 mimeType', async () => {
    const service = new StorageService(config as any);

    const result = await service.uploadFile(
      file('劳动合同.pdf', 'application/pdf', 4096, Buffer.from('%PDF-1.7\n')),
      'employee-contract-attachment',
    );

    expect(result).toEqual(expect.objectContaining({
      name: '劳动合同.pdf',
      size: 4096,
      mimeType: 'application/pdf',
      url: expect.stringContaining('employee-contracts%2Fattachments'),
    }));
    const client = (Minio.Client as unknown as jest.Mock).mock.results[0].value;
    expect(client.putObject).toHaveBeenCalledWith(
      'test-bucket',
      expect.stringContaining('employee-contracts/attachments/'),
      expect.any(Buffer),
      4096,
      expect.objectContaining({ 'Content-Type': 'application/pdf' }),
    );
  });

  it('合同材料不信任后缀或上传声明的 MIME，拒绝伪装文件', async () => {
    const service = new StorageService(config as any);

    await expect(service.uploadFile(
      file('合同.jpg', 'text/html', 24, Buffer.from('<script>alert(1)</script>')),
      'employee-contract-image',
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '合同图片文件内容与格式不符' }) });

    await expect(service.uploadFile(
      file('合同.pdf', 'application/pdf', 18, Buffer.from('<html>fake</html>')),
      'employee-contract-attachment',
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '合同附件文件内容与格式不符' }) });

    const arbitraryZip = await new JSZip().file('payload.txt', 'not office').generateAsync({ type: 'nodebuffer' });
    await expect(service.uploadFile(
      file('合同.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', arbitraryZip.length, arbitraryZip),
      'employee-contract-attachment',
    )).rejects.toMatchObject({ response: expect.objectContaining({ message: '合同附件文件内容与格式不符' }) });
  });

  it('合法 Office 压缩包必须包含对应的文档结构', async () => {
    const service = new StorageService(config as any);
    const docx = await new JSZip()
      .file('[Content_Types].xml', '<Types/>')
      .file('word/document.xml', '<document/>')
      .generateAsync({ type: 'nodebuffer' });

    await expect(service.uploadFile(
      file('劳动合同.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx.length, docx),
      'employee-contract-attachment',
    )).resolves.toMatchObject({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  it('合同文件下载强制作为附件并禁止 MIME 嗅探', async () => {
    const service = new StorageService(config as any);
    const pipe = jest.fn();
    const client = (Minio.Client as unknown as jest.Mock).mock.results[0].value;
    client.statObject = jest.fn().mockResolvedValue({ metaData: { 'content-type': 'application/pdf' } });
    client.getObject = jest.fn().mockResolvedValue({ pipe });
    const res = { setHeader: jest.fn() };

    await service.pipeDownload(
      'employee-contracts/attachments/2026/08/28/00000000-0000-4000-8000-000000000000-劳动合同.pdf',
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(/^attachment;/),
    );
    expect(pipe).toHaveBeenCalledWith(res);
  });
});
