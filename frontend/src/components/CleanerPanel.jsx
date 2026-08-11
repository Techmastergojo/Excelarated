import { useState } from 'react'
import { Wand2, CheckCircle, Loader2, Save, Download } from 'lucide-react'
import { cleanData, downloadFile } from '../api'

const DEFAULTS = {
  remove_duplicates: true,
  fill_numeric_nan: 'mean',
  fill_text_nan: 'unknown',
  trim_whitespace: true,
  standardize_dates: true,
}

export default function CleanerPanel({ selectedFile, onCleaned }) {
  const [opts, setOpts]     = useState(DEFAULTS)
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)

  const toggle = (key) => setOpts(o => ({ ...o, [key]: !o[key] }))
  const set    = (key, val) => setOpts(o => ({ ...o, [key]: val }))

  const run = async (saveAs) => {
    if (!selectedFile) return alert('Select a file first.')
    setLoading(true)
    setResult(null)
    try {
      const res = await cleanData({
        filename: selectedFile,
        options: opts,
        save_as: saveAs || selectedFile,
      })
      setResult(res)
      onCleaned && onCleaned(res.metadata)
    } catch (e) {
      setResult({ error: e.response?.data?.detail || e.message })
    }
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Wand2 size={16} /> Cleaning Options</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className="checkbox-row">
            <input type="checkbox" checked={opts.remove_duplicates} onChange={() => toggle('remove_duplicates')} />
            Remove duplicate rows
          </label>

          <label className="checkbox-row">
            <input type="checkbox" checked={opts.trim_whitespace} onChange={() => toggle('trim_whitespace')} />
            Trim extra spaces in text columns
          </label>

          <label className="checkbox-row">
            <input type="checkbox" checked={opts.standardize_dates} onChange={() => toggle('standardize_dates')} />
            Standardize date columns to YYYY-MM-DD
          </label>

          <div className="form-group">
            <label className="label">Fill missing numbers with</label>
            <select className="select" value={opts.fill_numeric_nan} onChange={e => set('fill_numeric_nan', e.target.value)}>
              <option value="none">Leave empty</option>
              <option value="mean">Column average (mean)</option>
              <option value="median">Column median</option>
              <option value="zero">Zero (0)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="label">Fill missing text with</label>
            <select className="select" value={opts.fill_text_nan} onChange={e => set('fill_text_nan', e.target.value)}>
              <option value="none">Leave empty</option>
              <option value="unknown">Unknown</option>
              <option value="mode">Most common value</option>
              <option value="empty">Empty string</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" onClick={() => run(selectedFile)} disabled={loading || !selectedFile}>
          {loading ? <Loader2 size={15} style={{ animation: 'spin 0.7s linear infinite' }} /> : <Wand2 size={15} />}
          Clean & Save
        </button>
        <button className="btn btn-secondary" onClick={() => run(`cleaned_${selectedFile}`)} disabled={loading || !selectedFile}>
          <Save size={15} /> Save as New File
        </button>
      </div>

      {result && !result.error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="alert alert-success animate-in">
            <CheckCircle size={16} />
            <div>
              <strong>Cleaning complete!</strong>
              <ul style={{ marginTop: 6, paddingLeft: 18, lineHeight: 1.8 }}>
                {result.report.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          </div>
          {result.metadata && (
            <a
              href={downloadFile(result.metadata.filename)}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ alignSelf: 'flex-start' }}
            >
              <Download size={13} /> Download cleaned file
            </a>
          )}
        </div>
      )}

      {result?.error && (
        <div className="alert alert-error animate-in">❌ {result.error}</div>
      )}
    </div>
  )
}
