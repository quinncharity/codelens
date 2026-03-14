import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type {
  GetAnalysisResponse,
  Framework,
  Pattern,
  Insight,
  ServiceModule,
  FileDetail,
} from '@codelens/proto-ts'

import { analysisClient } from '../lib/rpc'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { ExpandableRow } from '@/components/ExpandableRow'
import { ConfidenceIndicator } from '@/components/ConfidenceIndicator'

export const Route = createFileRoute('/analysis/$id')({
  component: AnalysisPage,
})

function AnalysisPage() {
  const { id } = Route.useParams()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GetAnalysisResponse | null>(null)

  const isRunning = useMemo(() => result?.status === 'RUNNING', [result])

  const load = async () => {
    setError(null)
    try {
      const r = await analysisClient.getAnalysis({ id })
      setResult(r)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (cancelled) return
      await load()
    }
    void run()

    const t = setInterval(() => {
      if (cancelled) return
      if (result?.status === 'RUNNING') {
        void load()
      }
    }, 1500)

    return () => {
      cancelled = true
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, result?.status])

  const statusVariant: 'default' | 'secondary' | 'destructive' | 'outline' =
    result?.status === 'FAILED'
      ? 'destructive'
      : result?.status === 'SUCCEEDED'
        ? 'default'
        : result?.status === 'RUNNING'
          ? 'secondary'
          : 'outline'

  const patterns: Pattern[] = Array.isArray(result?.patterns)
    ? result.patterns
    : []
  const patternsFor = (category: string) =>
    patterns.filter(
      (p) => (p.category ?? 'unknown').toLowerCase() === category,
    )
  const otherPatterns = patterns.filter(
    (p) =>
      !['architecture', 'implementation', 'quality', 'ai_rule'].includes(
        (p.category ?? 'unknown').toLowerCase(),
      ),
  )

  return (
    <main className="container py-10">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Analysis</h1>
            <div className="font-mono text-xs text-muted-foreground">{id}</div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw />
              Refresh
            </Button>
            <Button asChild variant="ghost">
              <Link to="/">
                <ArrowLeft />
                Back
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          {loading ? (
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Failed to load analysis</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {result ? (
            <>
              {/* Status — always visible */}
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>Status</CardTitle>
                  <Badge variant={statusVariant} className="font-mono">
                    {result.status}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {result.error ? (
                    <Alert variant="destructive">
                      <AlertTitle>Error</AlertTitle>
                      <AlertDescription>{result.error}</AlertDescription>
                    </Alert>
                  ) : null}

                  {result.summary ? (
                    <div className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                      {result.summary}
                    </div>
                  ) : null}

                  {isRunning ? (
                    <div className="text-sm text-muted-foreground">
                      This analysis is still running. Auto-refreshing…
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* Architecture */}
              {result.services?.length ? (
                <CollapsibleSection
                  title="Architecture"
                  count={result.services.length}
                  defaultOpen
                >
                  <ArchitectureView services={result.services} />
                </CollapsibleSection>
              ) : null}

              {/* Frameworks */}
              <CollapsibleSection
                title="Frameworks"
                count={result.frameworks?.length ?? 0}
                defaultOpen={!!result.frameworks?.length}
              >
                {result.frameworks?.length ? (
                  <FrameworksTable frameworks={result.frameworks} />
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No frameworks detected yet.
                  </div>
                )}
              </CollapsibleSection>

              {/* Architecture Patterns */}
              <PatternSection
                title="Architecture Patterns"
                patterns={patternsFor('architecture')}
                emptyText="No architecture patterns detected yet."
              />

              {/* Implementation Patterns */}
              <PatternSection
                title="Implementation Patterns"
                patterns={patternsFor('implementation')}
                emptyText="No implementation patterns detected yet."
              />

              {/* Code Quality */}
              <PatternSection
                title="Code Quality"
                patterns={patternsFor('quality')}
                emptyText="No code quality findings detected yet."
              />

              {/* AI Rules */}
              <PatternSection
                title="AI Rules"
                patterns={patternsFor('ai_rule')}
                emptyText="No AI/agent-specific rules detected yet."
              />

              {/* Other Patterns */}
              {otherPatterns.length > 0 && (
                <PatternSection
                  title="Other Patterns"
                  patterns={otherPatterns}
                  emptyText="No other patterns detected."
                />
              )}

              {/* Insights */}
              {result.insights?.length ? (
<<<<<<< HEAD
                <Card>
                  <CardHeader>
                    <CardTitle>Insights</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    {result.insights.map((i: any, idx: number) => (
                      <div
                        key={`${i.title}:${idx}`}
                        className="rounded-md border border-[var(--c3)]/30 bg-[var(--c4)]/40 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium">{i.title}</div>
                          {i.category ? (
                            <Badge variant="secondary" className="font-mono">
                              {String(i.category).toUpperCase()}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-2 text-sm text-muted-foreground">
                          {i.description}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
=======
                <CollapsibleSection
                  title="Insights"
                  count={result.insights.length}
                  defaultOpen
                >
                  <InsightsList insights={result.insights} />
                </CollapsibleSection>
>>>>>>> 2f9fc40 (Add Radix UI Collapsible Component and Styles)
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </main>
  )
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function FrameworksTable({ frameworks }: { frameworks: Framework[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-6" />
          <TableHead>Name</TableHead>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Confidence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {frameworks.map((f) => (
          <ExpandableRow
            key={f.name}
            columnCount={3}
            cells={[
              <TableCell key="name" className="font-mono">
                {f.name}
              </TableCell>,
              <TableCell key="cat">{f.category || '—'}</TableCell>,
              <TableCell key="conf" className="text-right">
                <ConfidenceIndicator value={f.confidence} />
              </TableCell>,
            ]}
            detail={
              <div className="grid gap-2 text-sm">
                <Detail label="Version" value={f.version || 'unknown'} />
                <Detail label="Category" value={f.category || '—'} />
                <Detail
                  label="Confidence"
                  value={
                    <ConfidenceIndicator value={f.confidence} className="mt-0.5" />
                  }
                />
              </div>
            }
          />
        ))}
      </TableBody>
    </Table>
  )
}

function PatternSection({
  title,
  patterns,
  emptyText,
}: {
  title: string
  patterns: Pattern[]
  emptyText: string
}) {
  return (
    <CollapsibleSection
      title={title}
      count={patterns.length}
      defaultOpen={patterns.length > 0}
    >
      {patterns.length > 0 ? (
        <PatternsTable patterns={patterns} />
      ) : (
        <div className="text-sm text-muted-foreground">{emptyText}</div>
      )}
    </CollapsibleSection>
  )
}

function PatternsTable({ patterns }: { patterns: Pattern[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-6" />
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Confidence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {patterns.map((p) => (
          <ExpandableRow
            key={`${p.category || 'unknown'}:${p.name}`}
            columnCount={2}
            cells={[
              <TableCell key="name" className="font-mono">
                {p.name}
              </TableCell>,
              <TableCell key="conf" className="text-right">
                <ConfidenceIndicator value={p.confidence} />
              </TableCell>,
            ]}
            detail={
              <div className="grid gap-3 text-sm">
                {p.description && (
                  <p className="text-muted-foreground leading-relaxed">
                    {p.description}
                  </p>
                )}
                <EvidencePathList paths={p.evidencePaths} />
                <Detail
                  label="Confidence"
                  value={
                    <ConfidenceIndicator value={p.confidence} className="mt-0.5" />
                  }
                />
              </div>
            }
          />
        ))}
      </TableBody>
    </Table>
  )
}

function EvidencePathList({ paths }: { paths: string[] }) {
  const filtered = paths.filter(Boolean)
  if (!filtered.length) return null

  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Evidence
      </span>
      <div className="evidence-path-list mt-1">
        {filtered.map((p) => (
          <div key={p} className="evidence-path">
            {p}
          </div>
        ))}
      </div>
    </div>
  )
}

function InsightsList({ insights }: { insights: Insight[] }) {
  return (
    <div className="grid gap-3">
      {insights.map((insight, idx) => (
        <InsightCard key={`${insight.title}:${idx}`} insight={insight} />
      ))}
    </div>
  )
}

function InsightCard({ insight }: { insight: Insight }) {
  const [open, setOpen] = useState(false)

  return (
    <div
      className="rounded-md border border-border/60 bg-card/40 transition-colors hover:border-border"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 p-3 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{insight.title}</span>
          {insight.category && (
            <Badge variant="secondary" className="font-mono text-[0.65rem]">
              {insight.category.toUpperCase()}
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {open ? 'collapse' : 'expand'}
        </span>
      </button>
      {open && insight.description && (
        <div className="border-t border-border/40 px-3 pb-3 pt-2 text-sm leading-relaxed text-muted-foreground animate-fade-in-up">
          {insight.description}
        </div>
      )}
    </div>
  )
}

function ArchitectureView({ services }: { services: ServiceModule[] }) {
  return (
    <div className="grid gap-3">
      {services.map((svc) => (
        <ServiceCard key={svc.name} service={svc} />
      ))}
    </div>
  )
}

function ServiceCard({ service }: { service: ServiceModule }) {
  const [open, setOpen] = useState(false)

  const moduleTypeLabel = (service.moduleType || 'module').toUpperCase()

  return (
    <div className="rounded-md border border-border/60 bg-card/40 transition-colors hover:border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{service.name}</span>
          <Badge variant="secondary" className="font-mono text-[0.65rem]">
            {moduleTypeLabel}
          </Badge>
          {service.keyFiles?.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {service.keyFiles.length} file{service.keyFiles.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {open ? 'collapse' : 'expand'}
        </span>
      </button>

      {open && (
        <div className="border-t border-border/40 px-4 pb-4 pt-3 space-y-3 animate-fade-in-up">
          {service.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {service.description}
            </p>
          )}

          {service.entryPoints?.length > 0 && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                Entry Points
              </span>
              <div className="evidence-path-list mt-1">
                {service.entryPoints.map((ep: string) => (
                  <div key={ep} className="evidence-path">
                    {ep}
                  </div>
                ))}
              </div>
            </div>
          )}

          {service.dependsOn?.length > 0 && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                Depends On
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {service.dependsOn.map((dep: string) => (
                  <Badge key={dep} variant="outline" className="font-mono text-xs">
                    {dep}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {service.keyFiles?.length > 0 && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                Key Files
              </span>
              <div className="mt-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-6" />
                      <TableHead>Path</TableHead>
                      <TableHead>Layer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {service.keyFiles.map((f: FileDetail) => (
                      <ExpandableRow
                        key={f.path}
                        columnCount={2}
                        cells={[
                          <TableCell key="path" className="font-mono text-xs">
                            {f.path}
                          </TableCell>,
                          <TableCell key="layer">
                            <Badge variant="outline" className="font-mono text-[0.6rem]">
                              {(f.layer || 'unknown').toUpperCase()}
                            </Badge>
                          </TableCell>,
                        ]}
                        detail={
                          f.purpose ? (
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              {f.purpose}
                            </p>
                          ) : (
                            <span className="text-sm text-muted-foreground/50">
                              No description available.
                            </span>
                          )
                        }
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70 shrink-0">
        {label}
      </span>
      <span className="text-muted-foreground">{value}</span>
    </div>
  )
}
