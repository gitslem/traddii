import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, TrendingUp, TrendingDown, Calendar, DollarSign, Target,
  Edit2, Trash2, CheckCircle, Clock, X, BarChart3, Award,
  Percent, Activity, ArrowUpRight, ArrowDownRight, Filter,
  ChevronLeft, ChevronRight, Search, LineChart
} from 'lucide-react'
import { useAuth } from '../context/auth'
import { firestoreService } from '../services/firestoreService'
import { EXCHANGES } from '../config/exchanges'
import type { Trade } from '../services/firestoreService'
import { computeAnalytics, filterByAccount } from '../services/journal/analytics'
import type { AccountMode } from '../services/journal/analytics'
import type { RuleBreak } from '../services/journal/rules'
import { entryMoment, hasTimeOfDay, outcomeOf, rMultiple, riskAmount } from '../services/journal/tradeMath'
import { formatPnL, formatPrice, formatR, formatUsd } from '../utils/format'
import TradeModal from './journal/TradeModal'
import './TradingJournal.css'

interface TradingJournalProps {
  onTradesUpdate?: (trades: Trade[]) => void
  compact?: boolean
  /** Show real trades, practice trades, or both */
  accountMode?: AccountMode
  /** Rules each trade broke, by trade id */
  ruleBreaks?: Map<string, RuleBreak[]>
}

