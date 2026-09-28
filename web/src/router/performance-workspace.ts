const PERFORMANCE_WORKSPACE_PATHS = new Set([
  '/tasks',
  '/objectives',
  '/action-items',
]);

function normalizePath(path: string) {
  return path.replace(/\/+$/, '') || '/';
}

export function isPerformanceWorkspacePath(path: string) {
  return PERFORMANCE_WORKSPACE_PATHS.has(normalizePath(path));
}
