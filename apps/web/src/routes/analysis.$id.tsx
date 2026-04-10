import { createFileRoute, Link } from '@tanstack/react-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronsDownUp, ChevronsUpDown, RefreshCw, ChevronRight, FileCode, X } from 'lucide-react'
import type {
  GetAnalysisResponse,
  Framework,
  Pattern,
  Insight,
  ServiceModule,
  FileDetail,
  FunctionDetail,
  GetFileSourceResponse,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { ExpandableRow } from '@/components/ExpandableRow'
import { ConfidenceIndicator } from '@/components/ConfidenceIndicator'
import {
  ExpandCollapseProvider,
  useExpandCollapse,
} from '@/components/ExpandCollapseProvider'
import { ZoomProvider, useZoom } from '@/components/ZoomContext'
import { ZoomControl } from '@/components/ZoomControl'
import { ArchitectureDiagram } from '@/components/ArchitectureDiagram'
import { SourceCodeViewer } from '@/components/SourceCodeViewer'

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

  return (
    <ZoomProvider>
      <ExpandCollapseProvider>
        <AnalysisPageInner
          id={id}
          loading={loading}
          error={error}
          result={result}
          isRunning={isRunning}
          onRefresh={load}
        />
      </ExpandCollapseProvider>
    </ZoomProvider>
  )
}

