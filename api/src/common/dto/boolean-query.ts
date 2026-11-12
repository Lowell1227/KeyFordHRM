import { Transform } from 'class-transformer';

/** Read the raw query value before implicit Boolean conversion loses "false". */
export function BooleanQuery() {
  return Transform(({ obj, key }) => {
    const raw: unknown = obj[key];
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
  }, { toClassOnly: true });
}
