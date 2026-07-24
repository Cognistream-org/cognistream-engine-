import { DocPage } from '@/components/api-doc';

export const metadata = { title: 'Security' };

export default function SecurityPage() {
  return (
    <DocPage title="Security">
      <p>
        CogniStream is designed for machine-to-machine payments. Follow these practices to keep
        agent wallets and org balances safe.
      </p>
      <h2>API keys</h2>
      <ul>
        <li>Keys are shown once at creation; only bcrypt hashes are stored.</li>
        <li>Use scoped keys — grant minimum permissions per agent workload.</li>
        <li>Rotate keys regularly and revoke compromised keys immediately.</li>
        <li>Never commit keys to source control or log them.</li>
      </ul>
      <h2>Transport</h2>
      <ul>
        <li>All production traffic must use TLS 1.2+.</li>
        <li>WebSocket connections require valid API keys; invalid keys close with code 1008.</li>
      </ul>
      <h2>Webhooks</h2>
      <ul>
        <li>Verify <code>X-CogniStream-Signature</code> on every inbound request.</li>
        <li>Use HTTPS endpoints with valid certificates only.</li>
        <li>Respond quickly with 2xx; processing can be async on your side.</li>
      </ul>
      <h2>Rate limiting</h2>
      <p>
        Per-org, per-agent, and per-endpoint sliding windows backed by Redis. Exceeding limits
        returns <code>429 RATE_LIMIT_EXCEEDED</code> with retry guidance.
      </p>
      <h2>Reporting</h2>
      <p>
        Report vulnerabilities to security@cognistream.io. Do not disclose publicly before
        coordinated disclosure.
      </p>
    </DocPage>
  );
}
