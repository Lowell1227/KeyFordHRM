import { safeSummary } from './safe-summary.mjs';
export default function () {}
export function handleSummary(data) {
  data.setup_data = { token: 'synthetic-private-value' };
  return { [__ENV.CAPACITY_SUMMARY_PATH]: JSON.stringify(safeSummary(data)) };
}
