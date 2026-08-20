type MetricRecord = {
  process: string;
  durationMs: number;
  cache: "hit" | "miss" | "bypass";
  provider?: string;
  error?: string;
  recordedAt: number;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const metrics: MetricRecord[] = [];
const circuitFailures = new Map<string, { count: number; openUntil: number }>();
const MAX_METRICS = 500;

export async function cachedRequest<T>(
  key: string,
  process: string,
  loader: () => Promise<T>,
  ttlMs: number,
  provider?: string
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    recordMetric({ process, durationMs: 0, cache: "hit", provider });
    return cached.value as T;
  }

  const pending = inFlight.get(key);
  if (pending) {
    recordMetric({ process, durationMs: 0, cache: "hit", provider });
    return pending as Promise<T>;
  }

  const startedAt = performance.now();
  const request = loader()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      recordMetric({ process, durationMs: performance.now() - startedAt, cache: "miss", provider });
      return value;
    })
    .catch((error) => {
      recordMetric({
        process,
        durationMs: performance.now() - startedAt,
        cache: "miss",
        provider,
        error: error instanceof Error ? error.message : "unknown"
      });
      throw error;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

export async function fetchJsonWithResilience<T>(
  input: string | URL,
  init: RequestInit,
  process: string,
  provider: string,
  attempts = 2,
  timeoutMs = 7000
): Promise<{ payload: T; response: Response }> {
  const circuit = circuitFailures.get(provider);
  if (circuit && circuit.openUntil > Date.now()) {
    throw new Error(`${provider} temporalmente no disponible`);
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      const payload = (await response.json()) as T;
      if (!response.ok && response.status !== 429 && response.status < 500) {
        return { payload, response };
      }
      if (response.ok) {
        circuitFailures.delete(provider);
        return { payload, response };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
    }
  }

  recordMetric({ process, durationMs: 0, cache: "bypass", provider, error: lastError instanceof Error ? lastError.message : "request failed" });
  const failures = circuitFailures.get(provider);
  const count = (failures?.count ?? 0) + 1;
  circuitFailures.set(provider, { count, openUntil: count >= 3 ? Date.now() + 10_000 : 0 });
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export function recordMetric(metric: Omit<MetricRecord, "recordedAt">) {
  metrics.push({ ...metric, recordedAt: Date.now() });
  if (metrics.length > MAX_METRICS) metrics.shift();
}

export async function measureProcess<T>(process: string, loader: () => Promise<T>, provider?: string) {
  const startedAt = performance.now();
  try {
    const value = await loader();
    recordMetric({ process, durationMs: performance.now() - startedAt, cache: "bypass", provider });
    return value;
  } catch (error) {
    recordMetric({
      process,
      durationMs: performance.now() - startedAt,
      cache: "bypass",
      provider,
      error: error instanceof Error ? error.message : "unknown"
    });
    throw error;
  }
}

export function getPerformanceMetrics() {
  const grouped = new Map<string, MetricRecord[]>();
  for (const metric of metrics) {
    const current = grouped.get(metric.process) ?? [];
    current.push(metric);
    grouped.set(metric.process, current);
  }

  return [...grouped.entries()].map(([process, records]) => ({
    process,
    count: records.length,
    averageMs: Math.round(records.reduce((sum, item) => sum + item.durationMs, 0) / records.length),
    maxMs: Math.round(Math.max(...records.map((item) => item.durationMs))),
    cacheHits: records.filter((item) => item.cache === "hit").length,
    cacheMisses: records.filter((item) => item.cache === "miss").length,
    errors: records.filter((item) => item.error).length,
    providers: [...new Set(records.map((item) => item.provider).filter(Boolean))]
  }));
}

export function clearPerformanceCache() {
  cache.clear();
}

export const CACHE_TTL = {
  live: 20_000,
  stats: 30_000,
  fixtures: 5 * 60_000,
  historical: 60 * 60_000,
  h2h: 6 * 60 * 60_000,
  default: 30_000
} as const;
