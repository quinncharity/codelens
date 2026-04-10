import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'

import { analysisClient } from '@/lib/rpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/repo')({
  validateSearch: (search: Record<string, unknown>) => ({
    gitUrl: typeof search.gitUrl === 'string' ? search.gitUrl : '',
    ref: typeof search.ref === 'string' ? search.ref : '',
  }),
  component: RepoRoute,
})

function RepoRoute() {
  const navigate = useNavigate()
  const { gitUrl, ref } = Route.useSearch()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setError(null)

      if (!gitUrl.trim()) {
        setError('Repository URL is required.')
        return
      }

      try {
        const result = await analysisClient.getRepoAnalysis({
          gitUrl: gitUrl.trim(),
          ref: ref.trim(),
        })
        if (cancelled) return
        navigate({
          to: '/analysis/$id',
          params: { id: result.id },
          replace: true,
        })
      } catch (e: unknown) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [gitUrl, ref, navigate])

  return (
    <main className="container py-10">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-base uppercase tracking-wide">
              Open saved repository analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1 font-mono text-sm">
              <div className="break-all text-foreground">{gitUrl || '(missing repo URL)'}</div>
              <div className="text-muted-foreground">
                {ref ? `ref:${ref}` : 'ref:(default)'}
              </div>
            </div>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Looking up the latest saved analysis…
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button asChild variant="ghost">
                <Link to="/">
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
