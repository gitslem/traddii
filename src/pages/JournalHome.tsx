import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Download, TrendingUp, TrendingDown, BookOpen,
  Calendar, DollarSign, X, Pin, List, Grid, Plus,
  Target, Activity, Flame, BarChart3,
  ArrowUpRight, ArrowDownRight, Clock, Zap,
  PieChart, Trophy, AlertCircle, Upload
} from 'lucide-react'
import { useAuth } from '../context/auth'
import { firestoreService } from '../services/firestoreService'
import type { Trade, JournalNote } from '../services/firestoreService'
import { computeAnalytics, filterByAccount } from '../services/journal/analytics'
import type { AccountMode } from '../services/journal/analytics'
import { findPracticeTrades } from '../services/journal/practiceImport'
import { entryMoment, outcomeOf } from '../services/journal/tradeMath'
import { formatDuration, formatPnL, formatPrice, formatR, formatUsd } from '../utils/format'
import TradingJournal from '../components/TradingJournal'
import TradeModal from '../components/journal/TradeModal'
import ExportModal from '../components/journal/ExportModal'
import TradeDetailModal from '../components/journal/TradeDetailModal'
import EdgeReport from '../components/journal/EdgeReport'
import RulesCard from '../components/journal/RulesCard'
import EquityCurve from '../components/journal/EquityCurve'
import PnLCalendar from '../components/journal/PnLCalendar'
import WeeklyCoach from '../components/journal/WeeklyCoach'
import { EMPTY_RULES, checkRules } from '../services/journal/rules'
import type { TradingRules } from '../services/journal/rules'
import { subscribeToRules } from '../services/journal/rulesStore'
import PersonalNotes from '../components/PersonalNotes'
import CryptoRecommendations from '../components/CryptoRecommendations'
import PageGuide from '../components/PageGuide'
import TradingBackground from '../components/TradingBackground'
import './JournalHome.css'

// Note Detail Modal
interface NoteDetailModalProps {
  note: JournalNote
  onClose: () => void
}

