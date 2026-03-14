import * as React from 'react'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ExpandCollapseContext } from '@/components/ExpandCollapseProvider'
import { ZoomContext } from '@/components/ZoomContext'

interface CollapsibleSectionProps {
  title: string
  count?: number
  defaultOpen?: boolean
  children: React.ReactNode
  className?: string
}

export function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children,
  className,
}: CollapsibleSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen)
  const expandCollapseCtx = React.useContext(ExpandCollapseContext)
  const zoomCtx = React.useContext(ZoomContext)
  const prevToggle = React.useRef(expandCollapseCtx?.globalToggle ?? 0)

  React.useEffect(() => {
    if (!expandCollapseCtx) return
    if (expandCollapseCtx.globalToggle !== prevToggle.current) {
      prevToggle.current = expandCollapseCtx.globalToggle
      setOpen(expandCollapseCtx.expandAll)
    }
  }, [expandCollapseCtx?.globalToggle, expandCollapseCtx?.expandAll, expandCollapseCtx])

  React.useEffect(() => {
    if (zoomCtx?.zoomLevel === 3) {
      setOpen(true)
    }
  }, [zoomCtx?.zoomLevel])

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex w-full items-center justify-between p-6 text-left',
              'hover:bg-secondary/30 transition-colors',
              'rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold leading-none tracking-tight">
                {title}
              </h3>
              {count != null && (
                <Badge variant="secondary" className="font-mono text-xs tabular-nums">
                  {count}
                </Badge>
              )}
            </div>
            <ChevronRight
              className={cn(
                'h-5 w-5 text-muted-foreground transition-transform duration-200',
                open && 'rotate-90',
              )}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="collapsible-content">
          <div className="p-6 pt-0">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
