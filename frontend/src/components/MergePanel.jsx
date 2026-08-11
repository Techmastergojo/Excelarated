import { useState } from 'react'
import { Merge, Loader2, CheckCircle, ArrowRight, Shuffle } from 'lucide-react'
import { mergeFiles, downloadFile } from '../api'

export default function MergePanel({ files, onMerged }) {
  const [selected, setSelected]     = useState([])
  const [mergeType, setMergeType]   = useState('concat')
  const [outName, setOutName]       = useState('merged_output.xlsx')
  const [loading, setLoading]       = useState(false)
  const [result, setResult]         = useState(null)
  const [error, setError]           = useState(null)

  const toggle = (fname) => setSelected(s => s.includes(fname) ? s.filter(f => f !== fname) : [...s, fname])

  const run = async () => {
    if (selected.length < 2) return alert('Select at least 2 files to merge.')
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await mergeFiles({
        files: selected,
        column_maps: {},
        merge_type: mergeType,
        output_filename: outName || 'merged_output.xlsx',
      })
      setResult(res)
      onMerged && onMerged(res.metadata)
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    }
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Merge size={16} /> Select Files to Merge</div>
          <span className="badge badge-blue">{selected.length} selected</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
          {files.length === 0 && (
            <div className="empty-state" style={{ padding: '24px' }}>
              <p>Upload files first to merge them.</p>
            </div>
          )}
          {files.map(f => (
            <div
              key={f.filename}
              className={`file-chip ${selected.includes(f.filename) ? 'selected' : ''}`}
              onClick={() => toggle(f.filename)}
            >
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${selected.includes(f.filename) ? 'var(--accent)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {selected.includes(f.filename) && <div style={{ width: 10, height: 10, background: 'var(--accent)', borderRadius: 2 }} />}
              </div>
              <span className="file-chip-name">{f.filename}</span>
              <span className="file-chip-size">{f.size_kb} KB</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><Shuffle size={16} /> Merge Options</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group">
            <label className="label">Merge Strategy</label>
            <div style={{ display: 'flex', gap: 10 }}>
              {[
                { id: 'concat', label: 'Stack Rows',  desc: 'All rows from all files go into one sheet (union)' },
                { id: 'join',   label: 'Join on Keys', desc: 'Merge files side-by-side using shared columns' },
              ].map(opt => (
                <label key={opt.id} className="checkbox-row" style={{
                  flex: 1,
                  background: mergeType === opt.id ? 'var(--accent-dim)' : 'var(--bg-card)',
                  border: `1px solid ${mergeType === opt.id ? 'var(--border-accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--r-md)',
                  padding: '10px 14px',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 4,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="radio" name="mergeType" checked={mergeType === opt.id} onChange={() => setMergeType(opt.id)} />
                    <strong style={{ fontSize: 13 }}>{opt.label}</strong>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', paddingLeft: 22 }}>{opt.desc}</div>
                </label>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="label">Output File Name</label>
            <input className="input" value={outName} onChange={e => setOutName(e.target.value)} placeholder="merged_output.xlsx" />
          </div>
        </div>
      </div>

      <button className="btn btn-primary btn-lg" onClick={run} disabled={loading || selected.length < 2}>
        {loading
          ? <><Loader2 size={17} style={{ animation: 'spin 0.7s linear infinite' }} /> Merging…</>
          : <><Merge size={17} /> Merge {selected.length} Files</>
        }
      </button>

      {error && <div className="alert alert-error animate-in">❌ {error}</div>}

      {result && (
        <div className="alert alert-success animate-in">
          <CheckCircle size={16} />
          <div>
            <strong>{result.message}</strong>
            <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-secondary)' }}>
              {result.metadata?.row_count?.toLocaleString()} rows · {result.metadata?.column_count} columns
            </div>
            <a
              href={downloadFile(result.metadata?.filename)}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 10, display: 'inline-flex' }}
            >
              <ArrowRight size={13} /> Download merged file
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