function AnalysisPageInner({
  id,
  loading,
  error,
  result,
  isRunning,
  onRefresh,
}: {
  id: string
  loading: boolean
  error: string | null
  result: GetAnalysisResponse | null
  isRunning: boolean
  onRefresh: () => void
}) {
  const { expandAll, expandAllSections, collapseAll } = useExpandCollapse()
  const { zoomLevel, setZoomLevel } = useZoom()

  // File source viewer state
  const [activeFile, setActiveFile] = useState<{
    path: string
    serviceName: string
  } | null>(null)
  const [fileSource, setFileSource] = useState<GetFileSourceResponse | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  const handleToggleAll = () => {
    if (expandAll) {
      collapseAll()
    } else {
      expandAllSections()
    }
  }

  // When switching to level 3, expand all; when switching to level 2 from 3, collapse
  const prevZoom = useRef(zoomLevel)
  useEffect(() => {
    if (zoomLevel === 3 && prevZoom.current !== 3) {
      expandAllSections()
    } else if (zoomLevel === 2 && prevZoom.current === 3) {
      collapseAll()
      setActiveFile(null)
      setFileSource(null)
    }
    prevZoom.current = zoomLevel
  }, [zoomLevel, expandAllSections, collapseAll])

  // Handle node click from ArchitectureDiagram — switch to level 2 and scroll
  const handleDiagramNodeClick = useCallback(
    (serviceName: string) => {
      setZoomLevel(2)
      // Small delay to let rendering catch up
      setTimeout(() => {
        const el = document.getElementById(`service-${serviceName}`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.classList.add('highlight-pulse')
          setTimeout(() => el.classList.remove('highlight-pulse'), 2000)
        }
      }, 100)
    },
    [setZoomLevel],
  )

  // Open a file in the source code viewer
  const handleOpenFile = useCallback(
    async (filePath: string, serviceName: string) => {
      setActiveFile({ path: filePath, serviceName })
      setFileLoading(true)
      setFileSource(null)
      try {
        const resp = await analysisClient.getFileSource({
          analysisId: id,
          filePath,
        })
        setFileSource(resp)
      } catch {
        setFileSource(null)
      } finally {
        setFileLoading(false)
      }
      // Switch to code view
      if (zoomLevel < 3) setZoomLevel(3)
    },
    [id, zoomLevel, setZoomLevel],
  )

  const handleCloseFile = useCallback(() => {
    setActiveFile(null)
    setFileSource(null)
  }, [])

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

  const gitUrl = result?.gitUrl ?? ''
  const ref = result?.ref ?? ''

  return (
    <main className="container py-10">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Analysis</h1>
            <div className="font-mono text-xs text-muted-foreground">{id}</div>
          </div>

          <div className="flex items-center gap-2">
            <ZoomControl />
            {gitUrl ? (
              <Button asChild variant="outline">
                <Link
                  to="/repo"
                  search={{ gitUrl, ref }}
                >
                  Permalink
                </Link>
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleAll}
              title={expandAll ? 'Collapse All' : 'Expand All'}
            >
              {expandAll ? (
                <><ChevronsDownUp className="h-4 w-4" /> Collapse All</>
              ) : (
                <><ChevronsUpDown className="h-4 w-4" /> Expand All</>
              )}
            </Button>
            <Button variant="outline" onClick={onRefresh} disabled={loading}>
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

        <div className="mt-6 grid gap-4 zoom-transition">
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

              {/* Level 1: Architecture Diagram with educational context */}
              {zoomLevel === 1 && result.services?.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Dependency Graph</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      This diagram shows how the major parts of the codebase depend on each other.
                      Click any module to explore its files and structure.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <ArchitectureDiagram
                      services={result.services}
                      onNodeClick={handleDiagramNodeClick}
                    />
                  </CardContent>
                </Card>
              ) : null}

              {/* Breadcrumb when viewing a file */}
              {activeFile && zoomLevel === 3 ? (
                <div className="flex items-center gap-1.5 text-sm flex-wrap">
                  <button
                    type="button"
                    onClick={handleCloseFile}
                    className="text-[var(--c2)] hover:text-[var(--c1)] transition-colors"
                  >
                    {result.summary ? 'Repository' : 'Analysis'}
                  </button>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                  <button
                    type="button"
                    onClick={handleCloseFile}
                    className="text-[var(--c2)] hover:text-[var(--c1)] transition-colors"
                  >
                    {activeFile.serviceName}
                  </button>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                  <span className="font-mono text-xs text-foreground">
                    {activeFile.path}
                  </span>
                  <button
                    type="button"
                    onClick={handleCloseFile}
                    className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                    title="Close file viewer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : null}

              {/* Source Code Viewer (Level 3 when a file is active) */}
              {activeFile && zoomLevel === 3 ? (
                <div className="animate-fade-in-up">
                  {fileLoading ? (
                    <Card>
                      <CardContent className="py-8">
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <FileCode className="h-5 w-5 animate-pulse" />
                          <span className="text-sm">Loading source code...</span>
                        </div>
                      </CardContent>
                    </Card>
                  ) : fileSource ? (
                    <SourceCodeViewer
                      source={fileSource.source}
                      language={fileSource.language}
                      functions={fileSource.functions ?? []}
                      filePath={fileSource.filePath}
                      totalLines={fileSource.totalLines}
                      showLabels={true}
                    />
                  ) : (
                    <Card>
                      <CardContent className="py-6">
                        <p className="text-sm text-muted-foreground">
                          Could not load source code for this file. The repository may no longer be cached.
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : null}

              {/* Level 2 & 3: Full content */}
              {zoomLevel >= 2 ? (
                <>
                  {/* Architecture */}
                  {result.services?.length ? (
                    <CollapsibleSection
                      title="Architecture"
                      count={result.services.length}
                      defaultOpen
                    >
                      <ArchitectureView
                        services={result.services}
                        showFullDetail={zoomLevel === 3}
                        onOpenFile={handleOpenFile}
                      />
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
                    gitUrl={gitUrl}
                    gitRef={ref}
                  />

                  {/* Implementation Patterns */}
                  <PatternSection
                    title="Implementation Patterns"
                    patterns={patternsFor('implementation')}
                    emptyText="No implementation patterns detected yet."
                    gitUrl={gitUrl}
                    gitRef={ref}
                  />

                  {/* Code Quality */}
                  <PatternSection
                    title="Code Quality"
                    patterns={patternsFor('quality')}
                    emptyText="No code quality findings detected yet."
                    gitUrl={gitUrl}
                    gitRef={ref}
                  />

                  {/* AI Rules */}
                  <PatternSection
                    title="AI Rules"
                    patterns={patternsFor('ai_rule')}
                    emptyText="No AI/agent-specific rules detected yet."
                    gitUrl={gitUrl}
                    gitRef={ref}
                  />

                  {/* Other Patterns */}
                  {otherPatterns.length > 0 && (
                    <PatternSection
                      title="Other Patterns"
                      patterns={otherPatterns}
                      emptyText="No other patterns detected."
                      gitUrl={gitUrl}
                      gitRef={ref}
                    />
                  )}

                  {/* Insights */}
                  {result.insights?.length ? (
                    <CollapsibleSection
                      title="Insights"
                      count={result.insights.length}
                      defaultOpen
                    >
                      <InsightsList insights={result.insights} />
                    </CollapsibleSection>
                  ) : null}
                </>
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
  gitUrl,
  gitRef,
}: {
  title: string
  patterns: Pattern[]
  emptyText: string
  gitUrl: string
  gitRef: string
}) {
  return (
    <CollapsibleSection
      title={title}
      count={patterns.length}
      defaultOpen={patterns.length > 0}
    >
      {patterns.length > 0 ? (
        <PatternsTable patterns={patterns} gitUrl={gitUrl} gitRef={gitRef} />
      ) : (
        <div className="text-sm text-muted-foreground">{emptyText}</div>
      )}
    </CollapsibleSection>
  )
}

function PatternsTable({
  patterns,
  gitUrl,
  gitRef,
}: {
  patterns: Pattern[]
  gitUrl: string
  gitRef: string
}) {
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
                <EvidencePathList
                  paths={p.evidencePaths}
                  gitUrl={gitUrl}
                  gitRef={gitRef}
                />
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

function buildGitHubFileUrl(
  gitUrl: string,
  ref: string,
  filePath: string,
): string | null {
  if (!gitUrl) return null
  const cleaned = gitUrl
    .replace(/\.git$/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
  const effectiveRef = ref || 'HEAD'
  return `${cleaned}/blob/${effectiveRef}/${filePath}`
}

function EvidencePathList({
  paths,
  gitUrl,
  gitRef,
}: {
  paths: string[]
  gitUrl: string
  gitRef: string
}) {
  const filtered = paths.filter(Boolean)
  if (!filtered.length) return null

  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Evidence
      </span>
      <div className="evidence-path-list mt-1">
        {filtered.map((p) => {
          const url = buildGitHubFileUrl(gitUrl, gitRef, p)
          return url ? (
            <a
              key={p}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="evidence-path evidence-path-link"
            >
              {p}
            </a>
          ) : (
            <div key={p} className="evidence-path">
              {p}
            </div>
          )
        })}
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
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border border-border/60 bg-card/40 transition-colors hover:border-border">
        <CollapsibleTrigger asChild>
          <button
            type="button"
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
        </CollapsibleTrigger>
        <CollapsibleContent className="collapsible-content">
          {insight.description && (
            <div className="border-t border-border/40 px-3 pb-3 pt-2 text-sm leading-relaxed text-muted-foreground">
              {insight.description}
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

const LAYER_ORDER = [
  'presentation',
  'business',
  'data',
  'config',
  'test',
  'infra',
  'unknown',
] as const

function ArchitectureView({
  services,
  showFullDetail,
  onOpenFile,
}: {
  services: ServiceModule[]
  showFullDetail: boolean
  onOpenFile?: (filePath: string, serviceName: string) => void
}) {
  return (
    <div className="grid gap-3">
      {services.map((svc) => (
        <ServiceCard
          key={svc.name}
          service={svc}
          showFullDetail={showFullDetail}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  )
}

function scrollToService(name: string) {
  const el = document.getElementById(`service-${name}`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('highlight-pulse')
    setTimeout(() => el.classList.remove('highlight-pulse'), 2000)
  }
}

function ServiceCard({
  service,
  showFullDetail,
  onOpenFile,
}: {
  service: ServiceModule
  showFullDetail: boolean
  onOpenFile?: (filePath: string, serviceName: string) => void
}) {
  const [open, setOpen] = useState(showFullDetail)

  useEffect(() => {
    setOpen(showFullDetail)
  }, [showFullDetail])

  const moduleTypeLabel = (service.moduleType || 'module').toUpperCase()

  // Group key files by layer
  const filesByLayer = useMemo(() => {
    const grouped: Record<string, FileDetail[]> = {}
    for (const f of service.keyFiles ?? []) {
      const layer = (f.layer || 'unknown').toLowerCase()
      if (!grouped[layer]) grouped[layer] = []
      grouped[layer].push(f)
    }
    return grouped
  }, [service.keyFiles])

  const sortedLayers = LAYER_ORDER.filter((l) => filesByLayer[l]?.length)

  // Count functions for this service
  const functionCount = service.functions?.length ?? 0

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        id={`service-${service.name}`}
        className="rounded-md border border-border/60 bg-card/40 transition-colors hover:border-border"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
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
              {functionCount > 0 && (
                <span className="text-xs text-[var(--c2)]">
                  {functionCount} function{functionCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {open ? 'collapse' : 'expand'}
            </span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="collapsible-content">
          <div className="border-t border-border/40 px-4 pb-4 pt-3 space-y-3">
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
                    <button
                      key={ep}
                      type="button"
                      onClick={() => onOpenFile?.(ep, service.name)}
                      className="evidence-path evidence-path-link text-left"
                    >
                      <FileCode className="inline h-3 w-3 mr-1.5 opacity-50" />
                      {ep}
                    </button>
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
                    <Badge
                      key={dep}
                      variant="outline"
                      className="font-mono text-xs cursor-pointer hover:bg-secondary/50 transition-colors"
                      onClick={() => scrollToService(dep)}
                    >
                      {dep}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {sortedLayers.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                  Key Files
                </span>
                {sortedLayers.map((layer) => (
                  <LayerFileGroup
                    key={layer}
                    layer={layer}
                    files={filesByLayer[layer]}
                    showFullDetail={showFullDetail}
                    onOpenFile={(path) => onOpenFile?.(path, service.name)}
                    functions={service.functions ?? []}
                  />
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function LayerFileGroup({
  layer,
  files,
  showFullDetail,
  onOpenFile,
  functions,
}: {
  layer: string
  files: FileDetail[]
  showFullDetail: boolean
  onOpenFile?: (path: string) => void
  functions?: FunctionDetail[]
}) {
  const [open, setOpen] = useState(showFullDetail)

  useEffect(() => {
    setOpen(showFullDetail)
  }, [showFullDetail])

  // Count functions per file
  const fnCountByFile = useMemo(() => {
    const map: Record<string, number> = {}
    for (const fn of functions ?? []) {
      if (fn.filePath) {
        map[fn.filePath] = (map[fn.filePath] || 0) + 1
      }
    }
    return map
  }, [functions])

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded border border-border/40 bg-card/20">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-secondary/20 transition-colors rounded"
          >
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[0.6rem]">
                {layer.toUpperCase()}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {files.length} file{files.length !== 1 ? 's' : ''}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {open ? '-' : '+'}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="collapsible-content">
          <div className="px-3 pb-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6" />
                  <TableHead>Path</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f: FileDetail) => {
                  const fnCount = fnCountByFile[f.path] || 0
                  return (
                    <ExpandableRow
                      key={f.path}
                      columnCount={1}
                      cells={[
                        <TableCell key="path" className="font-mono text-xs">
                          <button
                            type="button"
                            onClick={() => onOpenFile?.(f.path)}
                            className="text-[var(--c2)] hover:text-[var(--c1)] hover:underline transition-colors text-left inline-flex items-center gap-1.5"
                          >
                            <FileCode className="h-3 w-3 opacity-50 shrink-0" />
                            {f.path}
                          </button>
                          {fnCount > 0 && (
                            <span className="ml-2 text-[0.6rem] text-muted-foreground/60">
                              {fnCount} fn{fnCount !== 1 ? 's' : ''}
                            </span>
                          )}
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
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
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