const TradingJournal = ({ onTradesUpdate, compact = false, accountMode = 'all', ruleBreaks }: TradingJournalProps = {}) => {
  const { user, isAuthenticated, loading } = useAuth()
  const navigate = useNavigate()

  const [allTrades, setTrades] = useState<Trade[]>([])
  const trades = useMemo(() => filterByAccount(allTrades, accountMode), [allTrades, accountMode])
  const stats = useMemo(() => computeAnalytics(trades), [trades])
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null)
  const [modalIntent, setModalIntent] = useState<'edit' | 'close'>('edit')
  const [filter, setFilter] = useState<'all' | 'open' | 'closed' | 'wins' | 'losses'>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(5)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    if (loading) return

    if (!isAuthenticated) {
      navigate('/login')
      return
    }

    if (user?.uid) {
      const unsubscribe = firestoreService.subscribeToUserTrades(user.uid, (updatedTrades) => {
        setTrades(updatedTrades)
        onTradesUpdate?.(updatedTrades)
      })

      return () => unsubscribe()
    }
  }, [user, isAuthenticated, loading, navigate, onTradesUpdate])

  const handleAddTrade = () => {
    setEditingTrade(null)
    setModalIntent('edit')
    setShowAddModal(true)
  }

  const handleEditTrade = (trade: Trade) => {
    setEditingTrade(trade)
    setModalIntent('edit')
    setShowAddModal(true)
  }

  const handleDeleteTrade = async (tradeId: string) => {
    if (!user) return
    if (confirm('Are you sure you want to delete this trade? This action cannot be undone.')) {
      try {
        await firestoreService.deleteTrade(tradeId)
      } catch (error) {
        console.error('Delete error:', error)
        alert('Failed to delete trade. Please try again.')
      }
    }
  }

  // Closing opens the trade form on its exit price, so fees and the result are worked out the same way
  const handleCloseTrade = (trade: Trade) => {
    if (trade.status === 'closed') return
    setEditingTrade(trade)
    setModalIntent('close')
    setShowAddModal(true)
  }

  const filteredTrades = trades.filter(trade => {
    const matchesFilter = filter === 'all' ? true
      : filter === 'open' ? trade.status === 'open'
      : filter === 'closed' ? trade.status === 'closed'
      : filter === 'wins' ? outcomeOf(trade) === 'win'
      : filter === 'losses' ? outcomeOf(trade) === 'loss'
      : true

    const matchesSearch = searchTerm === '' ||
      trade.pair.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trade.exchange.toLowerCase().includes(searchTerm.toLowerCase())

    return matchesFilter && matchesSearch
  })

  const totalPages = Math.ceil(filteredTrades.length / itemsPerPage)
  const indexOfLastTrade = currentPage * itemsPerPage
  const indexOfFirstTrade = indexOfLastTrade - itemsPerPage
  const currentTrades = filteredTrades.slice(indexOfFirstTrade, indexOfLastTrade)

  if (loading) {
    return (
      <div className="trading-journal">
        <div className="journal-loading">
          <div className="loading-spinner"></div>
          <span>Loading your trades...</span>
        </div>
      </div>
    )
  }

  if (!isAuthenticated || !user) {
    return null
  }

  return (
    <div className={`trading-journal ${compact ? 'compact' : ''}`}>
      {/* Header Section */}
      {!compact && (
        <div className="tj-header">
          <div className="tj-header-content">
            <div className="tj-icon">
              <BarChart3 size={28} />
            </div>
            <div className="tj-title-group">
              <h2>Trading Journal</h2>
              <p>Track and analyze your trading performance</p>
            </div>
          </div>
          <button onClick={handleAddTrade} className="tj-add-btn">
            <Plus size={20} />
            <span>New Trade</span>
          </button>
        </div>
      )}

      {compact && (
        <div className="compact-header">
          <h3>Recent Trades</h3>
          <button onClick={handleAddTrade} className="add-trade-btn-compact">
            <Plus size={18} />
            <span>Add Trade</span>
          </button>
        </div>
      )}

      {/* Stats Dashboard */}
      {(
        <div className="tj-stats-dashboard">
          <div className="tj-stat-card highlight">
            <div className="stat-icon-wrap primary">
              <Activity size={22} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.totalTrades}</span>
              <span className="stat-label">Total Trades</span>
            </div>
          </div>

          <div className="tj-stat-card">
            <div className="stat-icon-wrap success">
              <Percent size={22} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.winRate.toFixed(1)}%</span>
              <span className="stat-label">Win Rate</span>
              <span className="stat-detail">
                {stats.wins}W / {stats.losses}L{stats.breakevens > 0 ? ` / ${stats.breakevens} flat` : ''}
              </span>
            </div>
          </div>

          <div className={`tj-stat-card ${stats.totalPnL >= 0 ? 'profit' : 'loss'}`}>
            <div className={`stat-icon-wrap ${stats.totalPnL >= 0 ? 'success' : 'danger'}`}>
              <DollarSign size={22} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{formatPnL(stats.totalPnL)}</span>
              <span className="stat-label">Net P&L</span>
            </div>
            <div className="stat-trend">
              {stats.totalPnL >= 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
            </div>
          </div>

          <div className="tj-stat-card">
            <div className="stat-icon-wrap warning">
              <Target size={22} />
            </div>
            <div className="stat-info">
              <span className="stat-value">
                {stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
              </span>
              <span className="stat-label">Profit Factor</span>
            </div>
          </div>

          <div className="tj-stat-card">
            <div className="stat-icon-wrap info">
              <Clock size={22} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.openTrades}</span>
              <span className="stat-label">Open Trades</span>
            </div>
          </div>

          <div className="tj-stat-card">
            <div className="stat-icon-wrap purple">
              <Award size={22} />
            </div>
            <div className="stat-info">
              <span className="stat-value stat-text">{stats.bestPair ?? 'N/A'}</span>
              <span className="stat-label">Best Pair</span>
            </div>
          </div>
        </div>
      )}

      {/* Content Section */}
      <div className="tj-content">
        <div className="tj-content-header">
          <div className="tj-search-filter">
            <div className="tj-search">
              <Search size={18} />
              <input
                type="text"
                placeholder="Search trades..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1) }}
              />
              {searchTerm && (
                <button onClick={() => { setSearchTerm(''); setCurrentPage(1) }} className="clear-search">
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="tj-filters">
              <Filter size={16} />
              {[
                { key: 'all', label: 'All', count: trades.length },
                { key: 'open', label: 'Open', count: trades.filter(t => t.status === 'open').length },
                { key: 'closed', label: 'Closed', count: trades.filter(t => t.status === 'closed').length },
                { key: 'wins', label: 'Wins', count: stats.wins },
                { key: 'losses', label: 'Losses', count: stats.losses }
              ].map(f => (
                <button
                  key={f.key}
                  className={`filter-btn ${filter === f.key ? 'active' : ''}`}
                  onClick={() => { setFilter(f.key as typeof filter); setCurrentPage(1) }}
                >
                  {f.label}
                  <span className="filter-count">{f.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredTrades.length === 0 ? (
          <div className="tj-empty-state">
            <div className="empty-icon">
              <TrendingUp size={56} />
            </div>
            <h3>{searchTerm || filter !== 'all' ? 'No trades found' : 'No trades yet'}</h3>
            <p>
              {searchTerm || filter !== 'all'
                ? 'Try adjusting your search or filter criteria'
                : 'Start tracking your trades to analyze your performance'
              }
            </p>
            {!searchTerm && filter === 'all' && (
              <button onClick={handleAddTrade} className="tj-add-btn large">
                <Plus size={20} />
                <span>Add Your First Trade</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="tj-trades-list">
              {currentTrades.map(trade => (
                <TradeCard
                  key={trade.id}
                  trade={trade}
                  breaks={ruleBreaks?.get(trade.id)}
                  onEdit={handleEditTrade}
                  onDelete={handleDeleteTrade}
                  onClose={handleCloseTrade}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="tj-pagination">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="pagination-btn"
                >
                  <ChevronLeft size={18} />
                  Previous
                </button>
                <div className="pagination-info">
                  <span>Page {currentPage} of {totalPages}</span>
                  <span className="pagination-total">({filteredTrades.length} trades)</span>
                </div>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="pagination-btn"
                >
                  Next
                  <ChevronRight size={18} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Trade Modal */}
      {showAddModal && (
        <TradeModal
          trade={editingTrade}
          intent={modalIntent}
          onClose={() => {
            setShowAddModal(false)
            setEditingTrade(null)
          }}
          onSave={async (tradeData) => {
            if (!user?.uid) return
            if (editingTrade) {
              await firestoreService.updateTrade(editingTrade.id, tradeData)
            } else {
              await firestoreService.addTrade(user.uid, tradeData)
            }
            setShowAddModal(false)
            setEditingTrade(null)
          }}
        />
      )}
    </div>
  )
}

// Trade Card Component
interface TradeCardProps {
  trade: Trade
  breaks?: RuleBreak[]
  onEdit: (trade: Trade) => void
  onDelete: (tradeId: string) => void
  onClose: (trade: Trade) => void
}

const TradeCard = ({ trade, breaks, onEdit, onDelete, onClose }: TradeCardProps) => {
  const outcome = outcomeOf(trade)
  const isOpen = trade.status === 'open'
  const [baseCurrency, quoteCurrency] = trade.pair.split('/')
  const quantityType = trade.quantityType || 'base'
  const currency = quantityType === 'base' ? baseCurrency : quoteCurrency
  const entered = entryMoment(trade)
  const pnlClass = outcome === 'win' ? 'profit' : outcome === 'loss' ? 'loss' : 'flat'
  const r = rMultiple(trade)
  const risk = riskAmount(trade)

  return (
    <div className={`tj-trade-card ${trade.status} ${outcome}`}>
      <div className="trade-card-left">
        <div className={`trade-direction ${trade.type}`}>
          {trade.type === 'long' ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
        </div>
        <div className="trade-main-info">
          <div className="trade-pair-row">
            <span className="trade-pair">{trade.pair}</span>
            <span className={`trade-type-badge ${trade.type}`}>{trade.type.toUpperCase()}</span>
            <span className="trade-leverage">{trade.leverage}x</span>
            {trade.isPractice && <span className="ji-practice-badge">Practice</span>}
          </div>
          <div className="trade-details-row">
            <span className="trade-entry">Entry: ${formatPrice(trade.entryPrice)}</span>
            <span className="trade-divider">→</span>
            <span className="trade-exit">
              {trade.exitPrice ? `Exit: $${formatPrice(trade.exitPrice)}` : 'Open'}
            </span>
            <span className="trade-qty">{trade.quantity} {currency}</span>
          </div>
        </div>
      </div>

      <div className="trade-card-right">
        {!isOpen && (
          <div className={`trade-pnl ${pnlClass}`}>
            <span className="pnl-amount">{formatPnL(trade.profitLoss)}</span>
            <span className="pnl-percent">
              {outcome === 'breakeven'
                ? 'Breakeven'
                : `${trade.profitLossPercent > 0 ? '+' : ''}${trade.profitLossPercent.toFixed(2)}%`}
            </span>
            {r !== null && (
              <span className={`trade-r ${r > 0 ? 'profit' : r < 0 ? 'loss' : ''}`} title="Result in units of the amount risked">
                {formatR(r)}
              </span>
            )}
          </div>
        )}

        {isOpen && (
          <div className="trade-status-open">
            <Clock size={16} />
            <span>Open{risk !== null ? ` · risk ${formatUsd(risk)}` : ''}</span>
          </div>
        )}

        <div className="trade-actions">
          {isOpen && (
            <button onClick={() => onClose(trade)} className="action-btn close" title="Close trade" aria-label={`Close ${trade.pair} trade`}>
              <CheckCircle size={16} />
            </button>
          )}
          <button onClick={() => onEdit(trade)} className="action-btn edit" title="Edit" aria-label={`Edit ${trade.pair} trade`}>
            <Edit2 size={16} />
          </button>
          <button onClick={() => onDelete(trade.id)} className="action-btn delete" title="Delete" aria-label={`Delete ${trade.pair} trade`}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="trade-card-footer">
        <div className="trade-meta">
          <Calendar size={14} />
          <span>
            {hasTimeOfDay(trade.entryDate)
              ? entered.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
              : entered.toLocaleDateString(undefined, { dateStyle: 'medium' })}
          </span>
        </div>
        <div className="trade-exchange">{EXCHANGES[trade.exchange]?.displayName ?? trade.exchange}</div>
        {trade.setup && <div className="trade-setup">{trade.setup}</div>}
        {breaks && breaks.length > 0 && (
          <div className="trade-rule-break" title={breaks.map(b => b.text).join(' ')}>
            Broke {breaks.length === 1 ? 'a rule' : `${breaks.length} rules`}
            <span className="ji-sr-only">: {breaks.map(b => b.text).join(' ')}</span>
          </div>
        )}
        {(trade.mistakes?.length ?? 0) > 0 && (
          <div className="trade-mistakes" title={trade.mistakes?.join(', ')}>
            {trade.mistakes?.length} mistake{trade.mistakes?.length === 1 ? '' : 's'}
          </div>
        )}
        {!isOpen && (trade.fees || 0) > 0 && <div className="trade-fees">Fees ${trade.fees.toFixed(2)}</div>}
        {trade.chartUrl && /^https?:\/\//.test(trade.chartUrl) && (
          <a className="trade-chart-link" href={trade.chartUrl} target="_blank" rel="noopener noreferrer">
            <LineChart size={14} />
            Chart
          </a>
        )}
        {trade.notes && <div className="trade-has-notes" title={trade.notes}>📝</div>}
      </div>
    </div>
  )
}

export default TradingJournal
