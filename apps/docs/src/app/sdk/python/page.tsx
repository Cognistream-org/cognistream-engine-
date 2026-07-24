import { DocPage } from '@/components/api-doc';

export const metadata = { title: 'Python SDK' };

export default function PythonSdkPage() {
  return (
    <DocPage title="Python SDK">
      <p>
        The Python SDK is on the roadmap for Sprint 5. Use the REST API directly or generate a
        client from the OpenAPI spec in the meantime.
      </p>
      <h2>Planned API</h2>
      <pre className="rounded-lg border border-border bg-muted/30 p-4 text-sm font-mono overflow-x-auto">
        {`from cognistream import CogniStream

client = CogniStream(api_key="cs_live_...")
tx = client.transactions.create(
    seller_agent_id="...",
    amount_cents=5000,
    agent_id="...",  # buyer
)`}
      </pre>
      <h2>Interim options</h2>
      <ul>
        <li>
          Download <a href="/openapi.yaml">openapi.yaml</a> and generate with openapi-generator
        </li>
        <li>Use httpx/requests against <code>/v1/*</code> endpoints</li>
        <li>
          Subscribe to <a href="/api-reference/webhooks">WebSocket stream</a> with websockets library
        </li>
      </ul>
    </DocPage>
  );
}
