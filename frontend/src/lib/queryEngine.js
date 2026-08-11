/**
 * queryEngine.js — Natural language query processor.
 * Searches the file index, loads relevant data, applies filters/aggregations,
 * and prepares results for the chat UI.
 */
import { searchFiles } from './db.js'
import { loadFileData } from './scanner.js'

// ── Intent detection ─────────────────────────────────────
export function detectIntent(text) {
  const t = text.toLowerCase()
  if (/\b(create|make|generate|build|export|save|new file|new excel|produce|write)\b/.test(t)) return 'create'
  if (/\b(chart|graph|plot|visualize|bar|line|pie|trend)\b/.test(t)) return 'chart'
  if (/\b(total|sum|count|how many|average|avg|mean|max|min|minimum|maximum)\b/.test(t)) return 'aggregate'
  if (/\b(merge|combine|join|consolidate)\b/.test(t)) return 'merge'
  if (/\b(filter|where|find|show|get|extract|list|which|give me|all)\b/.test(t)) return 'filter'
  return 'query'
}

// ── Tokenize for search ───────────────────────────────────
function tokenize(text) {
  return text.toLowerCase()
    .split(/[\s,.\-!?;:]+/)
    .filter(w => w.length > 2 && !/^(the|and|for|from|with|that|this|are|was|were|has|have|had|not|but|can|will|would|could|should|into|onto|about|when|where|what|which|who|why|how|its|our|your|their|them|they|then|than|much|many|some|more|most|also|just|been|being|does|did|his|her|him|she|per|via)$/.test(w))
}

// ── Date range extraction ─────────────────────────────────
const MONTHS = { january:1,jan:1,february:2,feb:2,march:3,mar:3,april:4,apr:4,may:5,june:6,jun:6,july:7,jul:7,august:8,aug:8,september:9,sep:9,sept:9,october:10,oct:10,november:11,nov:11,december:12,dec:12 }

function parseFuzzyDate(s) {
  s = s.trim().toLowerCase()
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return new Date(+m[1], +m[2]-1, +m[3])
  // "Jan 2024" or "January 2024"
  m = s.match(/^([a-z]+)\s+(\d{4})$/)
  if (m && MONTHS[m[1]]) return new Date(+m[2], MONTHS[m[1]]-1, 1)
  // "2024"
  m = s.match(/^(\d{4})$/)
  if (m) return new Date(+m[1], 0, 1)
  // DD/MM/YYYY or MM/DD/YYYY
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return new Date(y, +m[1]-1, +m[2])
  }
  return null
}

export function extractDateRange(text) {
  const t = text.toLowerCase()

  // "last N days/weeks/months/years"
  let m = t.match(/last\s+(\d+)\s+(day|week|month|year)s?/)
  if (m) {
    const n = +m[1], unit = m[2]
    const end   = new Date()
    const start = new Date()
    const days  = { day:1, week:7, month:30, year:365 }[unit]
    start.setDate(start.getDate() - n * days)
    return { start, end }
  }

  // "this month/year/week"
  m = t.match(/\b(this month|this year|this week|today|yesterday)\b/)
  if (m) {
    const now = new Date()
    if (m[1] === 'this month') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
    if (m[1] === 'this year')  return { start: new Date(now.getFullYear(), 0, 1), end: now }
    if (m[1] === 'this week')  { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); return { start: d, end: now } }
    if (m[1] === 'today')      return { start: new Date(now.toDateString()), end: now }
    if (m[1] === 'yesterday')  { const d = new Date(now); d.setDate(d.getDate()-1); return { start: d, end: d } }
  }

  // "from X to Y" / "between X and Y"
  const fromPat = /(?:from|after|since|starting)\s+([a-z0-9\s\-\/]+?)(?:\s+to|\s+until|\s+and|\s+till|$)/i
  const toPat   = /(?:to|until|till|before|ending|through)\s+([a-z0-9\s\-\/]+?)(?:\s+$|\s*[,;]|$)/i
  const fromM   = text.match(fromPat)
  const toM     = text.match(toPat)
  const start   = fromM ? parseFuzzyDate(fromM[1]) : null
  const end     = toM   ? parseFuzzyDate(toM[1])   : null
  if (start || end) return { start, end }
  return { start: null, end: null }
}

// ── Column fuzzy finder ───────────────────────────────────
function findCol(row, term) {
  if (!row || !term) return null
  const t = term.toLowerCase().replace(/[\s_]+/g, '')
  const keys = Object.keys(row)
  for (const k of keys) {
    const kk = k.toLowerCase().replace(/[\s_]+/g, '')
    if (t === kk || kk.includes(t) || t.includes(kk)) return k
  }
  return null
}

