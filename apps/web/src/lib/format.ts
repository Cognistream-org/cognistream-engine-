/**
 * Format integer cents as USD currency string.
 */
export function formatCents(cents: string | number): string {
  const value = typeof cents === 'string' ? Number(cents) : cents;
  if (!Number.isFinite(value)) return '$0.00';
  const dollars = value / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

export function truncateId(id: string, length = 8): string {
  if (id.length <= length + 3) return id;
  return `${id.slice(0, length)}…`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
