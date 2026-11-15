import { useState } from 'react'
import { Download, TrendingUp, BookOpen, X, FileText, FileJson, FileSpreadsheet, File, Target, BarChart3 } from 'lucide-react'
import type { Trade, JournalNote } from '../../services/firestoreService'
import {
  downloadFile, journalToJSON, journalToText, notesToCSV, printJournalReport, tradesToCSV
} from '../../services/journal/journalExport'
import { localDayKey } from '../../services/journal/tradeMath'
import { formatPnL } from '../../utils/format'

interface ExportModalProps {
  trades: Trade[]
  notes: JournalNote[]
  onClose: () => void
}

type ExportFormat = 'json' | 'csv' | 'pdf' | 'txt'

const ExportModal = ({ trades, notes, onClose }: ExportModalProps) => {
  const [exportType, setExportType] = useState<'all' | 'trades' | 'notes'>('all')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json')
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [showItemSelection, setShowItemSelection] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // What the current choices will export
  const outTrades = showItemSelection
    ? trades.filter(t => selectedItems.has(t.id))
    : exportType === 'notes' ? [] : trades
  const outNotes = showItemSelection
    ? notes.filter(n => selectedItems.has(n.id))
    : exportType === 'trades' ? [] : notes
  const nothingToExport = outTrades.length === 0 && outNotes.length === 0
  // A CSV file holds one table, so trades win when both are chosen
  const csvDropsNotes = exportFormat === 'csv' && outTrades.length > 0 && outNotes.length > 0

  const handleExport = () => {
    const stamp = localDayKey(new Date())
    const name = showItemSelection ? 'selected-items' : exportType === 'all' ? 'complete-journal' : exportType
    try {
      if (exportFormat === 'json') {
        const content = outNotes.length === 0 ? JSON.stringify(outTrades, null, 2)
          : outTrades.length === 0 ? JSON.stringify(outNotes, null, 2)
          : journalToJSON(outTrades, outNotes)
        downloadFile(content, `${name}-${stamp}.json`, 'application/json')
      } else if (exportFormat === 'csv') {
        if (outTrades.length > 0) downloadFile(tradesToCSV(outTrades), `trades-${stamp}.csv`, 'text/csv')
        else downloadFile(notesToCSV(outNotes), `notes-${stamp}.csv`, 'text/csv')
      } else if (exportFormat === 'txt') {
        downloadFile(journalToText(outTrades, outNotes), `${name}-${stamp}.txt`, 'text/plain')
      } else if (!printJournalReport(outTrades, outNotes)) {
        setMessage({ kind: 'error', text: 'Your browser blocked the report tab. Allow pop-ups for this site and try again.' })
        return
      }
      setMessage({
        kind: 'ok',
        text: exportFormat === 'pdf'
          ? 'The report opened in a new tab. Choose "Save as PDF" in the print dialog.'
          : 'Export downloaded.'
      })
    } catch (error) {
      console.error('Export error:', error)
      setMessage({ kind: 'error', text: 'The export failed. Please try again.' })
    }
  }

  const toggleItemSelection = (id: string) => {
    const next = new Set(selectedItems)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedItems(next)
  }

  const formats: { key: ExportFormat; label: string; icon: typeof File }[] = [
    { key: 'json', label: 'JSON', icon: FileJson },
    { key: 'csv', label: 'CSV', icon: FileSpreadsheet },
    { key: 'txt', label: 'Text', icon: FileText },
    { key: 'pdf', label: 'PDF', icon: File }
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="export-modal" role="dialog" aria-modal="true" aria-label="Export journal data" onClick={e => e.stopPropagation()}>
        <div className="export-modal-header">
          <div className="modal-header-content">
            <Download className="modal-icon" />
            <h2>Export Journal Data</h2>
          </div>
          <button onClick={onClose} className="close-btn" aria-label="Close">
            <X size={24} />
          </button>
        </div>

        <div className="export-modal-body">
          <div className="export-section">
            <h3>What to Export</h3>
            <div className="export-type-buttons">
              <button
                className={`export-type-btn ${exportType === 'all' && !showItemSelection ? 'active' : ''}`}
                onClick={() => { setExportType('all'); setShowItemSelection(false); setMessage(null) }}
              >
                <BarChart3 size={20} />
                <span>All Data</span>
                <small>{trades.length} trades + {notes.length} notes</small>
              </button>
              <button
                className={`export-type-btn ${exportType === 'trades' && !showItemSelection ? 'active' : ''}`}
                onClick={() => { setExportType('trades'); setShowItemSelection(false); setMessage(null) }}
              >
                <TrendingUp size={20} />
                <span>All Trades</span>
                <small>{trades.length} trades</small>
              </button>
              <button
                className={`export-type-btn ${exportType === 'notes' && !showItemSelection ? 'active' : ''}`}
                onClick={() => { setExportType('notes'); setShowItemSelection(false); setMessage(null) }}
              >
                <BookOpen size={20} />
                <span>All Notes</span>
                <small>{notes.length} notes</small>
              </button>
              <button
                className={`export-type-btn ${showItemSelection ? 'active' : ''}`}
                onClick={() => { setShowItemSelection(!showItemSelection); setMessage(null) }}
              >
                <Target size={20} />
                <span>Select Items</span>
                <small>Custom selection</small>
              </button>
            </div>
          </div>

          {showItemSelection && (
            <div className="export-section">
              <h3>Select Items <span className="selection-count">{selectedItems.size} selected</span></h3>
              <div className="item-selection-list">
                {trades.length > 0 && (
                  <div className="item-group">
                    <h4><TrendingUp size={16} /> Trades</h4>
                    {trades.map(trade => (
                      <label key={trade.id} className={`item-checkbox ${selectedItems.has(trade.id) ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedItems.has(trade.id)}
                          onChange={() => toggleItemSelection(trade.id)}
                        />
                        <span className="checkbox-custom"></span>
                        <span className="item-info">
                          <span className="item-title">{trade.pair}</span>
                          <span className={`item-badge ${trade.type}`}>{trade.type}</span>
                          <span className={`item-pnl ${trade.profitLoss >= 0 ? 'profit' : 'loss'}`}>
                            {trade.status === 'closed' ? formatPnL(trade.profitLoss) : 'Open'}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {notes.length > 0 && (
                  <div className="item-group">
                    <h4><BookOpen size={16} /> Notes</h4>
                    {notes.map(note => (
                      <label key={note.id} className={`item-checkbox ${selectedItems.has(note.id) ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedItems.has(note.id)}
                          onChange={() => toggleItemSelection(note.id)}
                        />
                        <span className="checkbox-custom"></span>
                        <span className="item-info">
                          <span className="item-title">{note.title}</span>
                          <span className={`item-category ${note.category}`}>{note.category}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="export-section">
            <h3>Export Format</h3>
            <div className="export-format-buttons">
              {formats.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  className={`format-btn ${exportFormat === key ? 'active' : ''}`}
                  aria-pressed={exportFormat === key}
                  onClick={() => { setExportFormat(key); setMessage(null) }}
                >
                  <Icon size={24} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            {exportFormat === 'pdf' && (
              <p className="export-hint">Opens a printable report in a new tab. Choose "Save as PDF" in the print dialog.</p>
            )}
            {csvDropsNotes && (
              <p className="export-hint">A CSV file holds one table, so this exports the trades. Choose All Notes for a notes CSV.</p>
            )}
          </div>

          {message && (
            <p className={`export-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
              {message.text}
            </p>
          )}
        </div>

        <div className="export-modal-footer">
          <button onClick={onClose} className="btn-secondary">{message?.kind === 'ok' ? 'Done' : 'Cancel'}</button>
          <button onClick={handleExport} className="btn-primary" disabled={nothingToExport}>
            <Download size={18} />
            <span>Export Now</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default ExportModal
