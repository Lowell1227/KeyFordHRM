import { createDemoContext } from './context';
import { demoId } from './ids';

it('creates independent manifests and records owned deterministic IDs', () => {
  const first = createDemoContext();
  const second = createDemoContext();
  const userId = first.id('user', 'FD210101');

  expect(userId).toBe(demoId('user', 'FD210101'));
  expect(first.own('user', userId)).toBe(userId);
  expect(first.manifest.ownedIds.user).toEqual([userId]);
  expect(second.manifest.ownedIds.user).toEqual([]);
  expect(first.manifest.acceptanceEmployeeNos.employee).toBe('FD210101');
});
