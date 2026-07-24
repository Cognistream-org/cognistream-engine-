'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { docsNav, flattenNav, type NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';

function NavLink({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname();
  const active = pathname === item.href;

  return (
    <Link
      href={item.href}
      className={cn(
        'block rounded-md px-2 py-1.5 text-sm transition-colors',
        depth > 0 && 'pl-4',
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
      )}
    >
      {item.title}
    </Link>
  );
}

export function Sidebar({ query }: { query: string }) {
  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalized) return docsNav;

    const flat = flattenNav(docsNav);
    const matches = new Set(
      flat.filter((item) => item.title.toLowerCase().includes(normalized)).map((i) => i.href),
    );

    return docsNav
      .map((section) => {
        if (section.children) {
          const children = section.children.filter((c) => matches.has(c.href));
          if (children.length === 0 && !matches.has(section.href)) return null;
          return { ...section, children: children.length ? children : section.children };
        }
        return matches.has(section.href) ? section : null;
      })
      .filter(Boolean) as NavItem[];
  }, [normalized]);

  return (
    <nav className="space-y-6">
      {filtered.map((section) => (
        <div key={section.href}>
          {section.children ? (
            <>
              <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.children.map((child) => (
                  <NavLink key={child.href} item={child} depth={1} />
                ))}
              </div>
            </>
          ) : (
            <NavLink item={section} />
          )}
        </div>
      ))}
    </nav>
  );
}

export function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        placeholder="Filter docs..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none ring-primary focus:ring-2"
      />
    </div>
  );
}

export function DocsShell({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[280px_1fr]">
      <aside className="border-b border-border lg:border-b-0 lg:border-r lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
        <div className="p-4 space-y-4">
          <SearchInput value={query} onChange={setQuery} />
          <Sidebar query={query} />
        </div>
      </aside>
      <main className="min-w-0">
        <div className="mx-auto max-w-3xl px-6 py-10 prose-docs">{children}</div>
      </main>
    </div>
  );
}
