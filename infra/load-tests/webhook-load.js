import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import { BASE_URL, writeThresholds } from './lib.js';

/**
 * Webhook ingestion load against POST /v1/webhooks/stripe.
 * Requires STRIPE_WEBHOOK_SECRET matching the API env so signatures verify.
 *
 * Note: events use synthetic ids — handlers may no-op unknown types but
 * should return 2xx after signature + idempotency checks for supported types
 * or fail closed. We accept 200/400 as "handled" for signature path latency;
 * prefer 200 with a harmless event type the API acknowledges.
 */
export const options = {
  vus: 50,
  duration: '3m',
  thresholds: {
    ...writeThresholds,
  },
};

function stripeSignature(secret, body, timestamp) {
  const payload = `${timestamp}.${body}`;
  // k6: hmac(algorithm, secret, data, outputEncoding)
  const v1 = crypto.hmac('sha256', secret, payload, 'hex');
  return `t=${timestamp},v1=${v1}`;
}

export default function () {
  const secret = __ENV.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required');
  }

  const eventId = `evt_k6_${__VU}_${__ITER}_${Date.now()}`;
  const body = JSON.stringify({
    id: eventId,
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    type: 'ping',
    data: { object: { id: 'obj_k6' } },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  });

  const ts = Math.floor(Date.now() / 1000);
  const res = http.post(`${BASE_URL}/v1/webhooks/stripe`, body, {
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': stripeSignature(secret, body, ts),
    },
  });

  // 200 = processed/duplicate; 400 = bad signature/payload — still counts as load on the path.
  check(res, {
    'webhook responded': (r) => r.status === 200 || r.status === 400,
    'not 5xx': (r) => r.status < 500,
  });

  sleep(0.2);
}
