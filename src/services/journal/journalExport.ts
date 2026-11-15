/**
 * Journal exports: CSV, JSON, plain text and a printable report that the
 * browser can save as a PDF.
 */
import type { Trade, JournalNote } from '../firestoreService'
import { computeAnalytics } from './analytics'
import { closeMoment, entryMoment, hasTimeOfDay, localDayKey, outcomeOf, rMultiple, tradeMarket } from './tradeMath'
import { formatPnL, formatPrice, formatR, formatUsd } from '../../utils/format'

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Spreadsheets run cells that start with = + - @ as formulas; neutralise free text
const safeText = (text: string): string => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text)

const csvRow = (cells: unknown[]): string => cells.map(csvCell).join(',')

/** Full timestamp, or just the day for trades saved without a time */
const csvDate = (iso: string | null | undefined): string =>
  !iso ? '' : hasTimeOfDay(iso) ? iso : iso.slice(0, 10)

const round = (n: number, digits: number) => Number(n.toFixed(digits))

export const tradesToCSV = (trades: Trade[]): string => {
  const header = [
    'Entry Date', 'Exit Date', 'Pair', 'Type', 'Market', 'Exchange', 'Entry Price', 'Exit Price',
    'Stop Loss', 'Take Profit', 'Quantity', 'Quantity Type', 'Leverage', 'Net P&L', 'P&L %', 'Fees',
    'R Multiple', 'Status', 'Outcome', 'Account', 'Setup', 'Mindset', 'Followed Plan', 'Mistakes', 'Rating',
    'Notes', 'Tags', 'Chart'
  ]
  const rows = trades.map(t => {
    const r = rMultiple(t)
    return csvRow([
      csvDate(t.entryDate), csvDate(t.exitDate), t.pair, t.type, tradeMarket(t), t.exchange, t.entryPrice, t.exitPrice ?? '',
      t.stopLoss ?? '', t.takeProfit ?? '', t.quantity, t.quantityType || 'base', t.leverage,
      round(t.profitLoss, 2), round(t.profitLossPercent, 2), round(t.fees || 0, 2),
      r === null ? '' : round(r, 2), t.status, outcomeOf(t), t.isPractice ? 'practice' : 'real',
      safeText(t.setup || ''), t.mindset || '', t.followedPlan == null ? '' : t.followedPlan ? 'yes' : 'no',
      (t.mistakes || []).join(', '), t.rating ?? '',
      safeText(t.notes || ''), safeText((t.tags || []).join(', ')), t.chartUrl ?? ''
    ])
  })
  return [csvRow(header), ...rows].join('\n')
}

