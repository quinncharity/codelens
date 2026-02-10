import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import { analysisClient } from '../lib/rpc'

export const Route = createFileRoute('/analysis/$id')({
  component: AnalysisPage,
})

function AnalysisPage() {
  const { id } = Route.useParams()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)

  const isRunning = useMemo(() => result?.status === 'RUNNING', [result])

  const load = async () => {
    setError(null)
    try {
      const r = await analysisClient.getAnalysis({ id })
      setResult(r)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (cancelled) return
      await load()
    }
    void run()

    const t = setInterval(() => {
      if (cancelled) return
      if (result?.status === 'RUNNING') {
        void load()
      }
    }, 1500)

    return () => {
      cancelled = true
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, result?.status])

  return (
    <main style={{ maxWidth: 860, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Analysis</h1>
          <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.8 }}>
            {id}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={load}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid #111',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
          <Link to="/" style={{ textDecoration: 'none' }}>
            Back
          </Link>
        </div>
      </div>

      {loading ? <p>Loading…</p> : null}
      {error ? (
        <div
          style={{
            marginTop: 12,
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

      {result ? (
        <div style={{ marginTop: 18, display: 'grid', gap: 16 }}>
          <section
            style={{
              border: '1px solid #ddd',
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>Status</strong>
              <span style={{ fontFamily: 'monospace' }}>{result.status}</span>
            </div>
            {result.error ? (
              <div style={{ marginTop: 8, color: '#842029' }}>
                <strong>Error:</strong> {result.error}
              </div>
            ) : null}
            {result.summary ? (
              <div style={{ marginTop: 10, opacity: 0.85 }}>{result.summary}</div>
            ) : null}
            {isRunning ? (
              <div style={{ marginTop: 10, opacity: 0.7 }}>
                This analysis is still running. Auto-refreshing…
              </div>
            ) : null}
          </section>

          <section
            style={{
              border: '1px solid #ddd',
              borderRadius: 12,
              padding: 12,
            }}
          >
            <strong>Frameworks</strong>
            {result.frameworks?.length ? (
              <table style={{ width: '100%', marginTop: 10, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '6px 4px' }}>Name</th>
                    <th style={{ textAlign: 'left', padding: '6px 4px' }}>Version</th>
                    <th style={{ textAlign: 'left', padding: '6px 4px' }}>Category</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px' }}>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {result.frameworks.map((f: any) => (
                    <tr key={f.name}>
                      <td style={{ padding: '6px 4px', fontFamily: 'monospace' }}>
                        {f.name}
                      </td>
                      <td style={{ padding: '6px 4px' }}>{f.version || '—'}</td>
                      <td style={{ padding: '6px 4px' }}>{f.category || '—'}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                        {typeof f.confidence === 'number'
                          ? f.confidence.toFixed(2)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ marginTop: 8, opacity: 0.7 }}>No frameworks detected yet.</div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  )
}

