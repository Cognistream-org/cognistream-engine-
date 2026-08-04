import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, readThresholds } from './lib.js';

/**
 * Smoke: low VU, health + basic public/read paths.
 * Auth optional — if API_KEY set, also hits GET /v1/agents.
 */
export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    ...readThresholds,
  },
};

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  check(health, {
    'health 200': (r) => r.status === 200,
  });

  const ready = http.get(`${BASE_URL}/health/ready`);
  check(ready, {
    'ready 200 or 503': (r) => r.status === 200 || r.status === 503,
  });

  if (__ENV.API_KEY) {
    const agents = http.get(`${BASE_URL}/v1/agents?limit=10`, {
      headers: {
        'X-API-Key': __ENV.API_KEY,
      },
    });
    check(agents, {
      'agents 200': (r) => r.status === 200,
    });
  }

  sleep(0.3);
}
