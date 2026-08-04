/**
 * Shared k6 helpers for CogniStream API load tests.
 * Env:
 *   BASE_URL   default http://localhost:3001
 *   API_KEY    required for authenticated scenarios (X-API-Key)
 *   AGENT_ID   optional buyer agent for transaction flows
 *   SELLER_ID  optional seller agent id
 */
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export function apiKey() {
  const key = __ENV.API_KEY;
  if (!key) {
    throw new Error('API_KEY env var is required for this scenario');
  }
  return key;
}

export function authHeaders(extra = {}) {
  return Object.assign(
    {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey(),
    },
    extra,
  );
}

/** Threshold helpers — read p95 < 200ms, write p95 < 500ms, errors < 1%. */
export const readThresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<200'],
};

export const writeThresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<500'],
};

export function checkOk(res, check, name) {
  check(res, {
    [`${name} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
  });
}
