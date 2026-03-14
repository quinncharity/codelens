import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type ZoomLevel = 1 | 2 | 3

interface ZoomContextValue {
  zoomLevel: ZoomLevel
  setZoomLevel: (level: ZoomLevel) => void
}

const ZoomContext = createContext<ZoomContextValue | null>(null)

export function ZoomProvider({ children }: { children: React.ReactNode }) {
  const [zoomLevel, setZoomLevelState] = useState<ZoomLevel>(2)

  const setZoomLevel = useCallback((level: ZoomLevel) => {
    setZoomLevelState(level)
  }, [])

  const value = useMemo(
    () => ({ zoomLevel, setZoomLevel }),
    [zoomLevel, setZoomLevel],
  )

  return <ZoomContext.Provider value={value}>{children}</ZoomContext.Provider>
}

export function useZoom() {
  const ctx = useContext(ZoomContext)
  if (!ctx) throw new Error('useZoom must be used within a ZoomProvider')
  return ctx
}

export { ZoomContext }
