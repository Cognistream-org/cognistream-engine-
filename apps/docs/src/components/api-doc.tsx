import type { ReactNode } from 'react';
import { CodeBlock } from './code-block';

export type ApiEndpointDoc = {
  method: string;
  path: string;
  description: string;
  scopes: string[];
  requestExample: string;
  responseExample: string;
  errorCodes: Array<{ code: string; status: number; description: string }>;
};

export function ApiEndpointSection({ endpoint }: { endpoint: ApiEndpointDoc }) {
  return (
    <section className="mb-12 border-b border-border pb-10 last:border-0">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded bg-teal/15 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
          {endpoint.method}
        </span>
        <code className="font-mono text-sm">{endpoint.path}</code>
      </div>
      <p>{endpoint.description}</p>
      <h3>Auth scopes</h3>
      <ul>
        {endpoint.scopes.map((scope) => (
          <li key={scope}>
            <code>{scope}</code>
          </li>
        ))}
      </ul>
      <h3>Request example</h3>
      <CodeBlock code={endpoint.requestExample} language="http" />
      <h3>Response example</h3>
      <CodeBlock code={endpoint.responseExample} language="json" />
      <h3>Error codes</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Code</th>
              <th className="px-4 py-2 text-left font-medium">HTTP</th>
              <th className="px-4 py-2 text-left font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {endpoint.errorCodes.map((err) => (
              <tr key={err.code} className="border-t border-border">
                <td className="px-4 py-2 font-mono text-xs">{err.code}</td>
                <td className="px-4 py-2">{err.status}</td>
                <td className="px-4 py-2 text-muted-foreground">{err.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DocPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h1>{title}</h1>
      {children}
    </>
  );
}
