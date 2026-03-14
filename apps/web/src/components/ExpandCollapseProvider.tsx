import { createContext, useCallback, useContext, useMemo, useState } from 'react'

interface ExpandCollapseContextValue {
  expandAll: boolean
  globalToggle: number
  collapseAll: () => void
  expandAllSections: () => void
}

const ExpandCollapseContext = createContext<ExpandCollapseContextValue | null>(
  null,
)

export function ExpandCollapseProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [expandAll, setExpandAll] = useState(false)
  const [globalToggle, setGlobalToggle] = useState(0)

  const expandAllSections = useCallback(() => {
    setExpandAll(true)
    setGlobalToggle((t) => t + 1)
  }, [])

  const collapseAll = useCallback(() => {
    setExpandAll(false)
    setGlobalToggle((t) => t + 1)
  }, [])

  const value = useMemo(
    () => ({ expandAll, globalToggle, collapseAll, expandAllSections }),
    [expandAll, globalToggle, collapseAll, expandAllSections],
  )

  return (
    <ExpandCollapseContext.Provider value={value}>
      {children}
    </ExpandCollapseContext.Provider>
  )
}

export function useExpandCollapse() {
  const ctx = useContext(ExpandCollapseContext)
  if (!ctx)
    throw new Error(
      'useExpandCollapse must be used within an ExpandCollapseProvider',
    )
  return ctx
}

export { ExpandCollapseContext }
