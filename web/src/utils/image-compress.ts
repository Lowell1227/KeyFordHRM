/**
 * 手机拍照/选图的浏览器端压缩（需求 §5.2：长边 ≤2000px、输出 JPEG ≤2MB）。
 * 直接用 canvas，不引入新 npm 依赖。
 * 压缩失败或压不到目标大小时回退原文件（由服务端 10MB 上限兜底），不静默丢失。
 */

const MAX_EDGE = 2000;
const MAX_BYTES = 2 * 1024 * 1024;
const MIN_QUALITY = 0.45;

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** 非图片原样返回；图片压缩成长边 ≤2000px 的 JPEG 并尽量 ≤2MB，失败回退原文件。 */
export async function compressImage(file: File): Promise<File> {
  if (!isImageFile(file)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, width, height);

      let quality = 0.9;
      for (;;) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) return file;
        if (blob.size <= MAX_BYTES) {
          const baseName = file.name.replace(/\.[a-z0-9]+$/i, '') || 'photo';
          return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
        }
        if (quality <= MIN_QUALITY) return file;
        quality = Math.max(MIN_QUALITY, quality - 0.15);
      }
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
