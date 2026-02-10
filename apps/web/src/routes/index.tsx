import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2, Terminal, GitBranch, Sparkles } from 'lucide-react'

import { analysisClient } from '../lib/rpc'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const navigate = useNavigate()

  const [gitUrl, setGitUrl] = useState('')
  const [ref, setRef] = useState('')
  const [running, setRunning] = useState(false)
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [phase, setPhase] = useState<string>('')
  const [progress, setProgress] = useState<number>(0)
  const [message, setMessage] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const [savedRepos, setSavedRepos] = useState<any[]>([])
  const [savedLoading, setSavedLoading] = useState(false)
  const [savedError, setSavedError] = useState<string | null>(null)

  const loadSaved = async () => {
    setSavedError(null)
    setSavedLoading(true)
    try {
      const r = await analysisClient.listRepos({ limit: 25, offset: 0 })
      setSavedRepos(r.repos ?? [])
    } catch (e: any) {
      setSavedError(e?.message ?? String(e))
    } finally {
      setSavedLoading(false)
    }
  }

  useEffect(() => {
    void loadSaved()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const statusPill = (status: string) => {
    const base =
      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-mono uppercase tracking-wide border'
    if (status === 'SUCCEEDED') {
      return `${base} border-emerald-400/30 text-emerald-300 bg-emerald-500/10`
    }
    if (status === 'FAILED') {
      return `${base} border-red-400/30 text-red-300 bg-red-500/10`
    }
    if (status === 'RUNNING') {
      return `${base} border-cyan-400/30 text-cyan-200 bg-cyan-500/10`
    }
    return `${base} border-white/10 text-muted-foreground bg-white/5`
  }

  const formatUpdatedAt = (iso: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  }

  const start = async (opts?: { gitUrlOverride?: string; refOverride?: string }) => {
    const url = (opts?.gitUrlOverride ?? gitUrl).trim()
    const rref = (opts?.refOverride ?? ref).trim()

    setError(null)
    setRunning(true)
    setAnalysisId(null)
    setPhase('START')
    setProgress(0)
    setMessage('Initializing analysis sequence...')

    try {
      for await (const ev of analysisClient.analyzeStream({
        gitUrl: url,
        ref: rref,
      })) {
        if (ev.id) setAnalysisId(ev.id)
        setPhase(ev.phase)
        setProgress(ev.progress ?? 0)
        setMessage(ev.message ?? '')

        if (ev.phase === 'DONE' && ev.id) {
          navigate({ to: '/analysis/$id', params: { id: ev.id } })
          return
        }

        if (ev.phase === 'ERROR') {
          setError(ev.message || 'Unknown error')
          return
        }
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="min-h-[calc(100dvh-var(--app-header-h))] flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-xl animate-fade-in-up">
        {/* Hero Title */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-3 mb-4">
            <Terminal className="w-8 h-8 text-cyan-400" />
            <h1 className="text-4xl font-bold tracking-tight text-gradient">
              CodeLens
            </h1>
          </div>
          <p className="text-muted-foreground text-lg max-w-md mx-auto">
            Intelligent repository analysis. Detect frameworks, architecture, and dependencies in seconds.
          </p>
        </div>

        {/* Main Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
          className="space-y-6"
        >
          {/* Git URL Input */}
          <div className="group">
            <label className="block text-sm font-medium text-cyan-400/80 mb-2 font-mono tracking-wider uppercase text-xs">
              <span className="inline-flex items-center gap-2">
                <GitBranch className="w-3.5 h-3.5" />
                Repository URL
              </span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                disabled={running}
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-black/40 border border-cyan-500/20 rounded-lg px-4 py-4 
                  text-foreground placeholder:text-muted-foreground/50
                  focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30
                  transition-all duration-300 font-mono text-sm
                  disabled:opacity-50 disabled:cursor-not-allowed
                  hover:border-cyan-500/30"
              />
              <div className="absolute inset-0 rounded-lg pointer-events-none opacity-0 group-focus-within:opacity-100 transition-opacity duration-500">
                <div className="absolute inset-0 rounded-lg bg-cyan-500/5" />
              </div>
            </div>
          </div>

          {/* Ref Input */}
          <div className="group">
            <label className="block text-sm font-medium text-cyan-400/80 mb-2 font-mono tracking-wider uppercase text-xs">
              <span className="inline-flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" />
                Reference (optional)
              </span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="main / v1.2.3 / commit-sha"
                disabled={running}
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-black/40 border border-cyan-500/20 rounded-lg px-4 py-3
                  text-foreground placeholder:text-muted-foreground/50
                  focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30
                  transition-all duration-300 font-mono text-sm
                  disabled:opacity-50 disabled:cursor-not-allowed
                  hover:border-cyan-500/30"
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={running || !gitUrl.trim()}
            className="w-full group relative overflow-hidden rounded-lg bg-cyan-500/10 
              border border-cyan-500/30 hover:border-cyan-400/50
              px-6 py-4 font-mono text-sm font-medium text-cyan-400
              transition-all duration-300
              disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-cyan-500/30
              hover:bg-cyan-500/20 hover:text-cyan-300
              focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {running ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>ANALYZING...</span>
                </>
              ) : (
                <>
                  <Terminal className="w-4 h-4" />
                  <span>INITIATE ANALYSIS</span>
                </>
              )}
            </span>
            {!running && (
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/0 via-cyan-500/10 to-cyan-500/0 
                translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
            )}
          </button>
        </form>

        {/* Analysis Progress */}
        {running && (
          <div className="mt-8 animate-fade-in-up">
            <div className="bg-black/40 border border-cyan-500/20 rounded-lg p-6 font-mono">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-cyan-400/60 uppercase tracking-wider">Status</span>
                <span className="text-xs text-cyan-400/60 uppercase tracking-wider">
                  {Math.round(progress * 100)}%
                </span>
              </div>
              
              {/* Phase */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-cyan-400 font-medium text-sm">
                  {phase || 'INITIALIZING'}
                </span>
              </div>
              
              {/* Progress Bar */}
              <div className="relative h-1 bg-cyan-500/10 rounded-full overflow-hidden mb-4">
                <div 
                  className="absolute inset-y-0 left-0 bg-cyan-400 rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
                />
                <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent animate-scan" />
              </div>
              
              {/* Message */}
              {message && (
                <p className="text-sm text-muted-foreground">
                  <span className="text-cyan-400/60">&gt;</span> {message}
                </p>
              )}
              
              {/* Analysis ID */}
              {analysisId && (
                <div className="mt-4 pt-4 border-t border-cyan-500/10">
                  <span className="text-xs text-muted-foreground">
                    ID: <span className="text-cyan-400/80 font-mono">{analysisId}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mt-6 animate-fade-in-up">
            <div className="bg-red-950/30 border border-red-500/30 rounded-lg p-4 font-mono">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-red-400 text-sm font-medium uppercase tracking-wider">Error</span>
              </div>
              <p className="text-sm text-red-300/80">{error}</p>
            </div>
          </div>
        )}

        {/* Saved repos */}
        <div className="mt-10 animate-fade-in-up">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-mono tracking-wider uppercase text-cyan-400/80">
              Saved repos
            </h2>
            <button
              type="button"
              onClick={() => void loadSaved()}
              disabled={savedLoading}
              className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 font-mono text-xs text-cyan-300
                hover:bg-cyan-500/15 hover:border-cyan-400/50 transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savedLoading ? 'REFRESHING…' : 'REFRESH'}
            </button>
          </div>

          {savedError ? (
            <div className="mb-3 bg-red-950/30 border border-red-500/30 rounded-lg p-3 font-mono">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-red-400 text-xs font-medium uppercase tracking-wider">
                  Failed to load saved repos
                </span>
              </div>
              <p className="mt-2 text-xs text-red-300/80 break-words">{savedError}</p>
            </div>
          ) : null}

          <div className="bg-black/40 border border-cyan-500/20 rounded-lg overflow-hidden">
            {savedRepos?.length ? (
              <div className="divide-y divide-cyan-500/10">
                {savedRepos.map((r: any) => (
                  <div
                    key={r.lastAnalysisId}
                    className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between hover:bg-cyan-500/5 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="font-mono text-sm text-foreground truncate"
                          title={r.gitUrl}
                        >
                          {r.gitUrl}
                        </span>
                        <span className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-mono uppercase tracking-wide border border-cyan-500/20 text-cyan-300/80 bg-cyan-500/5">
                          {r.ref ? `ref:${r.ref}` : 'ref:(default)'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={statusPill(r.lastStatus)}>
                          {r.lastStatus || 'UNKNOWN'}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground/70">
                          UPDATED {formatUpdatedAt(r.lastUpdatedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        to="/analysis/$id"
                        params={{ id: r.lastAnalysisId }}
                        className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 font-mono text-xs text-cyan-300
                          hover:bg-cyan-500/15 hover:border-cyan-400/50 transition-colors"
                      >
                        OPEN
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setGitUrl(r.gitUrl ?? '')
                          setRef(r.ref ?? '')
                          void start({ gitUrlOverride: r.gitUrl, refOverride: r.ref })
                        }}
                        disabled={running}
                        className="rounded-md border border-cyan-500/20 bg-black/30 px-3 py-1.5 font-mono text-xs text-cyan-300/90
                          hover:bg-black/40 hover:border-cyan-400/40 transition-colors
                          disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        RE-ANALYZE
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-6">
                <p className="font-mono text-xs text-muted-foreground/70">
                  No saved repos yet. Run an analysis to populate this list.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer hint */}
      <div className="mt-auto pt-12 text-center">
        <p className="text-xs text-muted-foreground/50 font-mono">
          Enter a Git repository URL to begin analysis
        </p>
      </div>
    </div>
  )
}
