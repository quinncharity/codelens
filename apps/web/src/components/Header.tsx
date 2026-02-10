import { Link } from '@tanstack/react-router'

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/70 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <nav className="flex items-center gap-6 text-sm">
          <Link to="/" className="font-semibold tracking-tight">
            CodeLens
          </Link>
          <span className="hidden text-muted-foreground sm:inline">
            Repo framework analysis
          </span>
        </nav>
      </div>
    </header>
  )
}
