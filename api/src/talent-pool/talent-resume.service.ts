import {
  BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import JSZip from 'jszip';
import * as CFB from 'cfb';
import { parseStringPromise, processors } from 'xml2js';
import { inflateRawSync } from 'zlib';
import { AiConfigService } from '@/ai-progress/ai-config.service';
import { hasHrCapability } from '@/auth/hr-capabilities';
import type { AuthUser } from '@/common/types/auth.types';
import {
  RESUME_LIMITS, RESUME_MODEL, ResumeClientError, ResumeDocument, ResumeParseOptions, TalentResumeClient,
} from './talent-resume-client';

const MIME_TYPES = {
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
} as const;
const BAD_FILE = '文件格式无效或包含不支持的内容，请使用无密码、无宏及无外部引用的 PDF、Word、JPEG 或 PNG';
function invalidFile(): never { throw new BadRequestException(BAD_FILE); }
function imageSize(width: number, height: number) {
  if (!width || !height || width > 10000 || height > 10000 || width * height > RESUME_LIMITS.imagePixels) invalidFile();
}

function validatePng(buffer: Buffer) {
  if (buffer.length < 57 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') invalidFile();
  imageSize(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
  if (![0, 2, 3, 4, 6].includes(buffer[25]) || buffer[26] !== 0 || buffer[27] !== 0 || buffer[28] > 1) invalidFile();
  let offset = 8;
  let data = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || offset + length + 12 > buffer.length || type === 'acTL') invalidFile();
    if (type === 'IDAT' && length) data = true;
    offset += length + 12;
    if (type === 'IEND') {
      if (length !== 0 || offset !== buffer.length || !data) invalidFile();
      return;
    }
  }
  invalidFile();
}

function validateJpeg(buffer: Buffer) {
  if (buffer.length < 32 || buffer[0] !== 0xff || buffer[1] !== 0xd8 ||
    buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) invalidFile();
  let offset = 2;
  let dimensions = false;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset++] !== 0xff) invalidFile();
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) invalidFile();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) invalidFile();
      imageSize(buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3));
      dimensions = true;
    }
    if (marker === 0xda) {
      if (!dimensions || offset + length >= buffer.length - 2) invalidFile();
      return;
    }
    offset += length;
  }
  invalidFile();
}

function validateDoc(buffer: Buffer) {
  if (buffer.length < 512 || buffer.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') invalidFile();
  // cfb and xml2js are already installed via officecrypto-tool; no new packages or hand-written OLE parser.
  const container = CFB.read(buffer, { type: 'buffer' });
  if (container.FileIndex.length > 200 || container.FullPaths.some(path =>
    /(?:VBA|Macros|ObjectPool|EncryptedPackage|EncryptionInfo)/i.test(path))) invalidFile();
  const word = CFB.find(container, 'WordDocument');
  if (!word || word.content.length < 32) invalidFile();
  const fib = Buffer.from(word.content);
  if (fib.readUInt16LE(0) !== 0xa5ec || (fib.readUInt16LE(10) & 0x8100) ||
    !CFB.find(container, (fib.readUInt16LE(10) & 0x200) ? '1Table' : '0Table')) invalidFile();
}

async function validateDocx(buffer: Buffer) {
  if (buffer.subarray(0, 4).toString('hex') !== '504b0304') invalidFile();
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  if (entries.length > 200 || !zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) invalidFile();
  let total = 0;
  const xml = new Map<string, any>();
  for (const entry of entries) {
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    if (original !== entry.name || original.startsWith('/') || original.includes('\\') ||
      original.split('/').includes('..') || /vba|activex|embeddings|\.bin$|\.exe$|\.js$/i.test(original)) invalidFile();
    if (entry.dir) continue;
    const isXml = /\.xml$|\.rels$/.test(entry.name);
    // JSZip 3.x exposes the parsed compressed entry here. Use native bounded inflation:
    // its pako stream cannot abort mid-chunk and ZIP sizes are attacker-controlled.
    const data = (entry as unknown as { _data: {
      compressedContent: Uint8Array; uncompressedSize: number; compression: { magic: string };
    } })._data;
    const limit = Math.min(RESUME_LIMITS.docxExpandedBytes - total, isXml ? RESUME_LIMITS.docxXmlBytes : RESUME_LIMITS.docxExpandedBytes);
    if (!data || !Number.isSafeInteger(data.uncompressedSize) || data.uncompressedSize < 0 || data.uncompressedSize > limit ||
      !(data.compressedContent instanceof Uint8Array)) invalidFile();
    const compressed = Buffer.from(data.compressedContent);
    let expanded: Buffer;
    if (data.compression.magic === '\x00\x00') expanded = compressed;
    else if (data.compression.magic === '\x08\x00') expanded = inflateRawSync(compressed, { maxOutputLength: Math.max(1, limit) });
    else invalidFile();
    if (expanded.length !== data.uncompressedSize || expanded.length > limit) invalidFile();
    total += expanded.length;
    if (!isXml) continue;
    const content = new TextDecoder('utf-8', { fatal: true }).decode(expanded);
    if (/<!DOCTYPE|<!ENTITY/i.test(content)) invalidFile();
    const value = await parseStringPromise(content, { strict: true, tagNameProcessors: [processors.stripPrefix] });
    if (/\.rels$/.test(entry.name)) {
      if (!value?.Relationships || value.Relationships.Relationship?.some((item: any) =>
        String(item.$?.TargetMode).toLowerCase() === 'external' || /^(?:[a-z]+:|\/\/)/i.test(item.$?.Target ?? ''))) invalidFile();
    }
    if (entry.name === '[Content_Types].xml' || entry.name === 'word/document.xml') xml.set(entry.name, value);
  }
  const overrides = xml.get('[Content_Types].xml')?.Types?.Override;
  if (!Array.isArray(overrides) || !overrides.some(item => item.$?.PartName === '/word/document.xml' &&
    item.$?.ContentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') ||
    !xml.get('word/document.xml')?.document?.body) invalidFile();
}

export async function validateResumeFile(file: Express.Multer.File | undefined): Promise<ResumeDocument> {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length || file.size !== file.buffer.length) invalidFile();
  if (file.buffer.length > RESUME_LIMITS.fileBytes) throw new BadRequestException('简历文件不能超过 10MB');
  const name = file.originalname;
  if (typeof name !== 'string' || name.length > 200 || /[\u0000-\u001f\u007f-\u009f/\\\u202a-\u202e\u2066-\u2069]/.test(name)) invalidFile();
  const extension = name.split('.').pop()?.toLowerCase() as keyof typeof MIME_TYPES;
  if (!Object.prototype.hasOwnProperty.call(MIME_TYPES, extension)) invalidFile();
  try {
    if (extension === 'png') validatePng(file.buffer);
    else if (extension === 'jpg' || extension === 'jpeg') validateJpeg(file.buffer);
    else if (extension === 'doc') validateDoc(file.buffer);
    else if (extension === 'docx') await validateDocx(file.buffer);
    else {
      // Format sniff only, NOT a PDF parser/page counter. Enforce page count on the OCR result.
      if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(file.buffer.toString('ascii', 0, 16)) ||
        !/%%EOF\s*$/.test(file.buffer.subarray(-1024).toString('ascii')) ||
        /\/(?:JavaScript|JS|Launch|EmbeddedFile|Encrypt|OpenAction)\b/.test(file.buffer.toString('latin1'))) invalidFile();
    }
  } catch { invalidFile(); }
  return { buffer: file.buffer, extension, mimeType: MIME_TYPES[extension] };
}