function findDateCol(rows) {
  if (!rows || rows.length === 0) return null
  const dateWords = ['date', 'time', 'created', 'updated', 'start', 'end', 'timestamp', 'from', 'to', 'at', 'on']
  const sample = rows[0]
  for (const k of Object.keys(sample)) {
    const kl = k.toLowerCase()
    if (dateWords.some(w => kl.includes(w))) {
      // Verify some values look like dates
      const vals = rows.slice(0, 5).map(r => r[k]).filter(Boolean)
      if (vals.some(v => !isNaN(Date.parse(String(v))))) return k
    }
  }
  return null
}

// ── Filter term extraction ────────────────────────────────
function extractFilters(text) {
  const filters = []
  const pat = /([a-zA-Z][a-zA-Z0-9_\s]{1,25}?)\s+(is|are|=|contains|like|equals|over|under|more than|less than|greater than|>=|<=|>|<)\s+["']?([a-zA-Z0-9_\s\.\-]{1,40})["']?/gi
  let m
  while ((m = pat.exec(text)) !== null) {
    filters.push({ col: m[1].trim(), op: m[2].trim().toLowerCase(), val: m[3].trim() })
  }
  return filters
}

function applyFilter(rows, { col, op, val }) {
  const numVal = parseFloat(val.replace(/,/g, ''))
  const isNum  = !isNaN(numVal)
  return rows.filter(row => {
    const key = findCol(row, col)
    if (!key) return true // don't filter if column not found
    const cellVal = row[key]
    const cellNum = parseFloat(String(cellVal).replace(/,/g, ''))
    const cellStr = String(cellVal ?? '').toLowerCase()
    const valStr  = val.toLowerCase()
    if (['is', 'are', '=', 'equals'].includes(op)) return isNum ? cellNum === numVal : cellStr === valStr
    if (['contains', 'like'].includes(op))           return cellStr.includes(valStr)
    if (['>', 'over', 'greater than', 'more than'].includes(op)) return isNum && cellNum > numVal
    if (['<', 'under', 'less than'].includes(op))   return isNum && cellNum < numVal
    if (op === '>=') return isNum && cellNum >= numVal
    if (op === '<=') return isNum && cellNum <= numVal
    return true
  })
}

// ── Aggregation ───────────────────────────────────────────
function aggregate(rows, query) {
  const t = query.toLowerCase()
  const tokens = tokenize(query)
  const keys = rows.length > 0 ? Object.keys(rows[0]) : []
  const numCols  = keys.filter(k => rows.slice(0,10).every(r => !isNaN(parseFloat(r[k])) || r[k] == null))
  const textCols = keys.filter(k => !numCols.includes(k))

  // Find target column from query
  let targetCol = null
  for (const t of tokens) {
    for (const k of numCols) {
      if (k.toLowerCase().replace(/\s/g,'').includes(t) || t.includes(k.toLowerCase().replace(/\s/g,''))) {
        targetCol = k; break
      }
    }
    if (targetCol) break
  }
  targetCol = targetCol || numCols[0]

  // Find group-by column
  const groupMatch = query.match(/(?:by|per|grouped by|group by|for each)\s+([a-zA-Z][a-zA-Z0-9_\s]{1,25})/i)
  let groupCol = null
  if (groupMatch) {
    const term = groupMatch[1].trim()
    for (const k of textCols) {
      if (k.toLowerCase().replace(/\s/g,'').includes(term.toLowerCase().replace(/\s/g,''))) {
        groupCol = k; break
      }
    }
    if (!groupCol) groupCol = textCols[0]
  }

  const getVals = col => rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v))

  if (groupCol && targetCol) {
    // Grouped aggregation
    const groups = {}
    for (const row of rows) {
      const gv = String(row[groupCol] ?? 'Unknown')
      if (!groups[gv]) groups[gv] = []
      const v = parseFloat(row[targetCol])
      if (!isNaN(v)) groups[gv].push(v)
    }
    let agg
    if (/\b(count|how many)\b/.test(t)) {
      agg = Object.entries(groups).map(([g, vs]) => ({ [groupCol]: g, Count: vs.length }))
    } else if (/\b(avg|average|mean)\b/.test(t)) {
      agg = Object.entries(groups).map(([g, vs]) => ({ [groupCol]: g, [targetCol+' Avg']: vs.length ? +(vs.reduce((a,b)=>a+b,0)/vs.length).toFixed(2) : 0 }))
    } else {
      agg = Object.entries(groups).map(([g, vs]) => ({ [groupCol]: g, [targetCol+' Total']: vs.reduce((a,b)=>a+b,0) }))
    }
    agg.sort((a,b) => {
      const key = Object.keys(a)[1]
      return (b[key]||0) - (a[key]||0)
    })
    const label = groupCol + (targetCol ? ` vs ${targetCol}` : '')
    return { type:'table', rows: agg, message: `Grouped by **${groupCol}** — ${agg.length} groups.`, label }
  }

  if (!targetCol) {
    return { type:'scalar', message: `**${rows.length.toLocaleString()}** rows found.`, rows:[], label:'' }
  }

  const vals = getVals(targetCol)
  if (/\b(count|how many)\b/.test(t)) return { type:'scalar', message:`**${rows.length.toLocaleString()}** rows.`, rows:[], label:'' }
  if (/\b(avg|average|mean)\b/.test(t)) {
    const v = vals.reduce((a,b)=>a+b,0)/vals.length
    return { type:'scalar', message:`Average of **${targetCol}**: **${v.toLocaleString(undefined,{maximumFractionDigits:2})}**`, rows:[], label:'' }
  }
  if (/\b(max|maximum|highest|largest)\b/.test(t)) {
    const v = Math.max(...vals)
    return { type:'scalar', message:`Maximum of **${targetCol}**: **${v.toLocaleString()}**`, rows:[], label:'' }
  }
  if (/\b(min|minimum|lowest|smallest)\b/.test(t)) {
    const v = Math.min(...vals)
    return { type:'scalar', message:`Minimum of **${targetCol}**: **${v.toLocaleString()}**`, rows:[], label:'' }
  }
  const total = vals.reduce((a,b)=>a+b,0)
  return { type:'scalar', message:`Total of **${targetCol}**: **${total.toLocaleString(undefined,{maximumFractionDigits:2})}**`, rows:[], label:'' }
}

