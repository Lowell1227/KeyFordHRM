import { DEMO_CONFIG } from './config';
import { demoId } from './ids';
import { SeededRandom } from './random';
import type { DemoEntityKind, DemoManifest } from './types';

export interface DemoContext {
  config: typeof DEMO_CONFIG;
  random: SeededRandom;
  manifest: DemoManifest;
  id(kind: DemoEntityKind, key: string): string;
  own(kind: DemoEntityKind, id: string): string;
}

function createOwnedIds(): Record<DemoEntityKind, string[]> {
  return {
    department: [],
    user: [],
    indicator: [],
    template: [],
    dimension: [],
    'template-indicator': [],
    cycle: [],
    snapshot: [],
    task: [],
    'indicator-instance': [],
    'self-eval': [],
    'manager-eval': [],
    grade: [],
    flow: [],
    archive: [],
    objective: [],
    'action-item': [],
    interview: [],
    appeal: [],
    'improvement-plan': [],
    'probation-review': [],
    'probation-indicator': [],
    confirmation: [],
    signature: [],
    notification: [],
    'audit-log': [],
  };
}

export function createDemoContext(): DemoContext {
  const manifest: DemoManifest = {
    source: DEMO_CONFIG.source,
    asOf: new Date(DEMO_CONFIG.asOf),
    ownedIds: createOwnedIds(),
    acceptanceEmployeeNos: { ...DEMO_CONFIG.acceptanceEmployeeNos },
    storyUserIds: {},
    expectedCounts: {},
  };

  return {
    config: DEMO_CONFIG,
    random: new SeededRandom(DEMO_CONFIG.seed),
    manifest,
    id: demoId,
    own(kind, id) {
      manifest.ownedIds[kind].push(id);
      return id;
    },
  };
}
