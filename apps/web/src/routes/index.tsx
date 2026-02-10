import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { analysisClient } from '../lib/rpc'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const navigate = useNavigate()

  const [gitUrl, setGitUrl] = useState('')
  const [ref, setRef] = useState('')
  const [running, setRunning] = useState(false)
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [phase, setPhase] = useState<string>('')
  const [progress, setProgress] = useState<number>(0)
  const [message, setMessage] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setError(null)
    setRunning(true)
    setAnalysisId(null)
    setPhase('START')
    setProgress(0)
    setMessage('Starting…')

    try {
      for await (const ev of analysisClient.analyzeStream({
        gitUrl: gitUrl.trim(),
        ref: ref.trim(),
      })) {
        if (ev.id) setAnalysisId(ev.id)
        setPhase(ev.phase)
        setProgress(ev.progress ?? 0)
        setMessage(ev.message ?? '')

        if (ev.phase === 'DONE' && ev.id) {
          navigate({ to: '/analysis/$id', params: { id: ev.id } })
          return
        }

        if (ev.phase === 'ERROR') {
          setError(ev.message || 'Unknown error')
          return
        }
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <main className="container py-10">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Analyze a repository</CardTitle>
            <CardDescription>
              Paste a Git URL and we’ll detect frameworks and generate a summary.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-6"
              onSubmit={(e) => {
                e.preventDefault()
                void start()
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="gitUrl">Git URL</Label>
                <Input
                  id="gitUrl"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={running}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="ref">Ref (optional)</Label>
                <Input
                  id="ref"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="main / v1.2.3 / <sha>"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={running}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={running || !gitUrl.trim()}>
                  {running ? <Loader2 className="animate-spin" /> : null}
                  {running ? 'Analyzing…' : 'Analyze'}
                </Button>

                {analysisId ? (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">id: {analysisId}</span>
                  </div>
                ) : null}
              </div>

              {running ? (
                <div className="grid gap-3 rounded-lg border bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm font-medium">
                      {phase || '…'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">
                        {(Math.max(0, Math.min(1, progress)) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <Progress value={Math.max(0, Math.min(1, progress)) * 100} />
                  {message ? (
                    <div className="text-sm text-muted-foreground">
                      {message}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>Analysis failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
