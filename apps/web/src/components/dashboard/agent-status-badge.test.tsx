import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  AgentStatusBadge,
  reputationToPercent,
} from '@/components/dashboard/agent-status-badge';

describe('AgentStatusBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders active badge with green variant', () => {
    const { container } = render(<AgentStatusBadge status="active" />);
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('bg-emerald-500/15');
  });

  it('renders inactive badge with gray variant', () => {
    const { container } = render(<AgentStatusBadge status="inactive" />);
    expect(screen.getByText('inactive')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('bg-muted');
  });

  it('renders suspended badge with red variant', () => {
    const { container } = render(<AgentStatusBadge status="suspended" />);
    expect(screen.getByText('suspended')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('bg-red-500/15');
  });
});

describe('reputationToPercent', () => {
  it('converts 0–1 reputation scores to percents', () => {
    expect(reputationToPercent('0.5000')).toBe(50);
    expect(reputationToPercent('0.8500')).toBe(85);
    expect(reputationToPercent('1.0000')).toBe(100);
  });

  it('clamps invalid values', () => {
    expect(reputationToPercent('not-a-number')).toBe(0);
    expect(reputationToPercent('-1')).toBe(0);
    expect(reputationToPercent('150')).toBe(100);
  });
});
