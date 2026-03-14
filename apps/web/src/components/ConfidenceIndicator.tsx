import { cn } from '@/lib/utils'

interface ConfidenceIndicatorProps {
  value: number
  className?: string
  showLabel?: boolean
}

export function ConfidenceIndicator({
  value,
  className,
  showLabel = true,
}: ConfidenceIndicatorProps) {
  const clamped = Math.max(0, Math.min(1, value))
  const pct = Math.round(clamped * 100)

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-all duration-300',
            clamped >= 0.8
              ? 'bg-primary shadow-[0_0_6px_var(--tech-cyan-glow)]'
              : clamped >= 0.5
                ? 'bg-primary/70'
                : 'bg-muted-foreground/50',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {clamped.toFixed(2)}
        </span>
      )}
    </div>
  )
}
