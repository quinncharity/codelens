import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Highlight, themes } from 'prism-react-renderer'
import { ChevronDown, ChevronRight, BookOpen, Zap, Gauge } from 'lucide-react'
import type { FunctionDetail } from '@codelens/proto-ts'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const COMPLEXITY_CONFIG = {
  simple: { label: 'Simple', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: Zap },
  moderate: { label: 'Moderate', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: Gauge },
  complex: { label: 'Complex', color: 'text-rose-600 bg-rose-50 border-rose-200', icon: BookOpen },
} as const

interface SourceCodeViewerProps {
  source: string
  language: string
  functions: FunctionDetail[]
  filePath: string
  totalLines: number
  showLabels?: boolean
}

export function SourceCodeViewer({
  source,
  language,
  functions,
  filePath,
  totalLines,
  showLabels = true,
}: SourceCodeViewerProps) {
  const [collapsedFunctions, setCollapsedFunctions] = useState<Set<string>>(new Set())
  const [labelsVisible, setLabelsVisible] = useState(showLabels)

  useEffect(() => {
    setLabelsVisible(showLabels)
  }, [showLabels])

  // Sort functions by start_line
  const sortedFunctions = useMemo(
    () => [...functions].sort((a, b) => a.startLine - b.startLine),
    [functions],
  )

  // Build a lookup: line number -> function that starts here
  const functionAtLine = useMemo(() => {
    const map = new Map<number, FunctionDetail>()
    for (const fn of sortedFunctions) {
      if (fn.startLine > 0) map.set(fn.startLine, fn)
    }
    return map
  }, [sortedFunctions])

  // Build set of lines that are inside a collapsed function body
  const hiddenLines = useMemo(() => {
    const set = new Set<number>()
    for (const key of collapsedFunctions) {
      const fn = sortedFunctions.find(
        (f) => `${f.filePath}:${f.name}:${f.startLine}` === key,
      )
      if (fn && fn.startLine > 0 && fn.endLine > fn.startLine) {
        // Hide lines after the signature line through end_line
        for (let i = fn.startLine + 1; i <= fn.endLine; i++) {
          set.add(i)
        }
      }
    }
    return set
  }, [collapsedFunctions, sortedFunctions])

  const toggleFunction = useCallback((fn: FunctionDetail) => {
    const key = `${fn.filePath}:${fn.name}:${fn.startLine}`
    setCollapsedFunctions((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const isFunctionCollapsed = useCallback(
    (fn: FunctionDetail) =>
      collapsedFunctions.has(`${fn.filePath}:${fn.name}:${fn.startLine}`),
    [collapsedFunctions],
  )

  const prismLang = language === 'typescript' || language === 'tsx'
    ? 'tsx'
    : language === 'javascript' || language === 'jsx'
      ? 'jsx'
      : language || 'python'

  return (
    <div className="source-code-viewer rounded-lg border border-border/60 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-[var(--c4)]/30">
        <span className="font-mono text-xs text-muted-foreground truncate">
          {filePath}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {totalLines} lines
          </span>
          {functions.length > 0 && (
            <button
              type="button"
              onClick={() => setLabelsVisible((v) => !v)}
              className={cn(
                'text-xs px-2 py-0.5 rounded border transition-colors',
                labelsVisible
                  ? 'bg-[var(--c1)] text-[var(--c4)] border-[var(--c1)]'
                  : 'bg-transparent text-muted-foreground border-border hover:bg-secondary/30',
              )}
            >
              {labelsVisible ? 'Hide Labels' : 'Show Labels'}
            </button>
          )}
        </div>
      </div>

      {/* Code */}
      <div className="overflow-auto max-h-[600px]">
        <Highlight theme={themes.github} code={source.trimEnd()} language={prismLang}>
          {({ tokens, getLineProps, getTokenProps }) => (
            <pre className="text-sm leading-relaxed p-0 m-0">
              <code>
                {tokens.map((line, lineIdx) => {
                  const lineNum = lineIdx + 1
                  const fn = functionAtLine.get(lineNum)
                  const isHidden = hiddenLines.has(lineNum)
                  const isCollapsed = fn ? isFunctionCollapsed(fn) : false

                  if (isHidden) return null

                  return (
                    <React.Fragment key={lineIdx}>
                      {/* Subgoal label above function definition */}
                      {fn && labelsVisible && (
                        <SubgoalLabel
                          fn={fn}
                          collapsed={isCollapsed}
                          onToggle={() => toggleFunction(fn)}
                        />
                      )}
                      <div
                        {...getLineProps({ line })}
                        className={cn(
                          'flex hover:bg-[var(--c3)]/10 transition-colors',
                          fn && 'bg-[var(--c2)]/5',
                        )}
                      >
                        {/* Line number gutter */}
                        <span className="select-none w-12 shrink-0 text-right pr-3 text-xs text-muted-foreground/50 py-px border-r border-border/20">
                          {lineNum}
                        </span>
                        {/* Code content */}
                        <span className="pl-4 pr-4 py-px flex-1 whitespace-pre">
                          {fn && !labelsVisible && (
                            <button
                              type="button"
                              onClick={() => toggleFunction(fn)}
                              className="inline-flex items-center mr-1 text-muted-foreground/60 hover:text-[var(--c1)] transition-colors"
                              title={isCollapsed ? 'Expand function' : 'Collapse function'}
                            >
                              {isCollapsed ? (
                                <ChevronRight className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )}
                            </button>
                          )}
                          {line.map((token, tokenIdx) => (
                            <span key={tokenIdx} {...getTokenProps({ token })} />
                          ))}
                        </span>
                      </div>
                      {/* Collapsed indicator */}
                      {fn && isCollapsed && (
                        <div className="flex bg-[var(--c3)]/10 border-y border-dashed border-[var(--c3)]/30">
                          <span className="w-12 shrink-0" />
                          <span className="pl-4 py-1 text-xs text-muted-foreground/60 italic">
                            ... {(fn.endLine || 0) - (fn.startLine || 0)} lines collapsed
                          </span>
                        </div>
                      )}
                    </React.Fragment>
                  )
                })}
              </code>
            </pre>
          )}
        </Highlight>
      </div>

      {/* Footer: function summary */}
      {functions.length > 0 && (
        <div className="px-4 py-2 border-t border-border/40 bg-[var(--c4)]/20">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{functions.length} function{functions.length !== 1 ? 's' : ''}</span>
            <span className="text-border">|</span>
            <span className="text-emerald-600">
              {functions.filter((f) => f.complexity === 'simple').length} simple
            </span>
            <span className="text-amber-600">
              {functions.filter((f) => f.complexity === 'moderate').length} moderate
            </span>
            <span className="text-rose-600">
              {functions.filter((f) => f.complexity === 'complex').length} complex
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function SubgoalLabel({
  fn,
  collapsed,
  onToggle,
}: {
  fn: FunctionDetail
  collapsed: boolean
  onToggle: () => void
}) {
  const complexity = (fn.complexity || 'moderate') as keyof typeof COMPLEXITY_CONFIG
  const config = COMPLEXITY_CONFIG[complexity] || COMPLEXITY_CONFIG.moderate
  const Icon = config.icon

  return (
    <div className="subgoal-label flex items-start gap-2 px-4 py-2 bg-[var(--c2)]/8 border-l-3 border-[var(--c2)]">
      <button
        type="button"
        onClick={onToggle}
        className="mt-0.5 text-muted-foreground/60 hover:text-[var(--c1)] transition-colors shrink-0"
        title={collapsed ? 'Expand function body' : 'Collapse function body'}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs font-semibold text-[var(--c1)]">
            {fn.name}
          </span>
          <Badge
            variant="outline"
            className={cn('text-[0.6rem] px-1.5 py-0 border', config.color)}
          >
            <Icon className="h-2.5 w-2.5 mr-0.5" />
            {config.label}
          </Badge>
          {fn.startLine > 0 && (
            <span className="text-[0.6rem] text-muted-foreground/50">
              L{fn.startLine}{fn.endLine > 0 ? `\u2013${fn.endLine}` : ''}
            </span>
          )}
        </div>
        {fn.purpose && (
          <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
            {fn.purpose}
          </p>
        )}
      </div>
    </div>
  )
}
