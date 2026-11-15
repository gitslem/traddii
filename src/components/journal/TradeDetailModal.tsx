import { TrendingUp, TrendingDown, X, Minus, LineChart } from 'lucide-react'
import { EXCHANGES } from '../../config/exchanges'
import type { Trade } from '../../services/firestoreService'
import {
  closeMoment, entryMoment, hasTimeOfDay, holdingMs, outcomeOf, plannedRewardRisk, rMultiple, riskAmount, tradeMarket
} from '../../services/journal/tradeMath'
import { formatDuration, formatPnL, formatPrice, formatR, formatUsd } from '../../utils/format'

interface TradeDetailModalProps {
  trade: Trade
  onClose: () => void
}

const when = (iso: string, date: Date): string =>
  hasTimeOfDay(iso)
    ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : date.toLocaleDateString(undefined, { dateStyle: 'medium' })

const TradeDetailModal = ({ trade, onClose }: TradeDetailModalProps) => {
  const outcome = outcomeOf(trade)
  const closed = trade.status === 'closed'
  const tone = outcome === 'win' ? 'profit' : outcome === 'loss' ? 'loss' : ''
  const Icon = outcome === 'win' ? TrendingUp : outcome === 'loss' ? TrendingDown : Minus
  const [base, quote] = trade.pair.split('/')
  const risk = riskAmount(trade)
  const r = rMultiple(trade)
  const rewardRisk = plannedRewardRisk(trade)
  const held = holdingMs(trade)
  const chartUrl = trade.chartUrl && /^https?:\/\//.test(trade.chartUrl) ? trade.chartUrl : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="detail-modal" role="dialog" aria-modal="true" aria-label={`${trade.pair} trade details`} onClick={e => e.stopPropagation()}>
        <div className="detail-modal-header">
          <div className="modal-header-content">
            <Icon className={`modal-icon ${tone}`} />
            <h2>Trade Details</h2>
          </div>
          <button onClick={onClose} className="close-btn" aria-label="Close">
            <X size={24} />
          </button>
        </div>

        <div className="detail-modal-body">
          <div className="detail-section">
            <div className="detail-pair">
              <span className="pair-name">{trade.pair}</span>
              <span className={`trade-type ${trade.type}`}>{trade.type.toUpperCase()}</span>
              <span className="trade-leverage">{trade.leverage}x</span>
              {trade.isPractice && <span className="trade-leverage">Practice</span>}
            </div>
          </div>

          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">Entry Price</span>
              <span className="detail-value">${formatPrice(trade.entryPrice)}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Exit Price</span>
              <span className="detail-value">{trade.exitPrice ? `$${formatPrice(trade.exitPrice)}` : 'Open'}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Position Size</span>
              <span className="detail-value">{trade.quantity} {(trade.quantityType || 'base') === 'base' ? base : quote}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Exchange</span>
              <span className="detail-value">{EXCHANGES[trade.exchange]?.displayName ?? trade.exchange} · {tradeMarket(trade)}</span>
            </div>
            {trade.stopLoss ? (
              <div className="detail-item">
                <span className="detail-label">Stop Loss</span>
                <span className="detail-value">${formatPrice(trade.stopLoss)}</span>
              </div>
            ) : null}
            {trade.takeProfit ? (
              <div className="detail-item">
                <span className="detail-label">Take Profit</span>
                <span className="detail-value">${formatPrice(trade.takeProfit)}</span>
              </div>
            ) : null}
            {risk !== null && (
              <div className="detail-item">
                <span className="detail-label">Risk (1R)</span>
                <span className="detail-value">
                  {formatUsd(risk)}{!closed && rewardRisk !== null ? ` · planned 1:${rewardRisk.toFixed(2)}` : ''}
                </span>
              </div>
            )}
            <div className="detail-item">
              <span className="detail-label">Status</span>
              <span className={`status-badge ${trade.status}`}>{trade.status}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Entered</span>
              <span className="detail-value">{when(trade.entryDate, entryMoment(trade))}</span>
            </div>
            {closed && trade.exitDate && (
              <div className="detail-item">
                <span className="detail-label">Closed</span>
                <span className="detail-value">
                  {when(trade.exitDate, closeMoment(trade))}{held !== null ? ` · held ${formatDuration(held)}` : ''}
                </span>
              </div>
            )}
          </div>

          {closed ? (
            <div className={`pnl-display ${tone}`}>
              <span>
                Net Profit/Loss
                {outcome === 'breakeven' ? ' · breakeven' : ''}
                {(trade.fees || 0) > 0 ? ` · after ${formatUsd(trade.fees)} fees` : ''}
              </span>
              <div className="pnl-amount">
                <Icon size={24} />
                <span>{formatPnL(trade.profitLoss)}{r !== null ? ` (${formatR(r)})` : ''}</span>
              </div>
            </div>
          ) : (
            <div className="pnl-display">
              <span>Still open</span>
              <div className="pnl-amount"><span>{(trade.fees || 0) > 0 ? `Entry fee ${formatUsd(trade.fees)}` : '—'}</span></div>
            </div>
          )}

          {chartUrl && (
            <a className="detail-chart-link" href={chartUrl} target="_blank" rel="noopener noreferrer">
              <LineChart size={16} />
              Open chart
            </a>
          )}

          {trade.tags?.length > 0 && (
            <div className="detail-notes">
              <h4>Tags</h4>
              <p>{trade.tags.join(', ')}</p>
            </div>
          )}

          {trade.notes && (
            <div className="detail-notes">
              <h4>Notes</h4>
              <p>{trade.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TradeDetailModal
