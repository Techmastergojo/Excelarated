/**
 * excelWriter.js — Creates beautifully formatted .xlsx files using ExcelJS in the browser.
 * Downloads the file directly to the user's Downloads folder.
 */
import ExcelJS from 'exceljs'

// Color palette
const COLORS = {
  headerBg: '1A2942',
  headerFg: '00E5A0',
  altRow:   'F0F4F8',
  white:    'FFFFFFFF',
  border:   'D1D5DB',
  accent1:  '00C48C',
  coverTitle: '1A2942',
  coverSub:   '6B7280',
}

function headerFill()  { return { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+COLORS.headerBg} } }
function altRowFill()  { return { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+COLORS.altRow} } }
function whiteFill()   { return { type:'pattern', pattern:'solid', fgColor:{argb:COLORS.white} } }
function borderStyle() {
  const s = { style:'thin', color:{argb:'FF'+COLORS.border} }
  return { top:s, left:s, bottom:s, right:s }
}
function headerFont()  { return { name:'Calibri', size:11, bold:true, color:{argb:'FF'+COLORS.headerFg} } }
function dataFont()    { return { name:'Calibri', size:10 } }
function centerAlign() { return { horizontal:'center', vertical:'middle' } }
function leftAlign()   { return { horizontal:'left',   vertical:'middle', wrapText:false } }

function writeDataFrame(ws, rows, columns) {
  if (!rows || rows.length === 0 || !columns || columns.length === 0) return

  // Header row
  const headerRow = ws.addRow(columns)
  headerRow.height = 22
  headerRow.eachCell(cell => {
    cell.font      = headerFont()
    cell.fill      = headerFill()
    cell.border    = borderStyle()
    cell.alignment = centerAlign()
  })

  // Data rows
  rows.forEach((row, ri) => {
    const values = columns.map(c => {
      const v = row[c]
      return (v === null || v === undefined) ? '' : v
    })
    const dataRow = ws.addRow(values)
    dataRow.height = 18
    const fill = ri % 2 === 0 ? whiteFill() : altRowFill()
    dataRow.eachCell(cell => {
      cell.font      = dataFont()
      cell.fill      = fill
      cell.border    = borderStyle()
      cell.alignment = leftAlign()
    })
  })

  // Freeze header row
  ws.views = [{ state:'frozen', ySplit:1, xSplit:0 }]

  // Auto-fit columns
  columns.forEach((col, ci) => {
    const colObj = ws.getColumn(ci + 1)
    const maxLen = Math.max(
      col.length,
      ...rows.slice(0, 100).map(r => String(r[col] ?? '').length).slice(0, 50)
    )
    colObj.header = col
    colObj.width  = Math.min(Math.max(maxLen + 3, 8), 50)
  })
}

export async function buildAndDownloadExcel({ rows, columns, filename = 'excelarated_output', summary, filesUsed = [] }) {
  const wb = new ExcelJS.Workbook()
  wb.creator  = 'Excelarated'
  wb.created  = new Date()

  // ── Cover sheet ──────────────────────────────────────────
  const cover = wb.addWorksheet('Summary')
  cover.views = [{ showGridLines: false }]
  cover.getColumn('A').width = 3
  cover.getColumn('B').width = 70

  cover.getRow(2).height = 36
  const titleCell = cover.getCell('B2')
  titleCell.value = 'Excelarated Report'
  titleCell.font  = { name:'Calibri', size:22, bold:true, color:{argb:'FF'+COLORS.coverTitle} }

  const tsCell = cover.getCell('B3')
  tsCell.value = `Generated: ${new Date().toLocaleString()}`
  tsCell.font  = { name:'Calibri', size:11, color:{argb:'FF'+COLORS.coverSub} }

  if (summary) {
    const sumCell = cover.getCell('B5')
    sumCell.value = summary
    sumCell.font  = { name:'Calibri', size:11, color:{argb:'FF374151'} }
    sumCell.alignment = { wrapText:true, vertical:'top' }
    cover.getRow(5).height = 60
  }

  if (filesUsed.length > 0) {
    const srcCell = cover.getCell('B7')
    srcCell.value = `Source files: ${filesUsed.join(', ')}`
    srcCell.font  = { name:'Calibri', size:10, italic:true, color:{argb:'FF'+COLORS.coverSub} }
  }

  const statsCell = cover.getCell('B9')
  statsCell.value = `Total records: ${rows.length.toLocaleString()}  |  Columns: ${columns.length}`
  statsCell.font  = { name:'Calibri', size:11, bold:true, color:{argb:'FF'+COLORS.accent1} }

  // ── Data sheet ───────────────────────────────────────────
  const dataSheet = wb.addWorksheet('Data')
  dataSheet.views = [{ showGridLines: false }]
  writeDataFrame(dataSheet, rows, columns)

  // ── Chart data + chart sheet (if numeric) ────────────────
  const numCols  = columns.filter(c => rows.slice(0,10).some(r => !isNaN(parseFloat(r[c])) && r[c] !== null))
  const textCols = columns.filter(c => !numCols.includes(c))

  if (numCols.length > 0 && textCols.length > 0 && rows.length > 0) {
    const chartSheet = wb.addWorksheet('Chart Data')
    chartSheet.views = [{ showGridLines: false }]

    const xCol = textCols[0]
    const yCol = numCols[0]

    // Build grouped data
    const grouped = {}
    rows.forEach(r => {
      const key = String(r[xCol] ?? 'Unknown').slice(0, 30)
      grouped[key] = (grouped[key] || 0) + (parseFloat(r[yCol]) || 0)
    })
    const chartData = Object.entries(grouped).sort((a,b) => b[1] - a[1]).slice(0, 30)

    chartSheet.addRow([xCol, yCol])
    chartData.forEach(([k, v]) => chartSheet.addRow([k, +v.toFixed(2)]))

    // Add chart to data sheet
    const chart = wb.model ? null : null // ExcelJS chart support is limited in browser; skip for now
  }

  // ── Download ─────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()
  const blob   = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href       = url
  a.download   = filename.endsWith('.xlsx') ? filename : filename + '.xlsx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
