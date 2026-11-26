import { writeFileSync } from 'node:fs';
import { docker, assertOwned, assertRunId } from './isolation.mjs';
const [runId, output] = process.argv.slice(2);
assertRunId(runId);
if (!output?.includes(`test-results/capacity/${runId}/`)) throw new Error('owned-metrics-output-required');
const name = (key) => `hrm-cap-${runId.toLowerCase()}-${key}`;
for (const key of ['api', 'pg']) assertOwned(JSON.parse(docker(['inspect', name(key)]))[0], runId);
const database = `hrm_capacity_${runId.slice(4)}`;
const activity = docker(['exec', name('pg'), 'psql', '-U', 'postgres', '-d', database, '-At', '-c',
  "SELECT coalesce(json_agg(t),'[]') FROM (SELECT state, wait_event_type, wait_event,count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY state,wait_event_type,wait_event) t"]);
const totals = docker(['exec', name('pg'), 'psql', '-U', 'postgres', '-d', database, '-At', '-c',
  'SELECT row_to_json(t) FROM (SELECT numbackends,xact_commit,xact_rollback,deadlocks FROM pg_stat_database WHERE datname=current_database()) t']);
const cpu = docker(['exec', name('api'), 'node', '-e', 'const fs=require("fs");console.log(JSON.stringify({cpu:fs.readFileSync("/sys/fs/cgroup/cpu.stat","utf8"),limits:fs.readFileSync("/sys/fs/cgroup/cpu.max","utf8")}))']);
const stats = docker(['stats', '--no-stream', '--format', '{{json .}}', name('api'), name('pg')]).split(/\r?\n/).map((line) => JSON.parse(line));
const result = { at: new Date().toISOString(), activity: JSON.parse(activity), database: JSON.parse(totals), cpu: JSON.parse(cpu), stats };
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