// ── Main process function ─────────────────────────────────
export async function processQuery(userMessage, onStatus) {
  const intent  = detectIntent(userMessage)
  const tokens  = tokenize(userMessage)
  const dateRange = extractDateRange(userMessage)
  const filters = extractFilters(userMessage)

  onStatus?.('Finding relevant files…')

  // Search indexed files
  const relevant = await searchFiles(tokens, 8)
  if (relevant.length === 0) {
    return {
      answer: 'I don\'t have any files indexed yet! Click the **Scan Folders** button to let me discover your Excel and CSV files.',
      type: 'info', rows: [], columns: [], rowCount: 0,
      outputFile: null, filesUsed: [],
      suggestions: ['Scan my folders for Excel files', 'Add a folder to watch'],
    }
  }

  // Load data from relevant files
  onStatus?.(`Loading data from ${relevant.length} file(s)…`)
  const allRows = []
  const filesUsed = []

  for (const f of relevant) {
    try {
      onStatus?.(`Reading ${f.filename}…`)
      const rows = await loadFileData(f, 500_000)
      if (rows && rows.length > 0) {
        rows.forEach(r => r.__source__ = f.filename)
        allRows.push(...rows)
        filesUsed.push(f.filename)
      }
    } catch (e) {
      console.warn(`Could not load ${f.filename}:`, e)
    }
  }

  if (allRows.length === 0) {
    return {
      answer: `Found ${relevant.length} matching files but couldn't read their data. They may be locked or need re-scanning.`,
      type: 'error', rows: [], columns: [], rowCount: 0,
      outputFile: null, filesUsed: relevant.map(f => f.filename),
      suggestions: ['Re-scan folders', 'Try a different search'],
    }
  }

  let workingRows = [...allRows]

  // Apply date filter
  if (dateRange.start || dateRange.end) {
    onStatus?.('Filtering by date range…')
    const dateSample = workingRows[0]
    const dateCol = dateSample ? findDateCol([dateSample]) : null
    if (dateCol) {
      workingRows = workingRows.filter(row => {
        const v = row[dateCol]
        if (!v) return false
        const d = new Date(v)
        if (isNaN(d)) return false
        if (dateRange.start && d < dateRange.start) return false
        if (dateRange.end   && d > dateRange.end)   return false
        return true
      })
    }
  }

  // ── Smart Conversational Filter ──
  // Extract all searchable terms from query (excluding stopwords and SQL commands)
  const ignoreTerms = new Set([
    'total', 'sum', 'average', 'count', 'find', 'show', 'get', 'filter',
    'make', 'excel', 'sheet', 'list', 'outage', 'outages', 'with', 'reason',
    'reasons', 'timeline', 'called', 'named', 'save', 'export', 'create',
    'generate', 'build', 'file', 'from', 'where', 'and', 'for', 'about'
  ])
  const searchTerms = tokens.filter(t => !ignoreTerms.has(t.toLowerCase()))

  if (workingRows.length > 0 && searchTerms.length > 0) {
    const keys = Object.keys(workingRows[0]).filter(k => k !== '__source__')
    
    // For each search term, check if it matches a column name or a column cell value
    for (const term of searchTerms) {
      let filtered = false
      const tl = term.toLowerCase()

      // 1. Check if term matches column values
      for (const col of keys) {
        // Sample check first for speed
        const hasMatch = workingRows.some(row => String(row[col] ?? '').toLowerCase().includes(tl))
        if (hasMatch) {
          workingRows = workingRows.filter(row => String(row[col] ?? '').toLowerCase().includes(tl))
          filtered = true
          break // matched this term to a column, move to next term
        }
      }

      // 2. Fallback: general row search if not matched to a specific column value
      if (!filtered) {
        const rowMatch = workingRows.filter(row => {
          const rowStr = Object.values(row).join(' ').toLowerCase()
          return rowStr.includes(tl)
        })
        if (rowMatch.length > 0) {
          workingRows = rowMatch
        }
      }
    }
  }


  // Aggregate if needed
  let aggResult = null
  if (intent === 'aggregate') {
    onStatus?.('Calculating…')
    aggResult = aggregate(workingRows, userMessage)
    if (aggResult.type === 'scalar') {
      return {
        answer: aggResult.message + `\n\nSearched across **${filesUsed.length} file(s)** with **${allRows.length.toLocaleString()} total rows**.`,
        type: 'aggregate', rows: [], columns: [], rowCount: 0,
        outputFile: null, filesUsed,
        suggestions: buildSuggestions(workingRows, intent),
      }
    }
    workingRows = aggResult.rows
  }

  const cols = workingRows.length > 0 ? Object.keys(workingRows[0]).filter(k => k !== '__source__') : []
  const dateNote = (dateRange.start || dateRange.end)
    ? ` (${dateRange.start ? dateRange.start.toLocaleDateString() : '...'} → ${dateRange.end ? dateRange.end.toLocaleDateString() : '...'})`
    : ''

  let answer = workingRows.length === 0
    ? `No rows matched your query${dateNote}. Try broadening the search.`
    : `Found **${workingRows.length.toLocaleString()} rows**${dateNote} across **${filesUsed.length} file(s)**: ${filesUsed.join(', ')}.`

  if (aggResult) answer = aggResult.message + '\n\n' + answer

  const outputFile = (intent === 'create' || /\b(new file|excel file|save as|export)\b/i.test(userMessage))
    ? { rows: workingRows, columns: cols, filename: generateFilename(userMessage), filesUsed, summary: `Query: ${userMessage}\nRows: ${workingRows.length.toLocaleString()}\nSources: ${filesUsed.join(', ')}` }
    : null

  if (outputFile) answer += `\n\nI've prepared the data — click **Download Excel** to save it.`

  return {
    answer,
    type: intent,
    rows: workingRows.slice(0, 500),
    columns: cols,
    rowCount: workingRows.length,
    outputFile,
    filesUsed,
    suggestions: buildSuggestions(workingRows, intent),
  }
}

function generateFilename(query) {
  const nameMatch = query.match(/(?:called|named|save as|file name)\s+["']?([a-zA-Z0-9_ -]+)["']?/i)
  if (nameMatch) return nameMatch[1].trim().replace(/\s+/g, '_')
  return `excelarated_${new Date().toISOString().slice(0,10)}`
}

function buildSuggestions(rows, intent) {
  if (!rows || rows.length === 0) return ['Try a broader search', 'Scan more folders']
  const keys = Object.keys(rows[0]).filter(k => k !== '__source__')
  const numKeys = keys.filter(k => rows.slice(0,5).some(r => !isNaN(parseFloat(r[k]))))
  const textKeys = keys.filter(k => !numKeys.includes(k))
  const s = []
  if (numKeys[0])  s.push(`Show total ${numKeys[0]}${textKeys[0] ? ' by ' + textKeys[0] : ''}`)
  if (textKeys[0]) s.push(`Group results by ${textKeys[0]}`)
  if (intent !== 'create') s.push('Create a new Excel file with this data')
  if (numKeys[0] && textKeys[0]) s.push(`Create a chart of ${numKeys[0]} by ${textKeys[0]}`)
  return s.slice(0, 4)
}
