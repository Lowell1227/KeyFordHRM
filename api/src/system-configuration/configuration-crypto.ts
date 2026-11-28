import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { ConfigurationValues } from "./configuration-definitions";

export function configurationMasterKey(
  config: Pick<ConfigService, "get">,
): Buffer | null {
  const value = config.get<string>("AI_PROVIDER_ENCRYPTION_KEY");
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 32 && bytes.toString("base64") === value
    ? bytes
    : null;
}
const unavailable = () =>
  new ServiceUnavailableException(
    "配置不可读取，请检查加密主密钥或重新录入配置",
  );
export function encryptConfiguration(
  config: Pick<ConfigService, "get">,
  id: string,
  values: ConfigurationValues,
): string {
  const key = configurationMasterKey(config);
  if (!key) throw unavailable();
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`system-configuration:v1:${id}`));
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(values), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([1]),
    iv,
    cipher.getAuthTag(),
    bytes,
  ]).toString("base64");
}
export function decryptConfiguration(
  config: Pick<ConfigService, "get">,
  id: string,
  value: unknown,
): ConfigurationValues {
  try {
    const key = configurationMasterKey(config);
    if (!key || typeof value !== "string") throw unavailable();
    const bytes = Buffer.from(value, "base64");
    if (
      bytes.length < 30 ||
      bytes[0] !== 1 ||
      bytes.toString("base64") !== value
    )
      throw unavailable();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      bytes.subarray(1, 13),
    );
    decipher.setAAD(Buffer.from(`system-configuration:v1:${id}`));
    decipher.setAuthTag(bytes.subarray(13, 29));
    const parsed = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(29)),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.values(parsed).some(
        (v) => !["string", "boolean"].includes(typeof v),
      )
    )
      throw unavailable();
    return parsed;
  } catch {
    throw unavailable();
  }
}
