import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { analysisClient } from '../lib/rpc'

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
    <main style={{ maxWidth: 860, margin: '40px auto', padding: 16 }}>
      <h1 style={{ marginBottom: 8 }}>CodeLens</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Paste a Git URL and we’ll detect frameworks and generate a summary.
      </p>

      <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Git URL</span>
          <input
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
            disabled={running}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Ref (optional)</span>
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="main / v1.2.3 / <sha>"
            style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
            disabled={running}
          />
        </label>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            onClick={start}
            disabled={running || !gitUrl.trim()}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid #111',
              background: running ? '#eee' : '#111',
              color: running ? '#111' : '#fff',
              cursor: running ? 'not-allowed' : 'pointer',
            }}
          >
            {running ? 'Analyzing…' : 'Analyze'}
          </button>
          {analysisId ? (
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
              id: {analysisId}
            </span>
          ) : null}
        </div>

        {running ? (
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{phase || '…'}</strong>
              <span style={{ fontFamily: 'monospace' }}>
                {(progress * 100).toFixed(0)}%
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  height: 10,
                  background: '#eee',
                  borderRadius: 999,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: 10,
                    width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
                    background: '#111',
                  }}
                />
              </div>
            </div>
            <div style={{ marginTop: 8, opacity: 0.8 }}>{message}</div>
          </div>
        ) : null}

        {error ? (
          <div
            style={{
              border: '1px solid #f5c2c7',
              background: '#f8d7da',
              color: '#842029',
              borderRadius: 12,
              padding: 12,
            }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </main>
  )
}
