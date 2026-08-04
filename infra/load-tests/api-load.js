import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, authHeaders, writeThresholds } from './lib.js';

/**
 * Load: transaction creation flow (write path).
 * Requires API_KEY, AGENT_ID (buyer), SELLER_ID.
 */
export const options = {
  vus: 100,
  duration: '5m',
  thresholds: {
    ...writeThresholds,
  },
};

export default function () {
  const buyer = __ENV.AGENT_ID;
  const seller = __ENV.SELLER_ID;
  if (!buyer || !seller) {
    throw new Error('AGENT_ID and SELLER_ID are required');
  }

  const idem = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const payload = JSON.stringify({
    sellerId: seller,
    amountCents: 100,
    description: 'k6 load test',
    idempotencyKey: idem.slice(0, 64),
  });

  const res = http.post(`${BASE_URL}/v1/transactions`, payload, {
    headers: authHeaders({
      'X-Agent-Id': buyer,
      'X-Idempotency-Key': idem.slice(0, 64),
    }),
  });

  check(res, {
    'tx create 2xx': (r) => r.status === 200 || r.status === 201,
    'tx has body': (r) => r.body && r.body.length > 0,
  });

  sleep(0.5);
}
