import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const usePathnameMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    ...props
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/use-realtime', () => ({
  useRealtime: () => undefined,
}));

import { DashboardSidebar } from '@/components/dashboard/sidebar';

describe('DashboardSidebar', () => {
  beforeEach(() => {
    usePathnameMock.mockReturnValue('/dashboard/overview');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all navigation links', () => {
    render(<DashboardSidebar />);

    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /agents/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /transactions/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /api keys/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
  });

  it('marks active link with bg-accent class', () => {
    usePathnameMock.mockReturnValue('/dashboard/agents');
    render(<DashboardSidebar />);

    const agentsLink = screen.getByRole('link', { name: /agents/i });
    expect(agentsLink.className).toContain('bg-accent');
  });

  it('each link has correct icon and label', () => {
    const { container } = render(<DashboardSidebar />);
    const nav = container.querySelector('nav');
    expect(nav).toBeTruthy();
    const links = screen.getAllByRole('link').filter((el) =>
      ['Overview', 'Agents', 'Transactions', 'API Keys', 'Settings'].includes(el.textContent ?? ''),
    );
    expect(links).toHaveLength(5);
    for (const link of links) {
      expect(link.querySelector('svg')).toBeTruthy();
      expect(link.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it('CogniStream brand link navigates to overview', () => {
    render(<DashboardSidebar />);
    expect(screen.getByRole('link', { name: /cognistream/i })).toHaveAttribute(
      'href',
      '/dashboard/overview',
    );
  });
});
