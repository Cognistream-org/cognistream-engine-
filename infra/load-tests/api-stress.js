import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, authHeaders } from './lib.js';

/**
 * Stress: find breaking point (1000 VU, 2m).
 * Mix of health + authenticated reads; optional light writes if AGENT/SELLER set.
 * Thresholds are aspirational — expect failures near capacity; use to chart cliffs.
 */
export const options = {
  stages: [
    { duration: '30s', target: 200 },
    { duration: '30s', target: 500 },
    { duration: '40s', target: 1000 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    // Keep error budget visible; stress runs often exceed these — review metrics.
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1000'],
  },
};

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health up': (r) => r.status === 200 });

  if (__ENV.API_KEY) {
    const agents = http.get(`${BASE_URL}/v1/agents?limit=5`, {
      headers: authHeaders(),
    });
    check(agents, {
      'agents ok or limited': (r) =>
        r.status === 200 || r.status === 429 || r.status === 401,
    });
  }

  sleep(0.1);
}
