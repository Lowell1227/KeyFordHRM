import { Prisma, PrismaClient } from '@prisma/client';

export const transactionBudget = { maxWait: 5000, timeout: 20000 };

export function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

export async function bounded<T>(promise: Promise<T>, label: string, milliseconds = 5000): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function openCycleTerminationDatabase() {
  const value = process.env.CYCLE_TERMINATION_TEST_DATABASE_URL;
  if (!value) throw new Error('Provision the owned disposable cycle-termination database explicitly first');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid isolated cycle-termination database URL'); }
  const previewHost = url.hostname === 'postgres' && process.env.HRM_PREVIEW === 'true';
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || (!['127.0.0.1', 'localhost'].includes(url.hostname) && !previewHost)
    || url.pathname !== '/hrm_cycle_termination_test' || url.username !== 'hrm_cycle_termination_test'
    || url.searchParams.has('host')) {
    throw new Error('Only the dedicated hrm_cycle_termination_test database/owner on loopback or guarded preview PG is allowed');
  }
  url.searchParams.set('schema', 'public');
  // One transaction plus one lock observer; the second client uses one independent connection.
  url.searchParams.set('connection_limit', '2');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  url.searchParams.set('connection_limit', '1');
  const second = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    await db.$connect();
    await second.$connect();
    const identity = await db.$queryRaw<Array<{ database: string; actor: string; owner: string; safe: boolean }>>`
      SELECT current_database() AS database, current_user AS actor, pg_get_userbyid(d.datdba) AS owner,
        NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AS safe
      FROM pg_database d JOIN pg_roles r ON r.rolname = current_user WHERE d.datname = current_database()`;
    expect(identity).toEqual([{ database: 'hrm_cycle_termination_test', actor: 'hrm_cycle_termination_test',
      owner: 'hrm_cycle_termination_test', safe: true }]);
    const columns = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_schema='public'
        AND table_name='assessment_cycles'
        AND column_name IN ('terminated_at','terminated_by_id','termination_reason','termination_version')
      ORDER BY column_name`;
    expect(columns.map((row) => row.column_name)).toEqual([
      'terminated_at', 'terminated_by_id', 'termination_reason', 'termination_version',
    ]);
    const guard = await db.$queryRaw<Array<{ present: boolean }>>`
      SELECT to_regprocedure('performance_lifecycle_root_guard()') IS NOT NULL AS present`;
    expect(guard).toEqual([{ present: true }]);
    return { db, second };
  } catch (error) {
    await second.$disconnect();
    await db.$disconnect();
    throw error;
  }
}

type TransactionHooks = {
  begin?: (pid: number) => void;
  beforeCommit?: (tx: Prisma.TransactionClient) => Promise<void>;
};

// Instrument transaction boundaries only: all statements, locks and isolation remain real.
export function observedTransactions(client: PrismaClient, hooks: TransactionHooks) {
  return new Proxy(client, {
    get(target, property) {
      if (property === '$transaction') return (operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
        target.$transaction(async (tx) => {
          const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          hooks.begin?.(pid);
          const result = await operation(tx);
          await hooks.beforeCommit?.(tx);
          return result;
        }, { ...options, ...transactionBudget });
      const member = Reflect.get(target, property, target);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

export async function backendPid(tx: Prisma.TransactionClient) {
  return (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
}

export async function waitForBlockedBy(observer: PrismaClient, waiter: number, blocker: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await observer.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT wait_event_type='Lock' AND ${blocker}::int=ANY(pg_blocking_pids(pid)) AS waiting
      FROM pg_stat_activity WHERE pid=${waiter}`;
    if (rows[0]?.waiting) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('The independent backend did not queue behind the expected PostgreSQL lock holder');
}

export async function verifyQueueAndRelease(observer: PrismaClient, began: Promise<void>,
  pids: () => { waiter: number; blocker: number }, release: () => void, operations: Promise<unknown>[]) {
  try {
    await bounded(began, 'independent operation began');
    const { waiter, blocker } = pids();
    expect(waiter).not.toBe(blocker);
    await waitForBlockedBy(observer, waiter, blocker);
  } finally {
    release();
    // Even a failed lock assertion must not leak a held transaction into the next case.
    await Promise.allSettled(operations);
  }
}

