import * as React from 'react'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { TableCell, TableRow } from '@/components/ui/table'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

interface ExpandableRowProps {
  cells: React.ReactNode[]
  detail: React.ReactNode
  columnCount: number
}

export function ExpandableRow({ cells, detail, columnCount }: ExpandableRowProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <>
        <CollapsibleTrigger asChild>
          <TableRow
            className={cn(
              'cursor-pointer transition-colors hover:bg-secondary/30',
              open && 'bg-secondary/20',
            )}
          >
            <TableCell className="w-6 pr-0">
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
                  open && 'rotate-90',
                )}
              />
            </TableCell>
            {cells.map((cell, i) => (
              <React.Fragment key={i}>{cell}</React.Fragment>
            ))}
          </TableRow>
        </CollapsibleTrigger>

        <CollapsibleContent asChild className="collapsible-content">
          <tr>
            <td colSpan={columnCount + 1} className="p-0">
              <div className="expandable-detail border-t border-border/40 bg-secondary/10 px-6 py-4">
                {detail}
              </div>
            </td>
          </tr>
        </CollapsibleContent>
      </>
    </Collapsible>
  )
}