const NoteDetailModal = ({ note, onClose }: NoteDetailModalProps) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="detail-modal" onClick={e => e.stopPropagation()}>
        <div className="detail-modal-header">
          <div className="note-header-content">
            <BookOpen className="modal-icon" />
            <h2>{note.title}</h2>
            {note.isPinned && <Pin size={20} className="pinned-icon" />}
          </div>
          <button onClick={onClose} className="close-btn">
            <X size={24} />
          </button>
        </div>

        <div className="detail-modal-body">
          <div className="note-meta">
            <span className={`note-category ${note.category}`}>{note.category}</span>
            <span className="note-date">
              <Calendar size={16} />
              {new Date(note.createdAt).toLocaleDateString()}
            </span>
          </div>

          <div className="note-content-full">
            <p>{note.content}</p>
          </div>

          {note.relatedTrades && note.relatedTrades.length > 0 && (
            <div className="linked-trade-info">
              <small>Linked to {note.relatedTrades.length} trade(s)</small>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Main Component
const JournalHome = () => {
  const { user, isAuthenticated, loading } = useAuth()
  const navigate = useNavigate()
  const [trades, setTrades] = useState<Trade[]>([])
  const [notes, setNotes] = useState<JournalNote[]>([])
  const [showExportModal, setShowExportModal] = useState(false)
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null)
  const [selectedNote, setSelectedNote] = useState<JournalNote | null>(null)
  const [tradesView, setTradesView] = useState<'recent' | 'all'>('recent')
  const [notesView, setNotesView] = useState<'recent' | 'all'>('recent')
  const [tradesPage, setTradesPage] = useState(1)
  const [notesPage, setNotesPage] = useState(1)
  const [showLogTrade, setShowLogTrade] = useState(false)
  const [rules, setRules] = useState<TradingRules>(EMPTY_RULES)
  const [accountChoice, setAccountChoice] = useState<AccountMode | null>(null)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const itemsPerPage = 5

  // Practice trades are kept apart from real ones. Until the user chooses,
  // show real trades, or practice when that is all there is.
  const hasPractice = trades.some(t => t.isPractice)
  const hasReal = trades.some(t => !t.isPractice)
  const accountMode: AccountMode = !hasPractice ? 'all' : accountChoice ?? (hasReal ? 'real' : 'practice')
  const shownTrades = useMemo(() => filterByAccount(trades, accountMode), [trades, accountMode])
  const ruleBreaks = useMemo(() => checkRules(shownTrades, rules), [shownTrades, rules])

  useEffect(() => {
    if (!user?.uid) return
    return subscribeToRules(user.uid, setRules)
  }, [user?.uid])

  const importPractice = async () => {
    if (!user) return
    setImporting(true)
    setImportMessage(null)
    try {
      const found = await findPracticeTrades(user.uid, trades)
      if (found.trades.length > 0) await firestoreService.addTrades(user.uid, found.trades)
      const parts = [
        found.paperCount > 0 ? `${found.paperCount} paper` : '',
        found.bybitCount > 0 ? `${found.bybitCount} Bybit` : ''
      ].filter(Boolean).join(' and ')
      const text = found.trades.length > 0
        ? `Imported ${found.trades.length} practice trade${found.trades.length === 1 ? '' : 's'} (${parts}).`
        : 'No new closed Practice trades to import. Paper trades are read from this browser.'
      setImportMessage(found.bybitError
        ? { kind: 'error', text: `${text} Bybit trades could not be read: ${found.bybitError}` }
        : { kind: 'ok', text })
      if (found.trades.length > 0) setAccountChoice('practice')
    } catch (error) {
      console.error('Import error:', error)
      setImportMessage({ kind: 'error', text: 'The import failed. Check your connection and try again.' })
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => {
    if (loading) return

    if (!isAuthenticated) {
      navigate('/login')
      return
    }

    if (user?.uid) {
      const unsubscribeTrades = firestoreService.subscribeToUserTrades(user.uid, setTrades)
      const unsubscribeNotes = firestoreService.subscribeToUserNotes(user.uid, setNotes)

      return () => {
        unsubscribeTrades()
        unsubscribeNotes()
      }
    }
  }, [user, isAuthenticated, loading, navigate])

  const analytics = useMemo(() => computeAnalytics(shownTrades), [shownTrades])

  // Get recent activity
  const recentActivity = useMemo(() => {
    const allItems = [
      ...shownTrades.map(t => ({
        id: t.id,
        type: 'trade' as const,
        title: t.pair,
        subtitle: `${t.type.toUpperCase()} • ${t.status === 'closed' ? formatPnL(t.profitLoss) : 'Open'}`,
        date: entryMoment(t),
        isProfit: outcomeOf(t) !== 'loss',
        data: t
      })),
      ...notes.map(n => ({
        id: n.id,
        type: 'note' as const,
        title: n.title,
        subtitle: n.category,
        date: new Date(n.createdAt),
        isProfit: true,
        data: n
      }))
    ]

    return allItems.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 8)
  }, [shownTrades, notes])

  if (loading) {
    return (
      <div className="journal-home">
        <TradingBackground variant="home" />
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <span>Loading your journal...</span>
        </div>
      </div>
    )
  }

  if (!isAuthenticated || !user) {
    return null
  }

  // Pagination for trades
  const totalTradesPages = Math.ceil(shownTrades.length / itemsPerPage)
  const indexOfLastTrade = Math.min(tradesPage, Math.max(1, totalTradesPages)) * itemsPerPage
  const indexOfFirstTrade = indexOfLastTrade - itemsPerPage
  const currentTrades = shownTrades.slice(indexOfFirstTrade, indexOfLastTrade)

  // Pagination for notes
  const totalNotesPages = Math.ceil(notes.length / itemsPerPage)
  const indexOfLastNote = notesPage * itemsPerPage
  const indexOfFirstNote = indexOfLastNote - itemsPerPage
  const currentNotes = notes.slice(indexOfFirstNote, indexOfLastNote)

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="journal-home">
      <TradingBackground variant="home" />

      {/* Hero Section */}
      <div className="journal-hero">
        <div className="hero-icon-wrapper">
          <div className="hero-icon">
            <BookOpen size={48} />
          </div>
          <div className="hero-glow"></div>
        </div>
        <div className="hero-content">
          <h1>{getGreeting()}, {user?.displayName?.split(' ')[0] || 'Trader'}</h1>
          <p>Your trading journal dashboard - track performance, analyze patterns, grow consistently</p>
        </div>
        <div className="hero-actions">
          <PageGuide page="journal" placement="inline" />
          <button onClick={() => setShowLogTrade(true)} className="export-btn log-trade-btn">
            <Plus size={20} />
            <span>Log Trade</span>
          </button>
          <button
            onClick={() => setShowExportModal(true)}
            className="export-btn"
            disabled={trades.length === 0 && notes.length === 0}
          >
            <Download size={20} />
            <span>Export Data</span>
          </button>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <div className="quick-stats-bar">
        <div className="stat-chip">
          <Activity size={18} />
          <span>{analytics.totalTrades} Trades</span>
        </div>
        <div className="stat-chip">
          <BookOpen size={18} />
          <span>{notes.length} Notes</span>
        </div>
        <div className="stat-chip">
          <Clock size={18} />
          <span>{analytics.tradesThisWeek} This Week</span>
        </div>
        <div className={`stat-chip ${analytics.totalPnL >= 0 ? 'profit' : 'loss'}`}>
          {analytics.totalPnL >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
          <span>{formatPnL(analytics.totalPnL)} Net P/L</span>
        </div>
      </div>

      {/* Performance Dashboard */}
      <div className="performance-dashboard">
        <div className="dashboard-header">
          <h2><BarChart3 size={24} /> Performance Overview</h2>
          {hasPractice && (
            <div className="ji-account-switch" role="group" aria-label="Which trades to show">
              {([['real', 'Real'], ['practice', 'Practice'], ['all', 'All']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  className={accountMode === mode ? 'active' : ''}
                  aria-pressed={accountMode === mode}
                  onClick={() => { setAccountChoice(mode); setTradesPage(1) }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="stats-grid">
          <div className="stat-card primary">
            <div className="stat-icon">
              <Target size={24} />
            </div>
            <div className="stat-content">
              <span className="stat-value">{analytics.winRate.toFixed(1)}%</span>
              <span className="stat-label">Win Rate</span>
              <span className="stat-sub">
                {analytics.wins}W / {analytics.losses}L{analytics.breakevens > 0 ? ` / ${analytics.breakevens} flat` : ''}
              </span>
            </div>
            <div className="stat-bar">
              <div
                className="stat-bar-fill win"
                style={{ width: `${analytics.winRate}%` }}
              ></div>
            </div>
          </div>

          <div className={`stat-card ${analytics.totalPnL >= 0 ? 'profit' : 'loss'}`}>
            <div className="stat-icon">
              <DollarSign size={24} />
            </div>
            <div className="stat-content">
              <span className="stat-value">{formatPnL(analytics.totalPnL)}</span>
              <span className="stat-label">Net Profit/Loss</span>
              <span className="stat-sub">after {formatUsd(analytics.totalFees)} fees</span>
            </div>
            <div className="stat-trend">
              {analytics.totalPnL >= 0 ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <PieChart size={24} />
            </div>
            <div className="stat-content">
              <span className="stat-value">{analytics.profitFactor === Infinity ? '∞' : analytics.profitFactor.toFixed(2)}</span>
              <span className="stat-label">Profit Factor</span>
              <span className="stat-sub">gross profit ÷ gross loss</span>
            </div>
            {analytics.closedTrades > 0 && (
              <div className="stat-indicator">
                <span className={analytics.profitFactor >= 1.5 ? 'good' : analytics.profitFactor >= 1 ? 'neutral' : 'bad'}>
                  {analytics.profitFactor >= 1.5 ? 'Strong' : analytics.profitFactor >= 1 ? 'Profitable' : 'Losing'}
                </span>
              </div>
            )}
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <Flame size={24} />
            </div>
            <div className="stat-content">
              <span className="stat-value">{analytics.currentStreak}</span>
              <span className="stat-label">
                Current {analytics.currentStreakType === 'win' ? 'Win' : analytics.currentStreakType === 'loss' ? 'Loss' : ''} Streak
              </span>
            </div>
            <div className="stat-badge">
              <Trophy size={16} />
              <span>Best win run: {analytics.bestWinStreak}</span>
            </div>
          </div>
        </div>

        {/* Secondary Stats */}
        <div className="secondary-stats">
          <div className="mini-stat">
            <span className="mini-label">Avg Win</span>
            <span className="mini-value profit">{formatPnL(analytics.avgWin)}</span>
          </div>
          <div className="mini-stat">
            <span className="mini-label">Avg Loss</span>
            <span className="mini-value loss">{formatPnL(-analytics.avgLoss)}</span>
          </div>
          <div className="mini-stat">
            <span className="mini-label">Avg per Trade</span>
            <span className={`mini-value ${analytics.expectancy > 0 ? 'profit' : analytics.expectancy < 0 ? 'loss' : ''}`}>
              {formatPnL(analytics.expectancy)}
            </span>
          </div>
          <div className="mini-stat" title="Average result in units of the amount risked, for trades with a stop loss">
            <span className="mini-label">Avg R</span>
            <span className={`mini-value ${(analytics.avgR ?? 0) > 0 ? 'profit' : (analytics.avgR ?? 0) < 0 ? 'loss' : ''}`}>
              {analytics.avgR === null ? '—' : formatR(analytics.avgR)}
            </span>
          </div>
          <div className="mini-stat" title="Largest fall from a peak in your cumulative result">
            <span className="mini-label">Max Drawdown</span>
            <span className="mini-value">{formatUsd(analytics.maxDrawdown)}</span>
          </div>
          <div className="mini-stat">
            <span className="mini-label">Avg Hold</span>
            <span className="mini-value">{analytics.avgHoldMs === null ? '—' : formatDuration(analytics.avgHoldMs)}</span>
          </div>
          <div className="mini-stat">
            <span className="mini-label">Open Trades</span>
            <span className="mini-value">{analytics.openTrades}</span>
          </div>
          <div className="mini-stat">
            <span className="mini-label">Closed Trades</span>
            <span className="mini-value">{analytics.closedTrades}</span>
          </div>
          <div className="mini-stat">
            <span className="mini-label">This Month</span>
            <span className="mini-value">{analytics.tradesThisMonth}</span>
          </div>
        </div>
      </div>

      <div className="ji-charts">
        <EquityCurve trades={shownTrades} />
        <PnLCalendar trades={shownTrades} />
      </div>

      <EdgeReport trades={shownTrades} />

      <RulesCard userId={user.uid} rules={rules} trades={shownTrades} breaks={ruleBreaks} />

      <WeeklyCoach userId={user.uid} trades={shownTrades} rules={rules} />

      {/* Crypto Recommendations */}
      <CryptoRecommendations />

      {/* Recent Activity */}
      <div className="activity-section">
        <div className="section-header">
          <div className="section-title">
            <Zap size={24} className="section-icon" />
            <h2>Recent Activity</h2>
          </div>
        </div>

        {recentActivity.length > 0 ? (
          <div className="activity-timeline">
            {recentActivity.map((item) => (
              <div
                key={`${item.type}-${item.id}`}
                className={`activity-item ${item.type}`}
                onClick={() => {
                  if (item.type === 'trade') {
                    setSelectedTrade(item.data as Trade)
                  } else {
                    setSelectedNote(item.data as JournalNote)
                  }
                }}
              >
                <div className="activity-icon">
                  {item.type === 'trade' ? (
                    item.isProfit ? <TrendingUp size={18} /> : <TrendingDown size={18} />
                  ) : (
                    <BookOpen size={18} />
                  )}
                </div>
                <div className="activity-content">
                  <span className="activity-title">{item.title}</span>
                  <span className="activity-subtitle">{item.subtitle}</span>
                </div>
                <div className="activity-time">
                  {item.date.toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-activity">
            <AlertCircle size={24} />
            <p>No recent activity. Start tracking your trades!</p>
          </div>
        )}
      </div>

      <div className={`journal-content-grid ${tradesView === 'all' || notesView === 'all' ? 'expanded' : ''}`}>
        {/* Trades Section */}
        <div className="journal-section">
          <div className="section-header">
            <div className="section-title">
              <TrendingUp size={24} className="section-icon" />
              <h2>Trades</h2>
            </div>
            <div className="section-actions">
              <button
                className="add-item-btn"
                onClick={() => setTradesView('all')}
                title="View all trades"
              >
                <Plus size={18} />
                <span>Manage Trades</span>
              </button>
              <button
                className="add-item-btn"
                onClick={importPractice}
                disabled={importing}
                title="Bring in closed trades from the Practice page"
              >
                <Upload size={18} />
                <span>{importing ? 'Importing…' : 'Import from Practice'}</span>
              </button>
              <div className="view-toggle">
                <button
                  className={`toggle-btn ${tradesView === 'recent' ? 'active' : ''}`}
                  onClick={() => setTradesView('recent')}
                  title="Recent view"
                >
                  <Grid size={16} />
                </button>
                <button
                  className={`toggle-btn ${tradesView === 'all' ? 'active' : ''}`}
                  onClick={() => setTradesView('all')}
                  title="All trades"
                >
                  <List size={16} />
                </button>
              </div>
              <span className="section-count">{shownTrades.length} {accountMode === 'all' ? 'total' : accountMode}</span>
            </div>
          </div>

          {importMessage && (
            <p className={`export-message ${importMessage.kind} ji-import-message`} role={importMessage.kind === 'error' ? 'alert' : 'status'}>
              {importMessage.text}
            </p>
          )}

          {tradesView === 'recent' ? (
            <>
              {currentTrades.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <TrendingUp size={48} />
                  </div>
                  <h3>No trades yet</h3>
                  <p>Start tracking your trading performance!</p>
                  <button className="empty-action" onClick={() => setTradesView('all')}>
                    <Plus size={18} />
                    <span>Add Your First Trade</span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="cards-grid">
                    {currentTrades.map(trade => (
                    <div
                      key={trade.id}
                      className={`journal-card trade-card ${trade.status}`}
                      onClick={() => setSelectedTrade(trade)}
                    >
                      <div className="card-header">
                        <span className="card-title">{trade.pair}</span>
                        {trade.isPractice && <span className="ji-practice-badge">Practice</span>}
                        <span className={`card-badge ${trade.type}`}>{trade.type}</span>
                      </div>
                      <div className="card-body">
                        <div className="card-info">
                          <DollarSign size={16} />
                          <span>${formatPrice(trade.entryPrice)}</span>
                        </div>
                        {trade.status === 'closed' ? (
                          <div className={`card-pnl ${outcomeOf(trade) === 'loss' ? 'loss' : outcomeOf(trade) === 'win' ? 'profit' : ''}`}>
                            {outcomeOf(trade) === 'loss' ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
                            <span>{formatPnL(trade.profitLoss)}</span>
                          </div>
                        ) : (
                          <div className="card-pnl"><Clock size={16} /><span>Open</span></div>
                        )}
                      </div>
                      <div className="card-footer">
                        <Calendar size={14} />
                        <span>{entryMoment(trade).toLocaleDateString()}</span>
                        <span className="card-leverage">{trade.leverage}x</span>
                      </div>
                    </div>
                  ))}
                  </div>

                  {totalTradesPages > 1 && (
                    <div className="pagination">
                      <button
                        onClick={() => setTradesPage(prev => Math.max(prev - 1, 1))}
                        disabled={tradesPage === 1}
                        className="pagination-btn"
                      >
                        ← Previous
                      </button>
                      <span className="pagination-info">
                        Page {tradesPage} of {totalTradesPages}
                      </span>
                      <button
                        onClick={() => setTradesPage(prev => Math.min(prev + 1, totalTradesPages))}
                        disabled={tradesPage === totalTradesPages}
                        className="pagination-btn"
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="full-component-view">
              <TradingJournal onTradesUpdate={setTrades} compact={false} accountMode={accountMode} ruleBreaks={ruleBreaks} />
            </div>
          )}
        </div>

        {/* Notes Section */}
        <div className="journal-section">
          <div className="section-header">
            <div className="section-title">
              <BookOpen size={24} className="section-icon" />
              <h2>Notes</h2>
            </div>
            <div className="section-actions">
              <button
                className="add-item-btn"
                onClick={() => setNotesView('all')}
                title="View all notes"
              >
                <Plus size={18} />
                <span>Manage Notes</span>
              </button>
              <div className="view-toggle">
                <button
                  className={`toggle-btn ${notesView === 'recent' ? 'active' : ''}`}
                  onClick={() => setNotesView('recent')}
                  title="Recent view"
                >
                  <Grid size={16} />
                </button>
                <button
                  className={`toggle-btn ${notesView === 'all' ? 'active' : ''}`}
                  onClick={() => setNotesView('all')}
                  title="All notes"
                >
                  <List size={16} />
                </button>
              </div>
              <span className="section-count">{notes.length} total</span>
            </div>
          </div>

          {notesView === 'recent' ? (
            <>
              {currentNotes.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <BookOpen size={48} />
                  </div>
                  <h3>No notes yet</h3>
                  <p>Document your strategies and insights!</p>
                  <button className="empty-action" onClick={() => setNotesView('all')}>
                    <Plus size={18} />
                    <span>Create Your First Note</span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="cards-grid">
                    {currentNotes.map(note => (
                    <div
                      key={note.id}
                      className="journal-card note-card"
                      onClick={() => setSelectedNote(note)}
                    >
                      <div className="card-header">
                        <span className="card-title">{note.title}</span>
                        {note.isPinned && <Pin size={16} className="pinned-badge" />}
                      </div>
                      <div className="card-body">
                        <span className={`note-category-badge ${note.category}`}>
                          {note.category}
                        </span>
                        <p className="note-preview">{note.content.substring(0, 100)}...</p>
                      </div>
                      <div className="card-footer">
                        <Calendar size={14} />
                        <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                  </div>

                  {totalNotesPages > 1 && (
                    <div className="pagination">
                      <button
                        onClick={() => setNotesPage(prev => Math.max(prev - 1, 1))}
                        disabled={notesPage === 1}
                        className="pagination-btn"
                      >
                        ← Previous
                      </button>
                      <span className="pagination-info">
                        Page {notesPage} of {totalNotesPages}
                      </span>
                      <button
                        onClick={() => setNotesPage(prev => Math.min(prev + 1, totalNotesPages))}
                        disabled={notesPage === totalNotesPages}
                        className="pagination-btn"
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="full-component-view">
              <PersonalNotes trades={trades} compact={false} />
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showExportModal && (
        <ExportModal
          trades={trades}
          notes={notes}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {showLogTrade && user && (
        <TradeModal
          trade={null}
          onClose={() => setShowLogTrade(false)}
          onSave={async (tradeData) => {
            await firestoreService.addTrade(user.uid, tradeData)
            setShowLogTrade(false)
          }}
        />
      )}

      {selectedTrade && (
        <TradeDetailModal
          trade={selectedTrade}
          onClose={() => setSelectedTrade(null)}
        />
      )}

      {selectedNote && (
        <NoteDetailModal
          note={selectedNote}
          onClose={() => setSelectedNote(null)}
        />
      )}
    </div>
  )
}

export default JournalHome
