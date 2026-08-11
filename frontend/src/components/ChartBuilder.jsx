import { useState } from 'react'
import {
  BarChart2, LineChart, PieChart, ScatterChart, AreaChart as AreaIcon,
  RefreshCw, Download,
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart as RLineChart, Line,
  AreaChart, Area,
  ScatterChart as RScatterChart, Scatter,
  PieChart as RPieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

const COLORS = ['#00e5a0', '#7c3aed', '#f97316', '#38bdf8', '#f43f5e', '#a3e635', '#fb923c']

const CHART_TYPES = [
  { id: 'bar',     label: 'Bar',     Icon: BarChart2 },
  { id: 'line',    label: 'Line',    Icon: LineChart },
  { id: 'area',    label: 'Area',    Icon: AreaIcon },
  { id: 'pie',     label: 'Pie',     Icon: PieChart },
]

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(14,22,35,0.97)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10,
      padding: '8px 14px',
      fontSize: 12.5,
    }}>
      {label && <div style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || COLORS[i], fontWeight: 600 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </div>
      ))}
    </div>
  )
}

export default function ChartBuilder({ metadata }) {
  const [chartType, setChartType] = useState('bar')
  const [xCol,      setXCol]      = useState('')
  const [yCol,      setYCol]      = useState('')

  if (!metadata) {
    return (
      <div className="empty-state">
        <BarChart2 size={40} />
        <p>Select and open a file to start building charts.</p>
      </div>
    )
  }

  const cols = metadata.columns || []
  const textCols    = cols.filter(c => c.type === 'text')
  const numericCols = cols.filter(c => c.type === 'numeric')
  const allRows     = metadata.preview_rows || []

  // Build chart data: aggregate Y by X
  const buildData = () => {
    if (!xCol || !yCol || !allRows.length) return []
    if (chartType === 'pie') {
      const groups = {}
      allRows.forEach(row => {
        const key = String(row[xCol] ?? 'Unknown')
        const val = Number(row[yCol]) || 0
        groups[key] = (groups[key] || 0) + val
      })
      return Object.entries(groups)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12)
    }
    const groups = {}
    allRows.forEach(row => {
      const key = String(row[xCol] ?? 'Unknown')
      const val = Number(row[yCol]) || 0
      groups[key] = (groups[key] || 0) + val
    })
    return Object.entries(groups)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 30)
  }

  const data = buildData()

  const renderChart = () => {
    if (!data.length) {
      return (
        <div className="empty-state" style={{ height: 300 }}>
          <BarChart2 size={28} />
          <p>Select X and Y columns to generate a chart.</p>
        </div>
      )
    }

    const commonProps = {
      data,
      margin: { top: 10, right: 20, left: 0, bottom: 50 },
    }

    if (chartType === 'pie') {
      return (
        <ResponsiveContainer width="100%" height={340}>
          <RPieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={120} label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </RPieChart>
        </ResponsiveContainer>
      )
    }

    if (chartType === 'bar') {
      return (
        <ResponsiveContainer width="100%" height={340}>
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" name={yCol} fill={COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (chartType === 'line') {
      return (
        <ResponsiveContainer width="100%" height={340}>
          <RLineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="value" name={yCol} stroke={COLORS[0]} strokeWidth={2.5} dot={{ r: 3, fill: COLORS[0] }} />
          </RLineChart>
        </ResponsiveContainer>
      )
    }

    if (chartType === 'area') {
      return (
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart {...commonProps}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS[0]} stopOpacity={0.3} />
                <stop offset="95%" stopColor={COLORS[0]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="value" name={yCol} stroke={COLORS[0]} fill="url(#areaGrad)" strokeWidth={2.5} />
          </AreaChart>
        </ResponsiveContainer>
      )
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Chart type selector */}
      <div style={{ display: 'flex', gap: 8 }}>
        {CHART_TYPES.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`btn btn-sm ${chartType === id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setChartType(id)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Column pickers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="form-group">
          <label className="label">X Axis (Category)</label>
          <select className="select" value={xCol} onChange={e => setXCol(e.target.value)}>
            <option value="">— Choose column —</option>
            {cols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Y Axis (Numeric)</label>
          <select className="select" value={yCol} onChange={e => setYCol(e.target.value)}>
            <option value="">— Choose column —</option>
            {numericCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* Chart */}
      <div className="card" style={{ padding: 16 }}>
        {renderChart()}
      </div>
    </div>
  )
}
