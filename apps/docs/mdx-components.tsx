import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import { CodeBlock } from '@/components/code-block';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    a: ({ href, children, ...props }) => {
      if (href?.startsWith('/')) {
        return (
          <Link href={href} {...props}>
            {children}
          </Link>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    },
    pre: ({ children }) => <>{children}</>,
    code: ({ children, className }) => {
      const lang = className?.replace('language-', '') ?? 'text';
      const text = String(children).replace(/\n$/, '');
      if (text.includes('\n')) {
        return <CodeBlock code={text} language={lang} />;
      }
      return <code>{children}</code>;
    },
    ...components,
  };
}
