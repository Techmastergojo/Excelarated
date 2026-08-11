/**
 * scanner.js — Uses the File System Access API to scan folders for Excel/CSV files.
 * Handles are stored in IndexedDB so folders stay accessible across sessions.
 */
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import { saveHandle, getAllHandles, deleteHandle, upsertFile, deleteFile, getAllFiles } from './db.js'

const SUPPORTED = new Set(['.xlsx', '.xls', '.csv', '.xlsm'])
const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', '.git', 'venv', '.venv',
  'AppData', 'ProgramData', 'Windows', 'System Volume Information',
  '$Recycle.Bin', 'build', 'dist', 'build_tmp', 'dist_exe',
])
const MAX_DEPTH = 6
const MAX_FILE_SIZE_MB = 200  // skip files larger than 200 MB

// ── Folder picking ─────────────────────────────────────────
export async function pickFolder() {
  if (!window.showDirectoryPicker) {
    throw new Error('Your browser does not support folder access. Please use Chrome or Edge.')
  }
  const handle = await window.showDirectoryPicker({ mode: 'read' })
  const key = `folder_${handle.name}_${Date.now()}`
  await saveHandle(key, handle)
  return { key, handle, name: handle.name }
}

export async function getStoredFolders() {
  const records = await getAllHandles()
  return records
}

export async function removeStoredFolder(key) {
  await deleteHandle(key)
  // Remove files that came from this folder from the index
  const all = await getAllFiles()
  for (const f of all) {
    if (f.handleKey === key) await deleteFile(f.path)
  }
}

// Request re-permission for stored handles
export async function verifyHandlePermission(handle) {
  try {
    const perm = await handle.queryPermission({ mode: 'read' })
    if (perm === 'granted') return true
    const req = await handle.requestPermission({ mode: 'read' })
    return req === 'granted'
  } catch {
    return false
  }
}

// ── Recursive file discovery ─────────────────────────────
async function* walkDirectory(dirHandle, path = '', depth = 0) {
  if (depth > MAX_DEPTH) return
  for await (const [name, entry] of dirHandle.entries()) {
    const entryPath = path ? `${path}/${name}` : name
    if (entry.kind === 'directory') {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) {
        yield* walkDirectory(entry, entryPath, depth + 1)
      }
    } else if (entry.kind === 'file') {
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
      if (SUPPORTED.has(ext)) {
        yield { name, path: entryPath, handle: entry }
      }
    }
  }
}

// ── File parsing ─────────────────────────────────────────
async function parseFileHandle(fileHandle, rootPath, handleKey) {
  const file = await fileHandle.getFile()
  const fullPath = `${handleKey}::${rootPath}`
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  const sizeMB = file.size / (1024 * 1024)

  if (sizeMB > MAX_FILE_SIZE_MB) {
    return {
      path: fullPath,
      filename: file.name,
      folder: rootPath.includes('/') ? rootPath.split('/').slice(0, -1).join('/') : '/',
      handleKey,
      fileHandlePath: rootPath,
      size_kb: Math.round(file.size / 1024),
      row_count: 0,
      col_count: 0,
      columns: [],
      columnNames: '',
      keywords: buildKeywords(file.name, rootPath, []),
      last_modified: new Date(file.lastModified).toISOString(),
      too_large: true,
    }
  }

  let columns = []
  let row_count = 0

  try {
    if (ext === '.csv') {
      const text = await file.text()
      const result = Papa.parse(text, { header: true, skipEmptyLines: true, preview: 200 })
      columns = extractColumns(result.data, result.meta.fields || [])
      row_count = estimateRowCount(text)
    } else {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array', sheetRows: 201, cellDates: true })
      const sheetName = wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const data = XLSX.utils.sheet_to_json(ws, { defval: null })
      columns = extractColumns(data, Object.keys(data[0] || {}))
      // Get actual row count using sheet range
      const ref = ws['!ref']
      row_count = ref ? parseInt(ref.split(':')[1].replace(/[A-Z]/g, '')) - 1 : data.length
    }
  } catch (e) {
    // File may be corrupt or locked
  }

  const folder = rootPath.includes('/') ? rootPath.split('/').slice(0, -1).join('/') : '/'

  return {
    path: fullPath,
    filename: file.name,
    folder,
    handleKey,
    fileHandlePath: rootPath,
    size_kb: Math.round(file.size / 1024),
    row_count,
    col_count: columns.length,
    columns,
    columnNames: columns.map(c => c.name).join(' '),
    keywords: buildKeywords(file.name, rootPath, columns),
    last_modified: new Date(file.lastModified).toISOString(),
  }
}

function estimateRowCount(text) {
  // Count newlines for fast row estimation
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++
  }
  return Math.max(0, count - 1) // subtract header
}

function extractColumns(rows, headers) {
  if (!rows || rows.length === 0 || !headers || headers.length === 0) return []
  return headers.map(name => {
    const vals = rows.map(r => r[name]).filter(v => v !== null && v !== undefined && v !== '')
    const sample = vals.slice(0, 3).map(v => String(v).slice(0, 50))
    const isNum  = vals.length > 0 && vals.every(v => !isNaN(Number(v)))
    return { name: String(name), type: isNum ? 'numeric' : 'text', sample, null_count: rows.length - vals.length }
  })
}

function buildKeywords(filename, path, columns) {
  const words = new Set()
  const add = str => {
    String(str).toLowerCase().split(/[\W_]+/).forEach(w => { if (w.length > 2) words.add(w) })
  }
  add(filename)
  path.split('/').forEach(add)
  columns.forEach(c => {
    add(c.name)
    c.sample?.forEach(add)
  })
  return [...words].join(' ')
}

// ── Main scan function ────────────────────────────────────
export async function scanFolder(handleKey, dirHandle, onProgress) {
  const files = []
  let count = 0
  for await (const { name, path, handle } of walkDirectory(dirHandle)) {
    try {
      const info = await parseFileHandle(handle, path, handleKey)
      await upsertFile(info)
      files.push(info)
      count++
      if (onProgress) onProgress({ file: name, count })
    } catch (e) {
      // continue on error
    }
  }
  return { count, files }
}

// ── Load a file for querying ──────────────────────────────
export async function loadFileData(fileInfo, maxRows = 500_000) {
  const handles = await getAllHandles()
  const record  = handles.find(h => h.id === fileInfo.handleKey)
  if (!record) throw new Error(`Folder handle not found for ${fileInfo.filename}. Please re-scan.`)

  const permitted = await verifyHandlePermission(record.handle)
  if (!permitted) throw new Error(`Permission denied for folder. Please re-scan.`)

  // Navigate path to find the file
  const parts = fileInfo.fileHandlePath.split('/')
  let currentHandle = record.handle
  for (let i = 0; i < parts.length - 1; i++) {
    currentHandle = await currentHandle.getDirectoryHandle(parts[i])
  }
  const fileHandle = await currentHandle.getFileHandle(parts[parts.length - 1])
  const file = await fileHandle.getFile()
  const ext  = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()

  if (ext === '.csv') {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        preview: maxRows,
        dynamicTyping: true,
        complete: result => resolve(result.data),
        error:    err => reject(err),
      })
    })
  } else {
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    return XLSX.utils.sheet_to_json(ws, { defval: null })
  }
}
