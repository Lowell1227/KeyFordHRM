const PERFORMANCE_WORKSPACE_PATHS = new Set([
  '/tasks',
  '/objectives',
  '/action-items',
]);

const PERFORMANCE_MODULE_ROOT_PATHS = [
  '/tasks',
  '/objectives',
  '/action-items',
  '/cycles',
  '/templates',
  '/calibration',
  '/department-review',
  '/interviews',
  '/improvement-plans',
  '/approval',
  '/publish',
  '/appeals',
  '/reports',
  '/probation-reviews',
  '/confirmation-applications',
];

function normalizePath(path: string) {
  return path.replace(/\/+$/, '') || '/';
}

export function isPerformanceWorkspacePath(path: string) {
  return PERFORMANCE_WORKSPACE_PATHS.has(normalizePath(path));
}

export function isPerformanceModulePath(path: string) {
  const normalizedPath = normalizePath(path);
  return PERFORMANCE_MODULE_ROOT_PATHS.some(
    (rootPath) => normalizedPath === rootPath || normalizedPath.startsWith(`${rootPath}/`),
  );
}