@Injectable()
export class TalentResumeService {
  private readonly inFlightUsers = new Set<string>();
  private requests: number[] = [];
  private readonly userRequests = new Map<string, number[]>();

  constructor(
    private readonly aiConfig: AiConfigService,
    private readonly config: ConfigService,
    private readonly client: TalentResumeClient,
  ) {}

  async getStatus(user: AuthUser) {
    this.assertMaintainer(user);
    return { configured: Boolean(await this.runtime()), enabled: this.enabled(), provider: 'deepseek' as const, modelId: RESUME_MODEL };
  }

  async parse(file: Express.Multer.File | undefined, user: AuthUser, options?: ResumeParseOptions) {
    this.assertMaintainer(user);
    if (!this.enabled()) throw new ServiceUnavailableException('简历解析未启用，请手工填写');
    this.acquire(user.id);
    try {
      const document = await validateResumeFile(file);
      const runtime = await this.runtime();
      if (!runtime) throw new ServiceUnavailableException('请先保存并测试当前 DeepSeek 配置');
      try {
        const result = await this.client.parse(document, runtime.apiKey, options);
        return { fields: result.fields, reviewItems: result.reviewItems, source: { fileName: file!.originalname, pageCount: result.pageCount } };
      } catch (error) {
        if (error instanceof ResumeClientError) {
          if (error.code === 'timeout') throw new ServiceUnavailableException('简历解析超时，请稍后重试或手工填写');
          if (error.code === 'rate_limited') throw new HttpException('简历解析服务繁忙，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
          if (error.code === 'document_too_large' || error.code === 'response_too_large') {
            throw new BadRequestException('简历页数或内容超限，请使用不超过 20 页的精简材料');
          }
          if (error.code === 'empty_result' || error.code === 'invalid_response') {
            throw new BadRequestException('未获得完整有效的解析结果，请检查文件或手工填写');
          }
        }
        throw new ServiceUnavailableException('简历解析暂时失败，请稍后重试或手工填写');
      }
    } finally { this.inFlightUsers.delete(user.id); }
  }

  private enabled() {
    const value = this.config.get<unknown>('AI_RESUME_PARSING_ENABLED');
    return value === true || value === 'true';
  }

  private async runtime() {
    try { return await this.aiConfig.getProviderRuntimeConfig('deepseek'); }
    catch { throw new ServiceUnavailableException('AI 配置暂时不可用，请稍后重试'); }
  }

  private assertMaintainer(user: AuthUser) {
    if (!user?.id || user.isAssessorOnly || (!hasHrCapability(user, 'recruitment_edit') && !hasHrCapability(user, 'employee_archive_edit'))) throw new ForbiddenException('无权限解析人才简历');
  }

  private acquire(userId: string) {
    const now = Date.now();
    const fresh = (timestamps: number[]) => timestamps.filter(time => time > now - 60_000);
    this.requests = fresh(this.requests);
    for (const [id, times] of this.userRequests) {
      const current = fresh(times);
      if (current.length) this.userRequests.set(id, current); else this.userRequests.delete(id);
    }
    if (this.inFlightUsers.has(userId) || this.inFlightUsers.size >= RESUME_LIMITS.concurrency) {
      throw new HttpException('正在解析简历，请等待当前任务结束', HttpStatus.TOO_MANY_REQUESTS);
    }
    const times = this.userRequests.get(userId) ?? [];
    if (times.length >= RESUME_LIMITS.userRequestsPerMinute || this.requests.length >= RESUME_LIMITS.requestsPerMinute) {
      throw new HttpException('简历解析请求过于频繁，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.requests.push(now); this.userRequests.set(userId, [...times, now]);
    this.inFlightUsers.add(userId);
  }
}
