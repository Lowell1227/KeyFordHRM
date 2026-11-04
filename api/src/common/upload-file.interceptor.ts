import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * 修复 multipart 文件名的编码错乱。
 *
 * busboy 默认按 latin1 解析 Content-Disposition 中的文件名，而浏览器以 UTF-8
 * 发送中文名，导致 multer 的 file.originalname 出现“附件”变“é£åä»¶”式的乱码；
 * 本项目使用的 multer 2.x 不转发 defParamCharset，无法在上游指定 UTF-8。
 *
 * 仅当名字全部由 latin1 字符组成（即可能是被误解码的 UTF-8）且重解码后不含
 * 替换符时才转换，避免误伤真正的 latin1 文件名或已是正确 UTF-8 的名字。
 */
export function repairMultipartFilename(name: string): string {
  if (!name || /[^\u0000-ÿ]/.test(name)) return name;
  const repaired = Buffer.from(name, 'latin1').toString('utf8');
  return repaired.includes('�') ? name : repaired;
}

/** multer 文件过滤器：在 multer 组装文件对象时恢复 UTF-8 文件名。 */
const repairFilenameFilter: NonNullable<MulterOptions['fileFilter']> = (_req, file, cb) => {
  file.originalname = repairMultipartFilename(file.originalname);
  cb(null, true);
};

/**
 * 统一的上传文件拦截器工厂：所有 multipart 上传路由必须使用它，
 * 保证中文文件名按 UTF-8 解析，不再出现乱码。
 */
export function UploadFileInterceptor(
  fieldName = 'file',
  limits?: NonNullable<MulterOptions['limits']>,
) {
  const options: MulterOptions = { fileFilter: repairFilenameFilter };
  if (limits) options.limits = limits;
  return FileInterceptor(fieldName, options);
}