export const notesToCSV = (notes: JournalNote[]): string => {
  const header = ['Date Created', 'Last Updated', 'Title', 'Category', 'Content', 'Tags', 'Pinned']
  const rows = notes.map(n => csvRow([
    n.createdAt, n.updatedAt, safeText(n.title), n.category, safeText(n.content), safeText((n.tags || []).join(', ')), n.isPinned
  ]))
  return [csvRow(header), ...rows].join('\n')
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export const journalToJSON = (trades: Trade[], notes: JournalNote[]): string =>
  JSON.stringify({
    exportDate: new Date().toISOString(),
    trades,
    notes,
    summary: {
      totalTrades: trades.length,
      totalNotes: notes.length,
      stats: computeAnalytics(trades)
    }
  }, null, 2)

// ---------------------------------------------------------------------------
// Shared text helpers
// ---------------------------------------------------------------------------

const dateText = (trade: Pick<Trade, 'entryDate'>): string =>
  hasTimeOfDay(trade.entryDate) ? entryMoment(trade).toLocaleString() : entryMoment(trade).toLocaleDateString()

const profitFactorText = (pf: number): string => (pf === Infinity ? '∞' : pf.toFixed(2))

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

export const journalToText = (trades: Trade[], notes: JournalNote[]): string => {
  let text = '===== TRADING JOURNAL EXPORT =====\n\n'
  text += `Exported: ${new Date().toLocaleString()}\n\n`

  if (trades.length > 0) {
    text += '===== TRADES =====\n\n'
    trades.forEach((trade, index) => {
      const r = rMultiple(trade)
      text += `Trade #${index + 1}${trade.isPractice ? ' (practice)' : ''}\n`
      text += `Pair: ${trade.pair}\n`
      text += `Type: ${trade.type.toUpperCase()} ${tradeMarket(trade)} on ${trade.exchange}\n`
      text += `Entry: $${formatPrice(trade.entryPrice)}\n`
      text += `Exit: ${trade.exitPrice ? '$' + formatPrice(trade.exitPrice) : 'Still open'}\n`
      if (trade.stopLoss) text += `Stop loss: $${formatPrice(trade.stopLoss)}\n`
      if (trade.takeProfit) text += `Take profit: $${formatPrice(trade.takeProfit)}\n`
      text += `Quantity: ${trade.quantity} (${trade.quantityType || 'base'})\n`
      text += `Leverage: ${trade.leverage}x\n`
      if (trade.status === 'closed') {
        text += `Net P/L: ${formatPnL(trade.profitLoss)} after ${formatUsd(trade.fees || 0)} fees${r === null ? '' : ` (${formatR(r)})`}\n`
      }
      text += `Status: ${trade.status}\n`
      text += `Date: ${dateText(trade)}\n`
      if (trade.setup) text += `Setup: ${trade.setup}\n`
      if (trade.mindset) text += `Mindset: ${trade.mindset}\n`
      if (trade.followedPlan != null) text += `Followed plan: ${trade.followedPlan ? 'yes' : 'no'}\n`
      if (trade.mistakes?.length) text += `Mistakes: ${trade.mistakes.join(', ')}\n`
      if (trade.rating) text += `Execution: ${trade.rating}/5\n`
      if (trade.tags?.length) text += `Tags: ${trade.tags.join(', ')}\n`
      if (trade.chartUrl) text += `Chart: ${trade.chartUrl}\n`
      if (trade.notes) text += `Notes: ${trade.notes}\n`
      text += '\n---\n\n'
    })
  }

  if (notes.length > 0) {
    text += '===== NOTES =====\n\n'
    notes.forEach((note, index) => {
      text += `Note #${index + 1}\n`
      text += `Title: ${note.title}\n`
      text += `Category: ${note.category}\n`
      text += `Content:\n${note.content}\n`
      text += `Created: ${new Date(note.createdAt).toLocaleString()}\n`
      if (note.isPinned) text += '[PINNED]\n'
      text += '\n---\n\n'
    })
  }

  return text
}

// ---------------------------------------------------------------------------
// Printable report (the browser's print dialog saves it as a PDF)
// ---------------------------------------------------------------------------

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, ch => ESCAPES[ch])

const pnlClass = (value: number): string => (value > 0.004 ? 'pos' : value < -0.004 ? 'neg' : '')

