const PERFORMANCE_WORKSPACE_PATHS = new Set([
  '/tasks',
  '/objectives',
  '/action-items',
]);

export function isPerformanceWorkspacePath(path: string) {
  const normalizedPath = path.replace(/\/+$/, '') || '/';
  return PERFORMANCE_WORKSPACE_PATHS.has(normalizedPath);
}
