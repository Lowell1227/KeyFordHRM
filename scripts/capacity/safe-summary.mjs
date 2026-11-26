export function safeSummary(data) {
  return {
    root_group: data.root_group,
    metrics: Object.fromEntries(Object.entries(data.metrics ?? {}).map(([name, metric]) => [
      name, metric.values ? { ...metric.values, thresholds: metric.thresholds } : metric,
    ])),
  };
}
