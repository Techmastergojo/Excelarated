import { useState } from 'react'
import { Brain, Loader2, CheckCircle, Download, Info } from 'lucide-react'
import { trainModel, downloadFile, saveData } from '../api'

const ALGORITHMS = [
  { id: 'random_forest',      label: 'Random Forest',       desc: 'Great all-around, handles mixed data well' },
  { id: 'gradient_boosting',  label: 'Gradient Boosting',   desc: 'Higher accuracy, slower to train' },
]

export default function MLPanel({ metadata, selectedFile }) {
  const [targetCol, setTargetCol] = useState('')
  const [featCols,  setFeatCols]  = useState([])
  const [algo,      setAlgo]      = useState('random_forest')
  const [loading,   setLoading]   = useState(false)
  const [result,    setResult]    = useState(null)
  const [error,     setError]     = useState(null)

  if (!metadata) {
    return (
      <div className="empty-state">
        <Brain size={40} />
        <p>Select a file to train a prediction model on your data.</p>
      </div>
    )
  }

  const cols = metadata.columns || []

  const toggleFeat = (col) => {
    setFeatCols(f => f.includes(col) ? f.filter(c => c !== col) : [...f, col])
  }

  const train = async () => {
    if (!targetCol) return alert('Select a target (output) column.')
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await trainModel({
        filename: selectedFile,
        target_col: targetCol,
        feature_cols: featCols.length ? featCols : null,
        algorithm: algo,
      })
      setResult(res)
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    }
    setLoading(false)
  }

  const exportPredictions = async () => {
    if (!result) return
    const fname = `predictions_${selectedFile}`
    await saveData({
      rows: result.predictions,
      columns: result.all_columns,
      output_filename: fname,
      filename: selectedFile,
    })
    window.open(downloadFile(fname), '_blank')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Brain size={16} /> Model Configuration</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Target column */}
          <div className="form-group">
            <label className="label">Target Column (What to predict)</label>
            <select className="select" value={targetCol} onChange={e => { setTargetCol(e.target.value); setFeatCols([]) }}>
              <option value="">— Select target —</option>
              {cols.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
            </select>
          </div>

          {/* Feature columns */}
          {targetCol && (
            <div className="form-group">
              <label className="label">Input Features (leave all unchecked to use all)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 140, overflowY: 'auto', padding: 4 }}>
                {cols.filter(c => c.name !== targetCol).map(c => (
                  <label key={c.name} className="checkbox-row" style={{ fontSize: 12.5 }}>
                    <input
                      type="checkbox"
                      checked={featCols.includes(c.name)}
                      onChange={() => toggleFeat(c.name)}
                    />
                    <span>{c.name}</span>
                    <span className={`badge badge-${c.type === 'numeric' ? 'green' : 'blue'}`} style={{ fontSize: 10 }}>
                      {c.type}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Algorithm */}
          <div className="form-group">
            <label className="label">Algorithm</label>
            <div style={{ display: 'flex', gap: 10 }}>
              {ALGORITHMS.map(a => (
                <label
                  key={a.id}
                  className="checkbox-row"
                  style={{
                    flex: 1,
                    background: algo === a.id ? 'var(--accent-dim)' : 'var(--bg-card)',
                    border: `1px solid ${algo === a.id ? 'var(--border-accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--r-md)',
                    padding: '10px 14px',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="radio" name="algo" checked={algo === a.id} onChange={() => setAlgo(a.id)} />
                    <strong style={{ fontSize: 13 }}>{a.label}</strong>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', paddingLeft: 22 }}>{a.desc}</div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <button className="btn btn-primary btn-lg" onClick={train} disabled={loading || !targetCol}>
        {loading
          ? <><Loader2 size={17} style={{ animation: 'spin 0.7s linear infinite' }} /> Training model…</>
          : <><Brain size={17} /> Train Model</>
        }
      </button>

      {error && <div className="alert alert-error animate-in">❌ {error}</div>}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} className="animate-in">

          {/* Metrics */}
          <div className="stat-grid">
            {result.metrics.task === 'classification' ? (
              <>
                <div className="stat-card">
                  <div className="stat-label">Task</div>
                  <div className="stat-value" style={{ fontSize: 18, color: 'var(--accent)' }}>Classification</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Accuracy</div>
                  <div className="stat-value">{result.metrics.accuracy_pct}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Train samples</div>
                  <div className="stat-value" style={{ fontSize: 20 }}>{result.metrics.train_samples}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Test samples</div>
                  <div className="stat-value" style={{ fontSize: 20 }}>{result.metrics.test_samples}</div>
                </div>
              </>
            ) : (
              <>
                <div className="stat-card">
                  <div className="stat-label">Task</div>
                  <div className="stat-value" style={{ fontSize: 18, color: 'var(--violet)' }}>Regression</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">R² Score</div>
                  <div className="stat-value">{result.metrics.r2_pct}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Avg Error (MAE)</div>
                  <div className="stat-value" style={{ fontSize: 20 }}>{result.metrics.mae}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Train / Test</div>
                  <div className="stat-value" style={{ fontSize: 16 }}>{result.metrics.train_samples} / {result.metrics.test_samples}</div>
                </div>
              </>
            )}
          </div>

          {/* Feature Importance */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}><Info size={15} /> Feature Importance</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {result.feature_importance.slice(0, 8).map(f => (
                <div key={f.feature} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 130, fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.feature}</div>
                  <div style={{ flex: 1, background: 'var(--border)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${f.importance * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 99 }} />
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', width: 40, textAlign: 'right' }}>{(f.importance * 100).toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>

          {/* Predictions preview + export */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><CheckCircle size={15} style={{ color: 'var(--accent)' }} /> Predictions Preview</div>
              <button className="btn btn-secondary btn-sm" onClick={exportPredictions}>
                <Download size={13} /> Export
              </button>
            </div>
            <div className="table-wrap" style={{ maxHeight: 280 }}>
              <table>
                <thead>
                  <tr>
                    {result.all_columns.filter(c => [result.target_column, `${result.target_column}_predicted`, ...result.feature_columns.slice(0, 3)].includes(c)).map(c => (
                      <th key={c} style={{ color: c.endsWith('_predicted') ? 'var(--accent)' : undefined }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.predictions.slice(0, 30).map((row, i) => (
                    <tr key={i}>
                      {result.all_columns.filter(c => [result.target_column, `${result.target_column}_predicted`, ...result.feature_columns.slice(0, 3)].includes(c)).map(c => (
                        <td key={c} style={{ color: c.endsWith('_predicted') ? 'var(--accent)' : undefined }}>{row[c] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
