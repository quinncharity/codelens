import { Link } from '@tanstack/react-router'
import { Terminal } from 'lucide-react'

export default function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-cyan-500/10 bg-[#0a0f1a]/80 backdrop-blur-md">
      <div className="container flex h-14 items-center justify-between">
        <Link 
          to="/" 
          className="group flex items-center gap-2 font-semibold tracking-tight transition-all duration-300"
        >
          <div className="relative">
            <Terminal className="w-5 h-5 text-cyan-400 transition-all duration-300 group-hover:drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
            <div className="absolute inset-0 w-5 h-5 bg-cyan-400/20 rounded-full blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>
          <span className="text-foreground group-hover:text-cyan-300 transition-colors duration-300">
            CodeLens
          </span>
        </Link>
        
        <div className="flex items-center gap-4">
          <span className="hidden sm:inline text-xs text-muted-foreground/60 font-mono uppercase tracking-wider">
            Framework Detection
          </span>
          <div className="w-2 h-2 rounded-full bg-cyan-400/60 animate-pulse-slow" />
        </div>
      </div>
    </header>
  )
}
