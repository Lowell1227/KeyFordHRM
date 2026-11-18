const PERFORMANCE_WORKSPACE_PATHS = new Set([
  '/tasks',
  '/objectives',
  '/action-items',
  '/goal-changes',
]);

function normalizePath(path: string) {
  return path.replace(/\/+$/, '') || '/';
}

export function isPerformanceWorkspacePath(path: string) {
  const normalized = normalizePath(path);
  return PERFORMANCE_WORKSPACE_PATHS.has(normalized) || normalized.startsWith('/goal-changes/');
}
