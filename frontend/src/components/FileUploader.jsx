import { useState, useCallback } from 'react'
import { Upload, X, CheckCircle } from 'lucide-react'
import { uploadFile } from '../api'

export default function FileUploader({ onUploaded }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage]   = useState(null)

  const handle = useCallback(async (files) => {
    if (!files || !files.length) return
    setUploading(true)
    setMessage(null)
    const results = []
    for (const file of files) {
      const form = new FormData()
      form.append('file', file)
      try {
        const res = await uploadFile(form)
        results.push({ ok: true, name: file.name, meta: res.metadata })
      } catch (e) {
        results.push({ ok: false, name: file.name, err: e.response?.data?.detail || e.message })
      }
    }
    setUploading(false)
    const ok = results.filter(r => r.ok)
    if (ok.length) {
      setMessage({ type: 'success', text: `Uploaded ${ok.length} file(s) successfully!` })
      onUploaded && onUploaded(ok.map(r => r.meta))
    } else {
      setMessage({ type: 'error', text: results.map(r => r.err).join(', ') })
    }
  }, [onUploaded])

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    handle([...e.dataTransfer.files])
  }

  const onInputChange = (e) => handle([...e.target.files])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        htmlFor="file-input"
        style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}
      >
        {uploading ? (
          <>
            <div className="spinner" />
            <span style={{ fontSize: 14 }}>Uploading…</span>
          </>
        ) : (
          <>
            <Upload size={32} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                Drop files here or click to browse
              </div>
              <div style={{ fontSize: 12.5, marginTop: 4 }}>
                Supports .xlsx, .xls, .csv — multiple files at once
              </div>
            </div>
          </>
        )}
      </label>
      <input
        id="file-input"
        type="file"
        accept=".xlsx,.xls,.csv"
        multiple
        style={{ display: 'none' }}
        onChange={onInputChange}
        disabled={uploading}
      />
      {message && (
        <div className={`alert alert-${message.type === 'success' ? 'success' : 'error'} animate-in`}>
          {message.type === 'success' ? <CheckCircle size={16} /> : <X size={16} />}
          {message.text}
        </div>
      )}
    </div>
  )
}