/** A complete HTML document for the report. All journal content is escaped. */
export const journalReportHtml = (trades: Trade[], notes: JournalNote[]): string => {
  const stats = computeAnalytics(trades)
  const ordered = [...trades].sort((a, b) => closeMoment(b).getTime() - closeMoment(a).getTime())
  const title = `Traddii journal - ${localDayKey(new Date())}`

  const statCards = trades.length === 0 ? '' : `
    <div class="stats">
      <div class="stat"><span>Closed trades</span><b>${stats.closedTrades}</b></div>
      <div class="stat"><span>Win rate</span><b>${stats.winRate.toFixed(1)}%</b><small>${stats.wins}W / ${stats.losses}L${stats.breakevens ? ` / ${stats.breakevens} flat` : ''}</small></div>
      <div class="stat"><span>Net P/L</span><b class="${pnlClass(stats.totalPnL)}">${esc(formatPnL(stats.totalPnL))}</b><small>after ${esc(formatUsd(stats.totalFees))} fees</small></div>
      <div class="stat"><span>Profit factor</span><b>${esc(profitFactorText(stats.profitFactor))}</b></div>
      <div class="stat"><span>Average win</span><b>${esc(formatPnL(stats.avgWin))}</b></div>
      <div class="stat"><span>Average loss</span><b>${esc(formatPnL(-stats.avgLoss))}</b></div>
      <div class="stat"><span>Average R</span><b>${stats.avgR === null ? '—' : esc(formatR(stats.avgR))}</b></div>
      <div class="stat"><span>Max drawdown</span><b>${esc(formatUsd(stats.maxDrawdown))}</b></div>
    </div>`

  const tradeRows = ordered.map(t => {
    const r = rMultiple(t)
    const closed = t.status === 'closed'
    return `<tr>
      <td>${esc(dateText(t))}</td>
      <td>${esc(t.pair)}${t.isPractice ? ' <em>(practice)</em>' : ''}</td>
      <td>${esc(t.type)} ${esc(t.leverage)}x</td>
      <td class="num">${esc(formatPrice(t.entryPrice))}</td>
      <td class="num">${t.exitPrice ? esc(formatPrice(t.exitPrice)) : 'open'}</td>
      <td class="num">${esc(t.quantity)}</td>
      <td class="num ${closed ? pnlClass(t.profitLoss) : ''}">${closed ? esc(formatPnL(t.profitLoss)) : '—'}</td>
      <td class="num">${r === null ? '—' : esc(formatR(r))}</td>
      <td>${esc(t.setup || '')}</td>
      <td>${esc(t.notes || '')}</td>
    </tr>`
  }).join('')

  const tradeTable = trades.length === 0 ? '' : `
    <h2>Trades (${trades.length})</h2>
    <table>
      <thead><tr>
        <th>Date</th><th>Pair</th><th>Side</th><th class="num">Entry</th><th class="num">Exit</th>
        <th class="num">Qty</th><th class="num">Net P/L</th><th class="num">R</th><th>Setup</th><th>Notes</th>
      </tr></thead>
      <tbody>${tradeRows}</tbody>
    </table>`

  const noteBlocks = notes.length === 0 ? '' : `
    <h2>Notes (${notes.length})</h2>
    ${notes.map(n => `<div class="note">
      <h3>${esc(n.title)}${n.isPinned ? ' (pinned)' : ''}</h3>
      <small>${esc(n.category)} · ${esc(new Date(n.createdAt).toLocaleDateString())}</small>
      <p>${esc(n.content)}</p>
    </div>`).join('')}`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  @page { margin: 14mm; }
  body { font: 12px/1.45 -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111; background: #fff; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #999; }
  .meta { color: #555; margin: 0 0 14px; }
  .hint { background: #f3f0ff; border: 1px solid #c4b5fd; border-radius: 6px; padding: 8px 10px; margin-bottom: 14px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .stat { border: 1px solid #ccc; border-radius: 6px; padding: 8px; }
  .stat span { color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  .stat b { display: block; font-size: 15px; }
  .stat small { color: #555; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { border-bottom: 1px solid #666; }
  tr { break-inside: avoid; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pos { color: #047857; }
  .neg { color: #b91c1c; }
  .note { break-inside: avoid; margin-bottom: 12px; }
  .note h3 { font-size: 12px; margin: 0; }
  .note small { color: #555; }
  .note p { margin: 4px 0 0; white-space: pre-wrap; }
  @media (max-width: 600px) { .stats { grid-template-columns: repeat(2, 1fr); } }
  @media print { .hint { display: none; } body { margin: 0; } }
</style>
</head>
<body>
  <p class="hint">To save this as a PDF, choose <strong>Save as PDF</strong> in the print dialog. If the dialog did not open, use your browser's Print command.</p>
  <h1>Trading journal</h1>
  <p class="meta">Exported ${esc(new Date().toLocaleString())} · Educational record, not financial advice</p>
  ${statCards}
  ${tradeTable}
  ${noteBlocks}
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print() }, 200) })</script>
</body>
</html>`
}

/**
 * Open the report in a new tab and bring up the print dialog, where the
 * browser offers "Save as PDF". Returns false if the tab was blocked.
 */
export const printJournalReport = (trades: Trade[], notes: JournalNote[]): boolean => {
  const url = URL.createObjectURL(new Blob([journalReportHtml(trades, notes)], { type: 'text/html' }))
  const opened = window.open(url, '_blank')
  // The tab keeps its own copy once loaded
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return opened !== null
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export const downloadFile = (content: string, filename: string, mimeType: string): void => {
  // The byte-order mark makes Excel read CSV files as UTF-8
  const body = mimeType === 'text/csv' ? '﻿' + content : content
  const url = URL.createObjectURL(new Blob([body], { type: `${mimeType};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
