import { useZoom, type ZoomLevel } from '@/components/ZoomContext'
import { cn } from '@/lib/utils'

const levels: { value: ZoomLevel; label: string; description: string }[] = [
  { value: 1, label: 'Architecture', description: 'Dependency graph' },
  { value: 2, label: 'Modules', description: 'Grouped by service' },
  { value: 3, label: 'Details', description: 'Everything expanded' },
]

export function ZoomControl() {
  const { zoomLevel, setZoomLevel } = useZoom()

  return (
    <div className="zoom-control" role="toolbar" aria-label="Zoom level">
      {levels.map((l) => (
        <button
          key={l.value}
          type="button"
          onClick={() => setZoomLevel(l.value)}
          title={l.description}
          className={cn(
            'zoom-control-btn',
            zoomLevel === l.value && 'zoom-control-btn-active',
          )}
        >
          <span className="text-xs font-medium">{l.label}</span>
        </button>
      ))}
    </div>
  )
}
