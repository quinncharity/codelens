import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'

import { analysisClient } from '../lib/rpc'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const Route = createFileRoute('/analysis/$id')({
  component: AnalysisPage,
})

function AnalysisPage() {
  const { id } = Route.useParams()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)

  const isRunning = useMemo(() => result?.status === 'RUNNING', [result])

  const load = async () => {
    setError(null)
    try {
      const r = await analysisClient.getAnalysis({ id })
      setResult(r)
    } catch (e: any) {
      setError(e?.message ?? String(e))
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

  const patterns: any[] = Array.isArray(result?.patterns) ? result.patterns : []
  const patternsFor = (category: string) =>
    patterns.filter(
      (p) => String(p?.category ?? 'unknown').toLowerCase() === category,
    )
  const otherPatterns = patterns.filter(
    (p) =>
      !['architecture', 'implementation', 'quality', 'ai_rule'].includes(
        String(p?.category ?? 'unknown').toLowerCase(),
      ),
  )

  const renderPatterns = (
    items: any[],
    emptyText: string,
  ) => {
    if (!items?.length) {
      return <div className="text-sm text-muted-foreground">{emptyText}</div>
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Evidence</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Confidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((p: any) => {
            const evidence: string[] = Array.isArray(p?.evidencePaths)
              ? p.evidencePaths.map((x: any) => String(x)).filter(Boolean)
              : []
            const shown = evidence.slice(0, 3)
            const extra = Math.max(0, evidence.length - shown.length)
            const evidenceText =
              shown.join(', ') + (extra ? ` +${extra}` : '')

            return (
              <TableRow key={`${p.category || 'unknown'}:${p.name}`}>
                <TableCell className="font-mono">{p.name}</TableCell>
                <TableCell
                  className="font-mono text-xs text-muted-foreground break-words"
                  title={evidence.join(', ')}
                >
                  {evidenceText || '—'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {p.description || '—'}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {typeof p.confidence === 'number' ? p.confidence.toFixed(2) : '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }

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
                    <div className="text-sm text-muted-foreground">
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

              <Card>
                <CardHeader>
                  <CardTitle>Frameworks</CardTitle>
                </CardHeader>
                <CardContent>
                  {result.frameworks?.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Version</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Confidence</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.frameworks.map((f: any) => (
                          <TableRow key={f.name}>
                            <TableCell className="font-mono">{f.name}</TableCell>
                            <TableCell>{f.version || '—'}</TableCell>
                            <TableCell>{f.category || '—'}</TableCell>
                            <TableCell className="text-right font-mono">
                              {typeof f.confidence === 'number'
                                ? f.confidence.toFixed(2)
                                : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      No frameworks detected yet.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Architecture Patterns</CardTitle>
                </CardHeader>
                <CardContent>
                  {renderPatterns(
                    patternsFor('architecture'),
                    'No architecture patterns detected yet.',
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Implementation Patterns</CardTitle>
                </CardHeader>
                <CardContent>
                  {renderPatterns(
                    patternsFor('implementation'),
                    'No implementation patterns detected yet.',
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Code Quality</CardTitle>
                </CardHeader>
                <CardContent>
                  {renderPatterns(
                    patternsFor('quality'),
                    'No code quality findings detected yet.',
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>AI Rules</CardTitle>
                </CardHeader>
                <CardContent>
                  {renderPatterns(
                    patternsFor('ai_rule'),
                    'No AI/agent-specific rules detected yet.',
                  )}
                </CardContent>
              </Card>

              {otherPatterns.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Other Patterns</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {renderPatterns(otherPatterns, 'No other patterns detected.')}
                  </CardContent>
                </Card>
              ) : null}

              {result.insights?.length ? (
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
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </main>
  )
}
