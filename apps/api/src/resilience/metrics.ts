/**
 * In-memory metrics registry for resilience gauges.
 * Compatible with future Prometheus exposition.
 */
const gauges = new Map<string, Map<string, number>>();

function labelKey(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

export function setGauge(
  name: string,
  value: number,
  labels: Record<string, string> = {},
): void {
  let series = gauges.get(name);
  if (!series) {
    series = new Map();
    gauges.set(name, series);
  }
  series.set(labelKey(labels), value);
}

export function getGauge(
  name: string,
  labels: Record<string, string> = {},
): number | undefined {
  return gauges.get(name)?.get(labelKey(labels));
}

export function resetMetrics(): void {
  gauges.clear();
}

/** Snapshot for tests / future /metrics scrape. */
export function collectMetrics(): Array<{
  name: string;
  labels: Record<string, string>;
  value: number;
}> {
  const out: Array<{ name: string; labels: Record<string, string>; value: number }> = [];
  for (const [name, series] of gauges) {
    for (const [lk, value] of series) {
      const labels: Record<string, string> = {};
      if (lk) {
        for (const part of lk.split(',')) {
          const eq = part.indexOf('=');
          if (eq > 0) labels[part.slice(0, eq)] = part.slice(eq + 1);
        }
      }
      out.push({ name, labels, value });
    }
  }
  return out;
}
