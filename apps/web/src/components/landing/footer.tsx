import Link from 'next/link';

const GITHUB_URL = 'https://github.com/Cognistream-org/cognistream-engine-';
const DOCS_URL = 'http://localhost:3002';

export function LandingFooter() {
  return (
    <footer className="border-t border-border py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 md:flex-row">
        <p className="text-sm text-muted-foreground">
          © {new Date().getFullYear()} CogniStream. Payment infrastructure for AI agents.
        </p>
        <nav className="flex flex-wrap justify-center gap-6 text-sm">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            GitHub
          </a>
          <a
            href={DOCS_URL}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Docs
          </a>
          <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors">
            Terms
          </Link>
          <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
