import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Terminal, GitBranch, Sparkles, Trash2, Zap, Cpu, Globe, FileText, Layers, Lightbulb, Search } from 'lucide-react'

import { cn } from '../lib/utils'
import { analysisClient } from '../lib/rpc'

interface ExampleRepo {
  name: string
  description: string
  url: string
  category: string
}

interface StreamEvent {
  ts: number
  phase: string
  progress: number
  message: string
  agent?: string
  kind?: string
  step?: number
  stepTotal?: number
}

interface AgentState {
  name: string
  displayName: string
  status: 'pending' | 'running' | 'completed' | 'error'
  progress: number
  message: string
  events: StreamEvent[]
}

const AGENT_ORDER = ['summary', 'frameworks', 'patterns', 'insights'] as const
const AGENT_NAMES = new Set<string>(AGENT_ORDER)

const AGENT_DISPLAY: Record<string, { displayName: string; icon: ReactNode }> = {
  summary: { displayName: 'Summary', icon: <FileText className="w-3.5 h-3.5" /> },
  frameworks: { displayName: 'Frameworks', icon: <Layers className="w-3.5 h-3.5" /> },
  patterns: { displayName: 'Patterns', icon: <Search className="w-3.5 h-3.5" /> },
  insights: { displayName: 'Insights', icon: <Lightbulb className="w-3.5 h-3.5" /> },
}

const AGENT_WEIGHTS: Record<string, number> = {
  summary: 10,
  frameworks: 20,
  patterns: 30,
  insights: 15,
}
const TOTAL_WEIGHT = Object.values(AGENT_WEIGHTS).reduce((a, b) => a + b, 0)

function makeInitialAgents(): Record<string, AgentState> {
  return Object.fromEntries(
    AGENT_ORDER.map(name => [name, {
      name,
      displayName: AGENT_DISPLAY[name].displayName,
      status: 'pending' as const,
      progress: 0,
      message: 'Waiting\u2026',
      events: [],
    }])
  )
}

const exampleRepos: ExampleRepo[] = [
  // Frameworks & Libraries
  { name: 'facebook/react', description: 'A declarative, efficient, and flexible JavaScript library for building user interfaces.', url: 'https://github.com/facebook/react', category: 'Frameworks' },
  { name: 'vercel/next.js', description: 'The React Framework for the Web. Used by some of the world\'s largest companies.', url: 'https://github.com/vercel/next.js', category: 'Frameworks' },
  { name: 'shadcn-ui/ui', description: 'Beautifully designed components that you can copy and paste into your apps.', url: 'https://github.com/shadcn-ui/ui', category: 'Frameworks' },

  // AI & Machine Learning
  { name: 'langchain-ai/langchain', description: 'Building applications with LLMs through composability.', url: 'https://github.com/langchain-ai/langchain', category: 'AI & ML' },
  { name: 'microsoft/generative-ai-for-beginners', description: '21 Lessons, Get Started Building with Generative AI.', url: 'https://github.com/microsoft/generative-ai-for-beginners', category: 'AI & ML' },
  { name: 'anthropics/anthropic-cookbook', description: 'A collection of recipes showcasing how to build with Claude.', url: 'https://github.com/anthropics/anthropic-cookbook', category: 'AI & ML' },

  // Developer Tools
  { name: 'microsoft/vscode', description: 'Visual Studio Code is a code editor redefined and optimized for building modern web and cloud applications.', url: 'https://github.com/microsoft/vscode', category: 'Developer Tools' },
  { name: 'kubernetes/kubernetes', description: 'Production-Grade Container Scheduling and Management.', url: 'https://github.com/kubernetes/kubernetes', category: 'Developer Tools' },
]

const categoryIcons: Record<string, ReactNode> = {
  'Frameworks': <Zap className="w-4 h-4" />,
  'AI & ML': <Cpu className="w-4 h-4" />,
  'Developer Tools': <Globe className="w-4 h-4" />,
}

