import { useCallback, useEffect, useRef } from 'react'
import { studyClient } from '@/lib/rpc'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingEvent {
  userId: string
  sessionId: string
  eventType: string
  targetElementId: string
  timestampMs: bigint
  durationMs: number
  metadataJson: string
}

export interface TrackerOptions {
  /** Identifier for the current user (defaults to "anonymous"). */
  userId?: string
  /** Identifier for the current browser session (auto-generated if omitted). */
  sessionId?: string
  /** How often to flush the event buffer to the backend (ms). Default 5 000. */
  flushIntervalMs?: number
  /** Maximum events to buffer before forcing a flush. Default 50. */
  maxBatchSize?: number
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

let _sessionId: string | undefined
function defaultSessionId(): string {
  if (!_sessionId) {
    _sessionId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
  return _sessionId
}

// ---------------------------------------------------------------------------
// Hook: useInteractionTracker
//
// Returns lightweight helpers that components can wire into their event
// handlers and refs.  All network I/O is batched and fire-and-forget so
// the UI thread is never blocked.
// ---------------------------------------------------------------------------

export function useInteractionTracker(opts?: TrackerOptions) {
  const userId = opts?.userId ?? 'anonymous'
  const sessionId = opts?.sessionId ?? defaultSessionId()
  const flushInterval = opts?.flushIntervalMs ?? 5_000
  const maxBatch = opts?.maxBatchSize ?? 50

  // Mutable buffer (no re-renders on push)
  const buffer = useRef<PendingEvent[]>([])
  // Track expand timestamps for reading-time calculation
  const expandTimers = useRef<Map<string, number>>(new Map())
  // IntersectionObserver-tracked elements
  const dwellTimers = useRef<Map<Element, { elementId: string; start: number }>>(
    new Map(),
  )
  const observerRef = useRef<IntersectionObserver | null>(null)

  // -----------------------------------------------------------------------
  // Flush
  // -----------------------------------------------------------------------

  const flush = useCallback(() => {
    const batch = buffer.current.splice(0)
    if (batch.length === 0) return

    studyClient.logEvents({ events: batch }).catch(() => {
      // Best-effort — silently drop on failure to avoid polluting the console
      // during offline / error scenarios.
    })
  }, [])

  // Periodic flush
  useEffect(() => {
    const id = setInterval(flush, flushInterval)
    return () => {
      clearInterval(id)
      flush() // drain remaining events on unmount
    }
  }, [flush, flushInterval])

  // -----------------------------------------------------------------------
  // Core: push an event into the buffer
  // -----------------------------------------------------------------------

  const trackEvent = useCallback(
    (
      eventType: string,
      targetElementId: string,
      durationMs = 0,
      metadata?: Record<string, unknown>,
    ) => {
      buffer.current.push({
        userId,
        sessionId,
        eventType,
        targetElementId,
        timestampMs: BigInt(Date.now()),
        durationMs,
        metadataJson: metadata ? JSON.stringify(metadata) : '',
      })

      if (buffer.current.length >= maxBatch) flush()
    },
    [userId, sessionId, maxBatch, flush],
  )

  // -----------------------------------------------------------------------
  // Expand / Collapse tracking (reading-time)
  // -----------------------------------------------------------------------

  const trackExpand = useCallback(
    (elementId: string) => {
      expandTimers.current.set(elementId, Date.now())
      trackEvent('expand', elementId)
    },
    [trackEvent],
  )

  const trackCollapse = useCallback(
    (elementId: string) => {
      const start = expandTimers.current.get(elementId)
      const duration = start ? Date.now() - start : 0
      expandTimers.current.delete(elementId)
      trackEvent('collapse', elementId, duration)
    },
    [trackEvent],
  )

  // -----------------------------------------------------------------------
  // IntersectionObserver-based dwell tracking
  //
  // Call `dwellRef(elementId)` to get a callback-ref you can attach to any
  // DOM node.  When the element scrolls into view the timer starts; when it
  // leaves, a "dwell" event is emitted with the elapsed time.
  // -----------------------------------------------------------------------

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const existing = dwellTimers.current.get(entry.target)
            if (existing && existing.start === 0) {
              existing.start = Date.now()
            }
          } else {
            const rec = dwellTimers.current.get(entry.target)
            if (rec && rec.start > 0) {
              const duration = Date.now() - rec.start
              if (duration > 200) {
                trackEvent('dwell', rec.elementId, duration)
              }
              rec.start = 0
            }
          }
        }
      },
      { threshold: 0.3 },
    )
    observerRef.current = obs
    return () => obs.disconnect()
  }, [trackEvent])

  const dwellRef = useCallback(
    (elementId: string) => {
      return (node: HTMLElement | null) => {
        const obs = observerRef.current
        if (!obs) return

        // Clean up previous observation for this elementId
        for (const [el, rec] of dwellTimers.current) {
          if (rec.elementId === elementId) {
            obs.unobserve(el)
            dwellTimers.current.delete(el)
          }
        }

        if (node) {
          dwellTimers.current.set(node, { elementId, start: 0 })
          obs.observe(node)
        }
      }
    },
    [],
  )

  return { trackEvent, trackExpand, trackCollapse, dwellRef, flush }
}
