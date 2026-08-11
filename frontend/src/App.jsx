import { useState, useEffect, useRef, useCallback } from 'react'
import { FolderOpen, Plus, Trash2, FileSpreadsheet, Loader2, Send, RotateCcw, Download, BarChart2, Zap } from 'lucide-react'
import { Bar, Line, Pie } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement, Tooltip, Legend
} from 'chart.js'
import { getAllFiles, getAllHandles, saveMessage, getMessages, clearMessages } from './lib/db.js'
import { pickFolder, scanFolder, removeStoredFolder, verifyHandlePermission } from './lib/scanner.js'
import { processQuery } from './lib/queryEngine.js'
import { buildAndDownloadExcel } from './lib/excelWriter.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Legend)

const CHART_COLORS = ['#00e5a0','#7c3aed','#f97316','#3b82f6','#f43f5e','#a3e635','#fb923c','#06b6d4']

const EXAMPLES = [
  { label: 'Find & Filter', text: 'Show me all sites in region North where status is active' },
  { label: 'Timeline Query', text: 'Get all outages from January 2024 to March 2024' },
  { label: 'Create Excel', text: 'Create a new Excel file with all sites grouped by zone' },
  { label: 'Aggregate', text: 'What is the total count of sites per MBU Name?' },
]

// ── Message bubble renderer ──────────────────────────────────
function MessageBubble({ msg, onSuggestion, onDownload }) {
  const renderText = text => {
    // Simple markdown: **bold**, *italic*
    return text.split('\n').map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
      return (
        <span key={i}>
          {i > 0 && <br />}
          {parts.map((p, j) => {
            if (p.startsWith('**') && p.endsWith('**')) return <strong key={j}>{p.slice(2,-2)}</strong>
            if (p.startsWith('*')  && p.endsWith('*'))  return <em key={j}>{p.slice(1,-1)}</em>
            return p
          })}
        </span>
      )
    })
  }

  if (msg.role === 'thinking') {
    return (
      <div className="message-wrapper">
        <div className="message-avatar ai">⚡</div>
        <div className="message-body">
          <div className="message-bubble ai thinking">
            <div className="thinking-dots"><span/><span/><span/></div>
            <span>{msg.content}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`message-wrapper ${msg.role} animate-in`}>
      <div className={`message-avatar ${msg.role}`}>
        {msg.role === 'ai' ? '⚡' : (msg.content[0]?.toUpperCase() || 'U')}
      </div>
      <div className="message-body">
        <div className={`message-bubble ${msg.role}`}>
          {renderText(msg.content)}
        </div>

        {/* Result meta */}
        {msg.meta?.rowCount > 0 && (
          <div className="result-meta">
            <span className="result-badge rows">📊 {msg.meta.rowCount.toLocaleString()} rows</span>
            {msg.meta.filesUsed?.map(f => (
              <span key={f} className="result-badge source">📁 {f}</span>
            ))}
          </div>
        )}

        {/* Data table */}
        {msg.meta?.rows?.length > 0 && msg.meta?.columns?.length > 0 && (
          <div className="result-table-wrap">
            <table className="result-table">
              <thead>
                <tr>{msg.meta.columns.map(c => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {msg.meta.rows.slice(0, 200).map((row, ri) => (
                  <tr key={ri}>
                    {msg.meta.columns.map(c => <td key={c} title={String(row[c] ?? '')}>{String(row[c] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Chart */}
        {msg.meta?.chartData && (
          <div className="chart-container">
            <div className="chart-title">📈 {msg.meta.chartData.label}</div>
            <Bar
              data={{
                labels: msg.meta.chartData.labels,
                datasets: [{
                  label: msg.meta.chartData.yLabel,
                  data:  msg.meta.chartData.values,
                  backgroundColor: CHART_COLORS.map(c => c + 'CC'),
                  borderColor:     CHART_COLORS,
                  borderWidth: 1.5,
                  borderRadius: 4,
                }],
              }}
              options={{
                responsive: true,
                plugins: {
                  legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 } } },
                  tooltip: { backgroundColor: '#0d1321', titleColor: '#00e5a0', bodyColor: '#f1f5f9' },
                },
                scales: {
                  x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                  y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                },
              }}
              height={180}
            />
          </div>
        )}

        {/* Download card */}
        {msg.meta?.outputFile && (
          <div className="download-card" onClick={() => onDownload(msg.meta.outputFile)}>
            <div className="download-card-icon">
              <FileSpreadsheet size={22} />
            </div>
            <div className="download-card-info">
              <div className="download-card-name">{msg.meta.outputFile.filename}.xlsx</div>
              <div className="download-card-sub">{msg.meta.rowCount?.toLocaleString()} rows · Click to download</div>
            </div>
            <Download size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          </div>
        )}

        {/* Suggestions */}
        {msg.role === 'ai' && msg.meta?.suggestions?.length > 0 && (
          <div className="suggestions">
            {msg.meta.suggestions.map((s, i) => (
              <button key={i} className="suggestion-chip" onClick={() => onSuggestion(s)}>{s}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sidebar ─────────────────────────────────────────────────
function Sidebar({ folders, files, scanning, scanProgress, onPickFolder, onRemoveFolder, onScanFile }) {
  const isChrome = /Chrome|Edg/.test(navigator.userAgent)

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <FileSpreadsheet size={20} />
        </div>
        <span className="sidebar-logo-text">Excelarated</span>
      </div>

      {!isChrome && (
        <div className="browser-warning">
          ⚠️ Please use <strong>Chrome or Edge</strong> for folder scanning to work.
        </div>
      )}

      <div className="sidebar-section">📂 Watched Folders</div>
      <div className="scan-area">
        <button className="scan-btn" onClick={onPickFolder} disabled={scanning}>
          <FolderOpen size={14} />
          Add folder to watch
        </button>

        {folders.map(f => (
          <div key={f.id} className="folder-item">
            <span style={{ fontSize: 13 }}>📁</span>
            <span className="folder-item-name">{f.handle?.name || f.id}</span>
            <button className="folder-remove" onClick={() => onRemoveFolder(f.id)}>
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      {scanning && (
        <div className="scan-progress">
          <div className="spinner" style={{ width: 14, height: 14 }} />
          <span>{scanProgress || 'Scanning…'}</span>
        </div>
      )}

      <div className="sidebar-section" style={{ marginTop: 12 }}>
        📊 {files.length} File{files.length !== 1 ? 's' : ''} Indexed
      </div>

      <div className="file-index">
        {files.length === 0 && !scanning && (
          <div className="empty-index">
            No files yet. Add a folder above to start indexing your Excel files.
          </div>
        )}
        {files.map(f => (
          <div key={f.path} className="file-index-item" onClick={() => onScanFile(f)}>
            <div className="file-index-icon">
              {f.filename.endsWith('.csv') ? '📄' : '📊'}
            </div>
            <div className="file-index-info">
              <div className="file-index-name" title={f.filename}>{f.filename}</div>
              <div className="file-index-meta">
                {f.row_count?.toLocaleString() || '?'} rows · {f.col_count} cols · {f.size_kb}KB
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [messages,     setMessages]     = useState([])
  const [input,        setInput]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const [status,       setStatus]       = useState('')
  const [folders,      setFolders]      = useState([])
  const [files,        setFiles]        = useState([])
  const [scanning,     setScanning]     = useState(false)
  const [scanProgress, setScanProgress] = useState('')
  const messagesEndRef = useRef(null)
  const textareaRef    = useRef(null)

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })

  // Load persisted data
  useEffect(() => {
    ;(async () => {
      const [storedFiles, storedHandles] = await Promise.all([getAllFiles(), getAllHandles()])
      setFiles(storedFiles.sort((a,b) => b.row_count - a.row_count))
      setFolders(storedHandles)
      const history = await getMessages('default', 100)
      if (history.length > 0) setMessages(history.map(m => ({ role: m.role, content: m.content, meta: m.meta })))
    })()
  }, [])

  useEffect(() => { scrollToBottom() }, [messages])

  const refreshFiles = async () => {
    const f = await getAllFiles()
    setFiles(f.sort((a,b) => b.row_count - a.row_count))
  }

  // Add a folder
  const handlePickFolder = async () => {
    try {
      const { key, handle } = await pickFolder()
      setFolders(prev => [...prev, { id: key, handle }])
      setScanning(true)
      setScanProgress('Starting scan…')
      await scanFolder(key, handle, ({ file, count }) => setScanProgress(`Found ${count} files… (${file})`))
      setScanning(false)
      setScanProgress('')
      await refreshFiles()
      const storedHandles = await getAllHandles()
      setFolders(storedHandles)
    } catch (e) {
      setScanning(false)
      if (e.name !== 'AbortError') alert('Error: ' + e.message)
    }
  }

  const handleRemoveFolder = async (key) => {
    await removeStoredFolder(key)
    setFolders(prev => prev.filter(f => f.id !== key))
    await refreshFiles()
  }

  // Send message
  const sendMessage = useCallback(async (text = input) => {
    const msg = text.trim()
    if (!msg || loading) return
    setInput('')
    textareaRef.current?.style && (textareaRef.current.style.height = 'auto')

    const userMsg = { role: 'user', content: msg }
    setMessages(prev => [...prev, userMsg])
    await saveMessage({ role: 'user', content: msg, meta: {}, session: 'default' })

    setLoading(true)
    // Thinking bubble
    const thinkId = Date.now()
    setMessages(prev => [...prev, { role: 'thinking', content: 'Searching your files…', id: thinkId }])

    try {
      const result = await processQuery(msg, (s) => {
        setMessages(prev => prev.map(m => m.id === thinkId ? { ...m, content: s } : m))
      })

      // Build chart data if we have grouped rows
      let chartData = null
      if (result.rows?.length > 0 && result.rows.length <= 30 && result.columns?.length === 2) {
        const [xCol, yCol] = result.columns
        const numVals = result.rows.map(r => parseFloat(r[yCol])).filter(v => !isNaN(v))
        if (numVals.length === result.rows.length) {
          chartData = {
            labels:  result.rows.map(r => String(r[xCol] ?? '').slice(0, 25)),
            values:  numVals,
            yLabel:  yCol,
            label:   `${yCol} by ${xCol}`,
          }
        }
      }

      const aiMeta = {
        rowCount:  result.rowCount,
        rows:      result.rows,
        columns:   result.columns,
        filesUsed: result.filesUsed,
        outputFile: result.outputFile,
        suggestions: result.suggestions,
        chartData,
      }

      const aiMsg = { role: 'ai', content: result.answer, meta: aiMeta }
      setMessages(prev => prev.filter(m => m.id !== thinkId).concat(aiMsg))
      await saveMessage({ role: 'ai', content: result.answer, meta: aiMeta, session: 'default' })
    } catch (e) {
      const errMsg = { role: 'ai', content: `Sorry, something went wrong: ${e.message}`, meta: {} }
      setMessages(prev => prev.filter(m => m.id !== thinkId).concat(errMsg))
    }
    setLoading(false)
  }, [input, loading])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const handleTextareaChange = (e) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
  }

  const handleDownload = async (outputFile) => {
    if (!outputFile) return
    try {
      await buildAndDownloadExcel(outputFile)
    } catch (e) {
      alert('Error creating Excel file: ' + e.message)
    }
  }

  const handleClearChat = async () => {
    if (!confirm('Clear all chat history?')) return
    await clearMessages('default')
    setMessages([])
  }

  return (
    <div className="app-shell">
      <Sidebar
        folders={folders}
        files={files}
        scanning={scanning}
        scanProgress={scanProgress}
        onPickFolder={handlePickFolder}
        onRemoveFolder={handleRemoveFolder}
        onScanFile={(f) => sendMessage(`Tell me about the file ${f.filename} — how many rows, what columns, and give me a summary`)}
      />

      <main className="chat-main">
        {/* Welcome screen when no messages */}
        {messages.length === 0 ? (
          <div className="welcome-screen">
            <div className="welcome-logo">⚡</div>
            <div>
              <div className="welcome-title">Excelarated</div>
              <div className="welcome-sub" style={{ marginTop: 8 }}>
                Your AI Excel assistant. Add folders in the sidebar, then ask anything about your data — filter, aggregate, query timelines, and create beautiful Excel reports.
              </div>
            </div>
            <div className="welcome-examples">
              {EXAMPLES.map((ex, i) => (
                <button key={i} className="welcome-example" onClick={() => sendMessage(ex.text)}>
                  <strong>{ex.label}</strong>
                  {ex.text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Top bar */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 24px', borderBottom:'1px solid var(--border)', background:'var(--bg-base)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <Zap size={16} style={{ color:'var(--accent)' }} />
                <span style={{ fontSize:14, fontWeight:600, color:'var(--text-secondary)' }}>
                  {files.length} files indexed
                </span>
                {scanning && (
                  <span style={{ fontSize:12, color:'var(--accent)', display:'flex', alignItems:'center', gap:6 }}>
                    <Loader2 size={13} style={{ animation:'spin 0.7s linear infinite' }} /> Scanning…
                  </span>
                )}
              </div>
              <button
                onClick={handleClearChat}
                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', alignItems:'center', gap:6, fontSize:12, fontFamily:'inherit', padding:'4px 8px', borderRadius:'var(--r-sm)', transition:'color 0.15s' }}
              >
                <RotateCcw size={13} /> New chat
              </button>
            </div>

            {/* Messages */}
            <div className="messages-container">
              {messages.map((msg, i) => (
                <MessageBubble
                  key={i}
                  msg={msg}
                  onSuggestion={sendMessage}
                  onDownload={handleDownload}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </>
        )}

        {/* Input area */}
        <div className="input-area">
          <div className="input-box">
            <textarea
              ref={textareaRef}
              className="input-textarea"
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your Excel files… (Shift+Enter for new line)"
              rows={1}
              disabled={loading}
            />
            <button className="input-send" onClick={() => sendMessage()} disabled={loading || !input.trim()}>
              {loading
                ? <Loader2 size={17} style={{ animation:'spin 0.7s linear infinite' }} />
                : <Send size={17} />
              }
            </button>
          </div>
          <div className="input-footer">
            Excelarated runs entirely in your browser • No data leaves your laptop
          </div>
        </div>
      </main>
    </div>
  )
}
