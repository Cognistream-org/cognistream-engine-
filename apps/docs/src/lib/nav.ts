export type NavItem = {
  title: string;
  href: string;
  children?: NavItem[];
};

export const docsNav: NavItem[] = [
  { title: 'Welcome', href: '/' },
  { title: 'Quickstart', href: '/quickstart' },
  {
    title: 'Concepts',
    href: '/concepts/architecture',
    children: [
      { title: 'Architecture', href: '/concepts/architecture' },
      { title: 'Escrow', href: '/concepts/escrow' },
      { title: 'Reputation', href: '/concepts/reputation' },
      { title: 'Webhooks', href: '/concepts/webhooks' },
    ],
  },
  {
    title: 'API Reference',
    href: '/api-reference/agents',
    children: [
      { title: 'Agents', href: '/api-reference/agents' },
      { title: 'Transactions', href: '/api-reference/transactions' },
      { title: 'Disputes', href: '/api-reference/disputes' },
      { title: 'Billing', href: '/api-reference/billing' },
      { title: 'Stripe Connect', href: '/api-reference/stripe-connect' },
      { title: 'Webhooks', href: '/api-reference/webhooks' },
    ],
  },
  {
    title: 'SDK',
    href: '/sdk/typescript',
    children: [
      { title: 'TypeScript', href: '/sdk/typescript' },
      { title: 'Python', href: '/sdk/python' },
    ],
  },
  { title: 'Security', href: '/security' },
  { title: 'Pricing', href: '/pricing' },
];

export function flattenNav(items: NavItem[]): NavItem[] {
  const result: NavItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children) {
      result.push(...item.children);
    }
  }
  return result;
}