export const Route = createFileRoute('/')({ component: Home })

function ExampleRepos({ onSelect, running }: { onSelect: (repo: ExampleRepo) => void, running: boolean }) {
  const grouped = exampleRepos.reduce((acc, repo) => {
    if (!acc[repo.category]) acc[repo.category] = []
    acc[repo.category].push(repo)
    return acc
  }, {} as Record<string, ExampleRepo[]>)

  return (
    <div className="w-full animate-fade-in-up">
      <h2 className="text-sm font-mono tracking-wider uppercase text-[var(--navy)] mb-4 flex items-center gap-2">
        <Sparkles className="w-4 h-4" />
        Try an Example
      </h2>

      {Object.entries(grouped).map(([category, repos], groupIdx) => (
        <div key={category} className="mb-6 last:mb-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[var(--navy-light)]">{categoryIcons[category]}</span>
            <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--navy-light)]">{category}</h3>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {repos.map((repo, idx) => (
              <button
                key={repo.name}
                onClick={() => onSelect(repo)}
                disabled={running}
                className="group relative text-left bg-white border border-gray-200 rounded-lg p-4
                  hover:border-[var(--navy-light)]/30 hover:bg-gray-50
                  shadow-sm hover:shadow-md
                  transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed
                  animate-fade-in-up"
                style={{ animationDelay: `${(groupIdx * 100) + (idx * 50)}ms` }}
              >
                {/* Glow effect on hover */}

                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-2">
                    <GitBranch className="w-3.5 h-3.5 text-[var(--navy-light)] group-hover:text-[var(--navy)] transition-colors" />
                    <span className="font-mono text-sm text-foreground group-hover:text-[var(--navy)] transition-colors truncate">
                      {repo.name}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground/80 line-clamp-2 leading-relaxed">
                    {repo.description}
                  </p>
                </div>

                {/* Arrow indicator */}
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-1 group-hover:translate-x-0">
                  <span className="text-[var(--navy-light)] text-xs font-mono">&rarr;</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- Per-agent streaming card ---------- */

function AgentCard({ agent }: { agent: AgentState }) {
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [agent.events.length])

  const statusDot = {
    pending: 'bg-gray-300',
    running: 'bg-[var(--navy)] animate-pulse',
    completed: 'bg-emerald-500',
    error: 'bg-red-500',
  }[agent.status]

  const barColor = {
    pending: 'bg-gray-200',
    running: 'bg-[var(--navy)]',
    completed: 'bg-emerald-500',
    error: 'bg-red-500',
  }[agent.status]

  const icon = AGENT_DISPLAY[agent.name]?.icon

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 font-mono shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full shrink-0', statusDot)} />
          <span className="text-[var(--navy-light)]">{icon}</span>
          <span className="text-xs font-medium text-[var(--navy)] uppercase tracking-wider">
            {agent.displayName}
          </span>
        </div>
        <span className="text-[11px] text-gray-400 tabular-nums">
          {Math.round(agent.progress * 100)}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative h-1 bg-gray-100 rounded-full overflow-hidden mb-2.5">
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-500', barColor)}
          style={{ width: `${Math.max(0, Math.min(100, agent.progress * 100))}%` }}
        />
        {agent.status === 'running' && (
          <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-transparent via-[var(--navy)]/20 to-transparent animate-scan" />
        )}
      </div>

      {/* Message */}
      <p className="text-[11px] text-muted-foreground truncate mb-2">
        <span className="text-[var(--navy-light)]">&gt;</span> {agent.message}
      </p>

      {/* Mini event log */}
      {agent.events.length > 0 && (
        <div className="max-h-16 overflow-auto rounded border border-gray-100 bg-gray-50 px-2 py-1">
          <div className="space-y-0.5 text-[10px] leading-relaxed text-muted-foreground">
            {agent.events.slice(-6).map((e, idx) => (
              <div key={`${e.ts}:${idx}`} className="truncate">
                {e.message || '\u2014'}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Home page ---------- */

function Home() {
  const navigate = useNavigate()

  const [gitUrl, setGitUrl] = useState('')
  const [ref, setRef] = useState('')
  const [running, setRunning] = useState(false)
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [phase, setPhase] = useState<string>('')
  const [message, setMessage] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [agents, setAgents] = useState<Record<string, AgentState>>(makeInitialAgents)

  const logEndRef = useRef<HTMLDivElement | null>(null)

  const [savedRepos, setSavedRepos] = useState<any[]>([])
  const [savedLoading, setSavedLoading] = useState(false)
  const [savedError, setSavedError] = useState<string | null>(null)

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [repoToDelete, setRepoToDelete] = useState<{ gitUrl: string; ref: string } | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Compute overall progress as weighted average of agent progress
  const overallProgress = useMemo(() => {
    // Before ANALYZE phase, use engine-level progress
    if (phase !== 'ANALYZE') {
      if (phase === 'CLONE') return 0.05
      if (phase === 'INDEX') return 0.15
      if (phase === 'STORE') return 0.95
      if (phase === 'DONE') return 1.0
      return 0
    }
    let weighted = 0
    for (const name of AGENT_ORDER) {
      const w = AGENT_WEIGHTS[name] ?? 0
      const p = agents[name]?.progress ?? 0
      weighted += p * w
    }
    // Map agent progress (0-1) into the ANALYZE range (0.25-0.90)
    const agentFrac = weighted / TOTAL_WEIGHT
    return 0.25 + agentFrac * 0.65
  }, [phase, agents])

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

  useEffect(() => {
    if (!running) return
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [events.length, running])

  const statusPill = (status: string) => {
    const base =
      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-mono uppercase tracking-wide border'
    if (status === 'SUCCEEDED') {
      return `${base} border-emerald-200 text-emerald-700 bg-emerald-50`
    }
    if (status === 'FAILED') {
      return `${base} border-red-200 text-red-700 bg-red-50`
    }
    if (status === 'RUNNING') {
      return `${base} border-[var(--navy-light)]/20 text-[var(--navy)] bg-blue-50`
    }
    return `${base} border-gray-200 text-muted-foreground bg-gray-50`
  }

  const formatUpdatedAt = (iso: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const kindPill = (kind: string) => {
    const base =
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide border'
    const k = String(kind || '').toUpperCase()
    if (k === 'ERROR' || k === 'AGENT_ERROR') return `${base} border-red-200 text-red-700 bg-red-50`
    if (k === 'WARN') return `${base} border-amber-200 text-amber-700 bg-amber-50`
    if (k.startsWith('LM_')) return `${base} border-blue-200 text-[var(--navy)] bg-blue-50`
    if (k.startsWith('TOOL_')) return `${base} border-gray-200 text-gray-600 bg-gray-50`
    if (k.startsWith('AGENT_')) return `${base} border-blue-200 text-[var(--navy)] bg-blue-50`
    return `${base} border-gray-200 text-muted-foreground bg-gray-50`
  }

  const openDeleteModal = (gitUrl: string, ref: string) => {
    setRepoToDelete({ gitUrl, ref })
    setDeleteModalOpen(true)
    setDeleteError(null)
  }

  const closeDeleteModal = () => {
    setDeleteModalOpen(false)
    setRepoToDelete(null)
    setDeleteError(null)
    setDeleteLoading(false)
  }

  const confirmDelete = async () => {
    if (!repoToDelete) return

    setDeleteError(null)
    setDeleteLoading(true)
    try {
      await analysisClient.deleteRepo({
        gitUrl: repoToDelete.gitUrl,
        ref: repoToDelete.ref,
      })
      closeDeleteModal()
      void loadSaved()
    } catch (e: any) {
      setDeleteError(e?.message ?? String(e))
    } finally {
      setDeleteLoading(false)
    }
  }

  const start = async (opts?: { gitUrlOverride?: string; refOverride?: string }) => {
    const url = (opts?.gitUrlOverride ?? gitUrl).trim()
    const rref = (opts?.refOverride ?? ref).trim()

    setError(null)
    setRunning(true)
    setAnalysisId(null)
    setPhase('START')
    setMessage('Initializing analysis\u2026')
    setEvents([])
    setAgents(makeInitialAgents())

    try {
      for await (const ev of analysisClient.analyzeStream({
        gitUrl: url,
        ref: rref,
      })) {
        if (ev.id) setAnalysisId(ev.id)
        setPhase(ev.phase)

        const agentName = (ev.agent ?? '').trim()
        const kind = (ev.kind ?? '').trim()

        // Route engine events to top-level message
        if (agentName === 'engine' || !agentName) {
          setMessage(ev.message ?? '')
        }

        // Route per-agent events to agent state
        if (AGENT_NAMES.has(agentName)) {
          setAgents(prev => {
            const cur = prev[agentName]
            if (!cur) return prev

            const newEvent: StreamEvent = {
              ts: Date.now(),
              phase: ev.phase ?? '',
              progress: ev.progress ?? 0,
              message: ev.message ?? '',
              agent: agentName,
              kind,
              step: ev.step ?? 0,
              stepTotal: ev.stepTotal ?? 0,
            }

            let status = cur.status
            if (kind === 'AGENT_START') status = 'running'
            else if (kind === 'AGENT_END') status = 'completed'
            else if (kind === 'AGENT_ERROR') status = 'error'

            const events = [...cur.events, newEvent]
            if (events.length > 50) events.splice(0, events.length - 50)

            return {
              ...prev,
              [agentName]: {
                ...cur,
                status,
                progress: ev.progress ?? cur.progress,
                message: ev.message ?? cur.message,
                events,
              },
            }
          })
        }

        // Raw event log
        setEvents((prev) => {
          const next = [
            ...prev,
            {
              ts: Date.now(),
              phase: ev.phase ?? '',
              progress: ev.progress ?? 0,
              message: ev.message ?? '',
              agent: agentName,
              kind,
              step: ev.step ?? 0,
              stepTotal: ev.stepTotal ?? 0,
            },
          ]
          if (next.length > 200) next.splice(0, next.length - 200)
          return next
        })

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

  const showAgentCards = running && (phase === 'ANALYZE' || AGENT_ORDER.some(n => agents[n]?.status !== 'pending'))

  return (
    <div className="min-h-[calc(100dvh-var(--app-header-h))] flex flex-col items-center px-4 py-12">
      <div className={cn('w-full animate-fade-in-up', running ? 'max-w-3xl' : 'max-w-xl')}>
        {/* Hero Title */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-3 mb-4">
            <Terminal className="w-8 h-8 text-[var(--navy)]" />
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
          className="space-y-6 max-w-xl mx-auto"
        >
          {/* Git URL Input */}
          <div className="group">
            <label className="block text-sm font-medium text-[var(--navy)] mb-2 font-mono tracking-wider uppercase text-xs">
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
                className="w-full bg-white border border-gray-200 rounded-lg px-4 py-4
                  text-foreground placeholder:text-muted-foreground/50
                  focus:outline-none focus:border-[var(--navy-light)] focus:ring-1 focus:ring-[var(--navy-light)]/30
                  transition-all duration-300 font-mono text-sm
                  disabled:opacity-50 disabled:cursor-not-allowed
                  hover:border-gray-300 shadow-sm"
              />
            </div>
          </div>

          {/* Ref Input */}
          <div className="group">
            <label className="block text-sm font-medium text-[var(--navy)] mb-2 font-mono tracking-wider uppercase text-xs">
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
                className="w-full bg-white border border-gray-200 rounded-lg px-4 py-3
                  text-foreground placeholder:text-muted-foreground/50
                  focus:outline-none focus:border-[var(--navy-light)] focus:ring-1 focus:ring-[var(--navy-light)]/30
                  transition-all duration-300 font-mono text-sm
                  disabled:opacity-50 disabled:cursor-not-allowed
                  hover:border-gray-300 shadow-sm"
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={running || !gitUrl.trim()}
            className="w-full group relative overflow-hidden rounded-lg bg-[var(--navy)]
              border border-[var(--navy)] hover:border-[var(--navy-light)]
              px-6 py-4 font-mono text-sm font-medium text-white
              transition-all duration-300 shadow-sm hover:shadow-md
              disabled:opacity-50 disabled:cursor-not-allowed
              hover:bg-[var(--navy-light)]
              focus:outline-none focus:ring-2 focus:ring-[var(--navy-light)]/30"
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
          </button>
        </form>

        {/* Example Repos */}
        {!running && (
          <div className="mt-10 max-w-xl mx-auto">
            <ExampleRepos
              onSelect={(repo) => {
                setGitUrl(repo.url)
                setRef('')
                void start({ gitUrlOverride: repo.url, refOverride: '' })
              }}
              running={running}
            />
          </div>
        )}

        {/* Analysis Progress */}
        {running && (
          <div className="mt-8 animate-fade-in-up">
            {/* Overall Status Bar */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 font-mono mb-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-[var(--navy)] animate-pulse" />
                  <span className="text-[var(--navy)] font-medium text-sm">
                    {phase || 'INITIALIZING'}
                  </span>
                </div>
                <span className="text-xs text-gray-400 tabular-nums">
                  {Math.round(overallProgress * 100)}%
                </span>
              </div>
              <div className="relative h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-[var(--navy)] rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(0, Math.min(100, overallProgress * 100))}%` }}
                />
                <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-transparent via-[var(--navy)]/20 to-transparent animate-scan" />
              </div>
              {message && phase !== 'ANALYZE' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="text-[var(--navy-light)]">&gt;</span> {message}
                </p>
              )}
            </div>

            {/* Per-Agent Cards (2x2 grid) */}
            {showAgentCards && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                {AGENT_ORDER.map(name => (
                  <AgentCard key={name} agent={agents[name]} />
                ))}
              </div>
            )}

            {/* Collapsible Raw Log */}
            {events.length > 0 && (
              <details className="bg-white border border-gray-200 rounded-lg shadow-sm">
                <summary className="px-4 py-2 text-xs text-gray-400 font-mono cursor-pointer hover:text-gray-600 transition-colors select-none">
                  Raw log ({events.length}/200)
                </summary>
                <div className="px-3 pb-3">
                  <div className="max-h-52 overflow-auto rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                    <div className="space-y-1 font-mono text-[11px] leading-relaxed">
                      {events.map((e, idx) => {
                        const agent = String(e.agent || '').trim()
                        const kind = String(e.kind || '').trim()
                        const step = typeof e.step === 'number' ? e.step : 0
                        const stepTotal =
                          typeof e.stepTotal === 'number' ? e.stepTotal : 0
                        const agentLabel =
                          agent && stepTotal > 0 && step > 0
                            ? `${agent} ${step}/${stepTotal}`
                            : agent

                        return (
                          <div
                            key={`${e.ts}:${idx}`}
                            className="flex flex-wrap items-start gap-2"
                          >
                            <span className="tabular-nums text-gray-400 shrink-0">
                              {formatTime(e.ts)}
                            </span>
                            <span className="text-[var(--navy-light)] shrink-0">
                              {String(e.phase || '').toUpperCase()}
                            </span>
                            {agentLabel ? (
                              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide border border-blue-200 text-[var(--navy)] bg-blue-50">
                                {agentLabel}
                              </span>
                            ) : null}
                            {kind ? (
                              <span className={kindPill(kind)}>
                                {String(kind).toUpperCase()}
                              </span>
                            ) : null}
                            <span className="text-muted-foreground break-words">
                              {e.message || '\u2014'}
                            </span>
                          </div>
                        )
                      })}
                      <div ref={logEndRef} />
                    </div>
                  </div>
                </div>
              </details>
            )}

            {/* Analysis ID */}
            {analysisId && (
              <div className="mt-3">
                <span className="text-xs text-muted-foreground font-mono">
                  ID: <span className="text-[var(--navy)]">{analysisId}</span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mt-6 animate-fade-in-up">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 font-mono">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-red-700 text-sm font-medium uppercase tracking-wider">Error</span>
              </div>
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
        )}

        {/* Saved repos */}
        {!running && (
          <div className="mt-10 animate-fade-in-up max-w-xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-mono tracking-wider uppercase text-[var(--navy)]">
                Saved repos
              </h2>
              <button
                type="button"
                onClick={() => void loadSaved()}
                disabled={savedLoading}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 font-mono text-xs text-[var(--navy)]
                  hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savedLoading ? 'REFRESHING\u2026' : 'REFRESH'}
              </button>
            </div>

            {savedError ? (
              <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 font-mono">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-red-700 text-xs font-medium uppercase tracking-wider">
                    Failed to load saved repos
                  </span>
                </div>
                <p className="mt-2 text-xs text-red-600 break-words">{savedError}</p>
              </div>
            ) : null}

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
              {savedRepos?.length ? (
                <div className="divide-y divide-gray-100">
                  {savedRepos.map((r: any) => (
                    <div
                      key={r.lastAnalysisId}
                      className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="font-mono text-sm text-foreground truncate"
                            title={r.gitUrl}
                          >
                            {r.gitUrl}
                          </span>
                          <span className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-mono uppercase tracking-wide border border-blue-200 text-[var(--navy)] bg-blue-50">
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
                          className="rounded-md border border-[var(--navy)]/20 bg-[var(--navy)] px-3 py-1.5 font-mono text-xs text-white
                            hover:bg-[var(--navy-light)] transition-colors shadow-sm"
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
                          className="rounded-md border border-gray-200 bg-white px-3 py-1.5 font-mono text-xs text-[var(--navy)]
                            hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm
                            disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          RE-ANALYZE
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteModal(r.gitUrl ?? '', r.ref ?? '')}
                          disabled={deleteLoading}
                          className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 font-mono text-xs text-red-600
                            hover:bg-red-100 hover:border-red-300 transition-colors
                            disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline-block" />
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
        )}
      </div>

      {/* Footer hint */}
      <div className="mt-auto pt-12 text-center">
        <p className="text-xs text-muted-foreground/50 font-mono">
          Enter a Git repository URL to begin analysis
        </p>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && repoToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in-up">
          <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 border border-red-200 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  Delete Repository
                </h3>
                <p className="text-xs text-muted-foreground">
                  This action cannot be undone
                </p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground mb-2">
              Are you sure you want to delete all analyses for:
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-md p-3 mb-6">
              <p className="font-mono text-sm text-[var(--navy)] truncate" title={repoToDelete.gitUrl}>
                {repoToDelete.gitUrl}
              </p>
              <p className="font-mono text-xs text-gray-500 mt-1">
                ref: {repoToDelete.ref || '(default)'}
              </p>
            </div>

            {deleteError && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 font-mono">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-red-700 text-xs font-medium uppercase tracking-wider">
                    Error
                  </span>
                </div>
                <p className="mt-1 text-xs text-red-600 break-words">{deleteError}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleteLoading}
                className="flex-1 rounded-md border border-gray-200 bg-white px-4 py-2 font-mono text-sm text-foreground
                  hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteLoading}
                className="flex-1 rounded-md border border-red-200 bg-red-600 px-4 py-2 font-mono text-sm text-white
                  hover:bg-red-700 transition-colors shadow-sm
                  disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {deleteLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>DELETING...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>DELETE</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
