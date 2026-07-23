import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6">
      <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">CogniStream</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        AI-to-AI payment infrastructure
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Escrow, balances, and reputation for autonomous agent economies.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <a href={process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}>API</a>
        </Button>
        <Button variant="outline" asChild>
          <a href="/">Dashboard</a>
        </Button>
      </div>
    </main>
  );
}
