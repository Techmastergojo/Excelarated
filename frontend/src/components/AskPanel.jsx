import { useEffect, useRef, useState } from 'react'
import { Send, Bot, User, Loader2, FileText, Download } from 'lucide-react'
import { queryData, downloadFile, saveData } from '../api'

function MarkdownAnswer({ text }) {
  // Very simple bold and newline support
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : p
      )}
    </span>
  )
}

export default function AskPanel({ files, selectedFiles }) {
  const [messages, setMessages] = useState([
    {
      role: 'ai',
      text: "Hi! I'm your data assistant. Select files on the left and ask me anything — like *\"What is the total sales?\"*, *\"Find all customers from Lagos\"*, or *\"Show top 5 by revenue\"*.",
      rows: null,
      cols: null,
    },
  ])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const q = input.trim()
    if (!q || loading) return
    if (!selectedFiles.length) {
      setMessages(m => [...m, { role: 'ai', text: '⚠️ Please select at least one file first.', rows: null, cols: null }])
      return
    }

    setMessages(m => [...m, { role: 'user', text: q, rows: null, cols: null }])
    setInput('')
    setLoading(true)

    try {
      const res = await queryData({ filenames: selectedFiles, query: q })
      setMessages(m => [...m, {
        role: 'ai',
        text: res.answer,
        rows: res.rows,
        cols: res.columns,
        rowCount: res.row_count,
        qtype: res.type,
      }])
    } catch (e) {
      setMessages(m => [...m, {
        role: 'ai',
        text: `❌ Error: ${e.response?.data?.detail || e.message}`,
        rows: null,
        cols: null,
      }])
    }
    setLoading(false)
  }

  const handleExport = async (rows, cols, idx) => {
    const fname = `query_result_${idx}.xlsx`
    try {
      await saveData({ rows, columns: cols, output_filename: fname, filename: selectedFiles[0] })
      window.open(downloadFile(fname), '_blank')
    } catch (e) {
      alert('Export failed: ' + (e.response?.data?.detail || e.message))
    }
  }

  return (
    <div className="chat-container" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble ${msg.role}`}>
            <div className={`chat-avatar ${msg.role}`}>
              {msg.role === 'ai' ? <Bot size={16} /> : <User size={16} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '82%' }}>
              <div className="chat-text">
                <MarkdownAnswer text={msg.text} />
              </div>
              {msg.rows && msg.rows.length > 0 && msg.cols && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border)', maxHeight: 240 }}>
                    <table>
                      <thead>
                        <tr>
                          {msg.cols.map(c => <th key={c}>{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {msg.rows.slice(0, 50).map((row, ri) => (
                          <tr key={ri}>
                            {msg.cols.map(c => <td key={c}>{row[c] ?? ''}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                    <FileText size={13} />
                    {msg.rowCount} rows · showing up to 50
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => handleExport(msg.rows, msg.cols, i)}
                    >
                      <Download size={13} /> Export to Excel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="chat-bubble ai">
            <div className="chat-avatar ai"><Bot size={16} /></div>
            <div className="chat-text" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Loader2 size={15} style={{ animation: 'spin 0.7s linear infinite' }} />
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <input
          className="input chat-input"
          placeholder="Ask anything about your data…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          disabled={loading}
        />
        <button className="btn btn-primary" onClick={send} disabled={loading || !input.trim()}>
          {loading ? <Loader2 size={16} style={{ animation: 'spin 0.7s linear infinite' }} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  )
}