type SnapshotTable = 'assessment_cycles' | 'assessment_tasks' | 'assessment_periods' | 'grade_results'
  | 'self_eval_summaries' | 'manager_eval_summaries' | 'indicator_versions' | 'indicator_version_items'
  | 'indicator_instances' | 'assessment_period_indicator_reviews' | 'assessment_period_review_revisions'
  | 'flow_records' | 'appeals' | 'goal_change_requests' | 'notification_logs' | 'audit_logs'
  | 'improvement_plans' | 'confirmation_applications' | 'payroll_batches' | 'payroll_versions' | 'payroll_lines';

export async function snapshotRows(db: Prisma.TransactionClient, table: SnapshotTable, where: Prisma.Sql) {
  // Database-side JSON text retains timestamptz microseconds and every column, unlike a JS date projection.
  const [row] = await db.$queryRaw<Array<{ value: string }>>(Prisma.sql`
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)::text AS value
    FROM ${Prisma.raw(table)} r WHERE ${where}`);
  return row.value;
}

export async function lifecycleContent(db: Prisma.TransactionClient, table: 'assessment_tasks' | 'goal_change_requests', id: string) {
  const [row] = await db.$queryRaw<Array<{ value: string }>>(Prisma.sql`
    SELECT (to_jsonb(r) - ARRAY['lifecycle_status','lifecycle_version','terminated_at','terminated_by_id',
      'termination_reason','deleted_at','deleted_by_id','deletion_reason','updated_at'])::text AS value
    FROM ${Prisma.raw(table)} r WHERE r.id=${id}::uuid`);
  return row.value;
}

export async function taskSnapshot(db: Prisma.TransactionClient, id: string) {
  const result: Record<string, string> = {};
  for (const table of ['assessment_tasks', 'assessment_periods', 'grade_results', 'self_eval_summaries',
    'manager_eval_summaries', 'indicator_versions', 'indicator_instances', 'goal_change_requests',
    'flow_records', 'appeals', 'notification_logs'] as const) {
    result[table] = await snapshotRows(db, table, table === 'assessment_tasks'
      ? Prisma.sql`r.id=${id}::uuid` : Prisma.sql`r.task_id=${id}::uuid`);
  }
  result.items = await snapshotRows(db, 'indicator_version_items', Prisma.sql`
    r.indicator_version_id IN (SELECT id FROM indicator_versions WHERE task_id=${id}::uuid)`);
  for (const table of ['assessment_period_indicator_reviews', 'assessment_period_review_revisions'] as const) {
    result[table] = await snapshotRows(db, table, Prisma.sql`
      r.period_id IN (SELECT id FROM assessment_periods WHERE task_id=${id}::uuid)`);
  }
  result.audit = await snapshotRows(db, 'audit_logs', Prisma.sql`r.entity_id=${id}::uuid
    OR r.entity_id IN (SELECT id FROM goal_change_requests WHERE task_id=${id}::uuid)`);
  return result;
}

export async function cycleSnapshot(db: Prisma.TransactionClient, id: string) {
  const tasks = await db.assessmentTask.findMany({ where: { cycleId: id }, orderBy: { id: 'asc' }, select: { id: true } });
  const result: Record<string, unknown> = {
    cycle: await snapshotRows(db, 'assessment_cycles', Prisma.sql`r.id=${id}::uuid`),
    audit: await snapshotRows(db, 'audit_logs', Prisma.sql`r.entity_id=${id}::uuid`),
    notifications: await snapshotRows(db, 'notification_logs', Prisma.sql`r.cycle_id=${id}::uuid`),
  };
  for (const task of tasks) result[task.id] = await taskSnapshot(db, task.id);
  return result;
}

export async function expectWriteFence(operation: Promise<unknown>) {
  let failure: any;
  try { await operation; } catch (error) { failure = error; }
  expect(failure).toBeDefined();
  // Do not accept a deadlock, serialization failure, timeout, FK or uniqueness failure as the fence.
  const sqlState = failure?.meta?.code ?? failure?.code;
  const checkConstraint = sqlState === '23514'
    || (failure?.code === 'P2004' && /23514|PERFORMANCE_(?:LIFECYCLE|CYCLE)/.test(JSON.stringify(failure.meta)));
  expect(checkConstraint || (typeof failure?.getStatus === 'function' && failure.getStatus() === 409)).toBe(true);
}
