import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Zap, X, TrendingUp, TrendingDown, CheckCircle, AlertCircle, Star } from 'lucide-react'
import PairSelect from '../PairSelect'
import { EXCHANGES } from '../../config/exchanges'
import type { AccountType } from '../../config/exchanges'
import { MAX_SETUP_LENGTH, MINDSETS, MISTAKES, SETUPS } from '../../config/journalTags'
import type { NewTrade, Trade } from '../../services/firestoreService'
import {
  computeTradeResult, parseTradeDate, plannedRewardRisk, riskAmount, supportedMarket,
  takerFeeRate, toLocalInput, toStoredDate, tradeMarket
} from '../../services/journal/tradeMath'
import { formatPnL, formatR, formatUsd } from '../../utils/format'
import '../TradingJournal.css'

interface TradeModalProps {
  /** The trade being edited, or null for a new one */
  trade: Trade | null
  /** 'close' opens an open trade ready for its exit price */
  intent?: 'edit' | 'close'
  onClose: () => void
  /** Saves the trade; the form stays open (with a message) if this throws */
  onSave: (data: NewTrade) => Promise<void>
}

const MARKET_LABELS: Record<AccountType, string> = { spot: 'Spot', futures: 'Futures', margin: 'Margin' }

const num = (text: string): number | null => {
  if (text.trim() === '') return null
  const n = parseFloat(text)
  return Number.isFinite(n) ? n : NaN
}

const isHttpUrl = (text: string): boolean => {
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const TradeModal = ({ trade, intent = 'edit', onClose, onSave }: TradeModalProps) => {
  const id = useId()
  const closing = intent === 'close' && trade?.status === 'open'

  // Remembered so an untouched date keeps its exact stored value (older trades have no time of day)
  const initialEntryAt = useMemo(() => toLocalInput(trade ? parseTradeDate(trade.entryDate) : new Date()), [trade])
  const initialExitAt = useMemo(
    () => (trade?.exitDate ? toLocalInput(parseTradeDate(trade.exitDate)) : closing ? toLocalInput(new Date()) : ''),
    [trade, closing]
  )

  const [form, setForm] = useState({
    pair: trade?.pair || 'BTC/USDT',
    type: (trade?.type || 'long') as 'long' | 'short',
    exchange: trade?.exchange || 'binance',
    market: (trade ? tradeMarket(trade) : 'futures') as AccountType,
    entryPrice: trade?.entryPrice.toString() || '',
    exitPrice: trade?.exitPrice?.toString() || '',
    quantity: trade?.quantity.toString() || '',
    quantityType: (trade?.quantityType || 'base') as 'base' | 'quote',
    leverage: trade?.leverage.toString() || '1',
    stopLoss: trade?.stopLoss?.toString() || '',
    takeProfit: trade?.takeProfit?.toString() || '',
    entryAt: initialEntryAt,
    exitAt: initialExitAt,
    fees: trade?.feesManual ? String(trade.fees) : '',
    notes: trade?.notes || '',
    tags: trade?.tags?.join(', ') || '',
    chartUrl: trade?.chartUrl || '',
    setup: trade?.setup || '',
    mindset: trade?.mindset || '',
    followedPlan: (trade?.followedPlan ?? null) as boolean | null,
    mistakes: trade?.mistakes ?? [] as string[],
    rating: (trade?.rating ?? null) as number | null
  })
  // A setup typed by hand (one that is not on the quick list)
  const [customSetup, setCustomSetup] = useState(trade?.setup && !SETUPS.includes(trade.setup) ? trade.setup : '')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const exitPriceRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setDirty(true)
    setError(null)
  }

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  useEffect(() => {
    if (closing) exitPriceRef.current?.focus()
  }, [closing])

  const [base, quote] = form.pair.split('/')
  const exchange = EXCHANGES[form.exchange]
  const markets = (Object.keys(MARKET_LABELS) as AccountType[]).filter(m => !exchange || exchange.accountTypes[m])
  const market = supportedMarket(form.exchange, form.market)
  const leverage = market === 'spot' ? 1 : num(form.leverage) ?? NaN

  const entryPrice = num(form.entryPrice)
  const exitPrice = num(form.exitPrice)
  const quantity = num(form.quantity)
  const stopLoss = num(form.stopLoss)
  const takeProfit = num(form.takeProfit)
  const manualFees = num(form.fees)

  const baseQty = entryPrice && quantity && entryPrice > 0 && quantity > 0
    ? (form.quantityType === 'base' ? quantity : quantity / entryPrice)
    : 0

  // Live result, shown while typing and saved with the trade
  const result = baseQty > 0 && entryPrice && leverage >= 1 && !(exitPrice !== null && !(exitPrice > 0)) && !(manualFees !== null && !(manualFees >= 0))
    ? computeTradeResult({ type: form.type, entryPrice, exitPrice, baseQty, leverage, exchange: form.exchange, market, manualFees })
    : null

  const riskShape = entryPrice && baseQty > 0
    ? {
        type: form.type, entryPrice, quantity: baseQty, quantityType: 'base' as const, stopLoss, takeProfit,
        market, leverage: Number.isFinite(leverage) ? leverage : 1, exchange: form.exchange
      }
    : null
  const risk = riskShape ? riskAmount(riskShape) : null
  const rewardRisk = riskShape ? plannedRewardRisk(riskShape) : null
  const stopOnWrongSide = !!entryPrice && !!stopLoss && stopLoss > 0 && risk === null
  const feeRatePercent = takerFeeRate(form.exchange, market) * 100

  const validate = (): string | null => {
    if (!(entryPrice !== null && entryPrice > 0)) return 'Enter an entry price above 0.'
    if (!(quantity !== null && quantity > 0)) return 'Enter a quantity above 0.'
    if (!(leverage >= 1 && leverage <= 200)) return 'Leverage must be between 1x and 200x.'
    if (exitPrice !== null && !(exitPrice > 0)) return 'Enter an exit price above 0, or leave it empty while the trade is open.'
    if (stopLoss !== null && !(stopLoss > 0)) return 'Enter a stop loss above 0, or leave it empty.'
    if (takeProfit !== null && !(takeProfit > 0)) return 'Enter a take profit above 0, or leave it empty.'
    if (manualFees !== null && !(manualFees >= 0)) return 'Fees cannot be negative. Leave the field empty to estimate them.'
    if (!form.entryAt || Number.isNaN(new Date(form.entryAt).getTime())) return 'Enter the entry date and time.'
    if (exitPrice !== null && form.exitAt && new Date(form.exitAt).getTime() < new Date(form.entryAt).getTime()) {
      return 'The exit time is before the entry time.'
    }
    if (form.chartUrl.trim() && !isHttpUrl(form.chartUrl.trim())) return 'The chart link must start with https://'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validate()
    if (problem || !result || entryPrice === null || quantity === null) {
      setError(problem ?? 'Check the prices and quantity.')
      return
    }

    // An untouched date keeps its stored value, so older day-only trades stay day-only
    const entryDate = trade && form.entryAt === initialEntryAt ? trade.entryDate : toStoredDate(new Date(form.entryAt))
    let exitDate: string | null = null
    if (exitPrice !== null) {
      if (form.exitAt) {
        exitDate = trade?.exitDate && form.exitAt === initialExitAt ? trade.exitDate : toStoredDate(new Date(form.exitAt))
      } else {
        // No time entered: a trade that was already closed keeps what it had, a new close happens now
        exitDate = trade?.status === 'closed' ? trade.exitDate ?? null : toStoredDate(new Date())
      }
    }

    const data: NewTrade = {
      pair: form.pair,
      type: form.type,
      entryPrice,
      exitPrice,
      quantity,
      quantityType: form.quantityType,
      entryDate,
      exitDate,
      stopLoss,
      takeProfit,
      leverage,
      exchange: form.exchange,
      market,
      status: result.status,
      outcome: result.outcome,
      profitLoss: result.profitLoss,
      profitLossPercent: result.profitLossPercent,
      fees: result.fees,
      feesManual: manualFees !== null,
      notes: form.notes,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      screenshots: trade?.screenshots || [],
      chartUrl: form.chartUrl.trim(),
      setup: form.setup.trim(),
      mindset: form.mindset,
      followedPlan: form.followedPlan,
      mistakes: form.mistakes,
      rating: form.rating,
      // Kept as it was on an edit; a trade typed in here is a manual one
      ...(trade ? {} : { source: 'manual' as const })
    }

    setSaving(true)
    try {
      await onSave(data)
    } catch {
      setError('Could not save the trade. Check your connection and try again.')
      setSaving(false)
    }
  }

  const title = closing ? 'Close Trade' : trade ? 'Edit Trade' : 'Log New Trade'

  return (
    // A stray click outside only closes the form while nothing has been typed
    <div className="tj-modal-overlay" onClick={() => { if (!dirty) onClose() }}>
      <div
        className="tj-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tj-modal-header">
          <div className="modal-title-group">
            <Zap size={24} />
            <h2 id={`${id}-title`}>{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="modal-close-btn" aria-label="Close">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="tj-modal-form" noValidate>
          <div className="form-section">
            <h3>Trade Details</h3>
            <div className="form-grid">
              <div className="form-group">
                <label id={`${id}-pair`}>Trading Pair</label>
                <PairSelect value={form.pair} onChange={(pair) => set('pair', pair)} allowCustom />
              </div>

              <div className="form-group">
                <label id={`${id}-direction`}>Direction</label>
                <div className="direction-toggle" role="group" aria-labelledby={`${id}-direction`}>
                  <button
                    type="button"
                    className={`direction-btn long ${form.type === 'long' ? 'active' : ''}`}
                    aria-pressed={form.type === 'long'}
                    onClick={() => set('type', 'long')}
                  >
                    <TrendingUp size={18} />
                    Long
                  </button>
                  <button
                    type="button"
                    className={`direction-btn short ${form.type === 'short' ? 'active' : ''}`}
                    aria-pressed={form.type === 'short'}
                    onClick={() => set('type', 'short')}
                  >
                    <TrendingDown size={18} />
                    Short
                  </button>
                </div>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label htmlFor={`${id}-exchange`}>Exchange</label>
                <select id={`${id}-exchange`} value={form.exchange} onChange={(e) => set('exchange', e.target.value)}>
                  {Object.values(EXCHANGES).map(ex => (
                    <option key={ex.id} value={ex.id}>{ex.displayName}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor={`${id}-market`}>Market</label>
                <select id={`${id}-market`} value={market} onChange={(e) => set('market', e.target.value as AccountType)}>
                  {markets.map(m => <option key={m} value={m}>{MARKET_LABELS[m]}</option>)}
                </select>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label htmlFor={`${id}-entry`}>Entry Price</label>
                <input
                  id={`${id}-entry`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.entryPrice}
                  onChange={(e) => set('entryPrice', e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div className="form-group">
                <label htmlFor={`${id}-exit`}>Exit Price{closing ? '' : ' (optional)'}</label>
                <input
                  id={`${id}-exit`}
                  ref={exitPriceRef}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.exitPrice}
                  onChange={(e) => {
                    // The trade closes now unless another time is entered
                    if (e.target.value && !form.exitAt) setForm(prev => ({ ...prev, exitAt: toLocalInput(new Date()) }))
                    set('exitPrice', e.target.value)
                  }}
                  placeholder="Leave empty if still open"
                />
              </div>
            </div>

            <div className="form-grid three">
              <div className="form-group">
                <label htmlFor={`${id}-qty-type`}>Quantity In</label>
                <select
                  id={`${id}-qty-type`}
                  value={form.quantityType}
                  onChange={(e) => set('quantityType', e.target.value as 'base' | 'quote')}
                >
                  <option value="base">{base}</option>
                  <option value="quote">{quote}</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor={`${id}-qty`}>Quantity</label>
                <input
                  id={`${id}-qty`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                  placeholder={`Amount in ${form.quantityType === 'base' ? base : quote}`}
                />
                {baseQty > 0 && entryPrice && (
                  <small className="conversion-hint">
                    ≈ {form.quantityType === 'base'
                      ? `${(baseQty * entryPrice).toFixed(2)} ${quote}`
                      : `${Number(baseQty.toPrecision(8))} ${base}`}
                  </small>
                )}
              </div>

              <div className="form-group">
                <label htmlFor={`${id}-leverage`}>Leverage</label>
                <input
                  id={`${id}-leverage`}
                  type="number"
                  inputMode="decimal"
                  step="1"
                  min="1"
                  max="200"
                  value={market === 'spot' ? '1' : form.leverage}
                  disabled={market === 'spot'}
                  onChange={(e) => set('leverage', e.target.value)}
                />
                {market === 'spot' && <small className="conversion-hint">Spot has no leverage</small>}
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3>Risk Management</h3>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor={`${id}-stop`}>Stop Loss</label>
                <input
                  id={`${id}-stop`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.stopLoss}
                  onChange={(e) => set('stopLoss', e.target.value)}
                  placeholder="Optional"
                />
              </div>

              <div className="form-group">
                <label htmlFor={`${id}-tp`}>Take Profit</label>
                <input
                  id={`${id}-tp`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.takeProfit}
                  onChange={(e) => set('takeProfit', e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
            {risk !== null && (
              <p className="tj-form-hint">
                Risk if the stop is hit: <strong>{formatUsd(risk)}</strong> including fees
                {rewardRisk !== null && <> · planned reward to risk <strong>1:{rewardRisk.toFixed(2)}</strong></>}
              </p>
            )}
            {stopOnWrongSide && (
              <p className="tj-form-hint warn">
                This stop is on the profit side of the entry. Enter the stop you started with
                ({form.type === 'long' ? 'below' : 'above'} entry for a {form.type}) to get R-multiples.
              </p>
            )}
          </div>

          <div className="form-section">
            <h3>Timing & Fees</h3>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor={`${id}-entry-at`}>Entry Date & Time</label>
                <input
                  id={`${id}-entry-at`}
                  type="datetime-local"
                  value={form.entryAt}
                  onChange={(e) => set('entryAt', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor={`${id}-exit-at`}>Exit Date & Time</label>
                <input
                  id={`${id}-exit-at`}
                  type="datetime-local"
                  value={exitPrice === null ? '' : form.exitAt}
                  disabled={exitPrice === null}
                  onChange={(e) => set('exitAt', e.target.value)}
                />
                {exitPrice === null && <small className="conversion-hint">Set when the trade has an exit price</small>}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor={`${id}-fees`}>Fees in {quote} (optional)</label>
              <input
                id={`${id}-fees`}
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={form.fees}
                onChange={(e) => set('fees', e.target.value)}
                placeholder={result ? `Estimated ${result.fees.toFixed(2)}` : 'Estimated from the exchange'}
              />
              <small className="conversion-hint">
                Leave empty to estimate from {exchange?.displayName ?? 'the exchange'}'s {MARKET_LABELS[market].toLowerCase()} fee
                ({Number(feeRatePercent.toFixed(4))}% each side).
              </small>
            </div>

            {result && (
              <p className={`tj-result-preview ${result.status === 'closed' ? result.outcome : ''}`} aria-live="polite">
                {result.status === 'closed' ? (
                  <>
                    Gross {formatPnL(result.grossPnL)} − fees {formatUsd(result.fees)} ={' '}
                    <strong>net {formatPnL(result.profitLoss)}</strong>
                    {risk !== null && <> ({formatR(result.profitLoss / risk)})</>}
                    {result.outcome === 'breakeven' && ' · counted as breakeven'}
                  </>
                ) : (
                  <>Open trade · position value {formatUsd(baseQty * (entryPrice ?? 0))} · entry fee about {formatUsd(result.fees)}</>
                )}
              </p>
            )}
          </div>

          <div className="form-section">
            <h3>Notes & Tags</h3>
            <div className="form-group">
              <label htmlFor={`${id}-notes`}>Trade Notes</label>
              <textarea
                id={`${id}-notes`}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={3}
                placeholder="Why you took it, market conditions, lessons learned..."
              />
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label htmlFor={`${id}-tags`}>Tags</label>
                <input
                  id={`${id}-tags`}
                  type="text"
                  value={form.tags}
                  onChange={(e) => set('tags', e.target.value)}
                  placeholder="scalp, news (comma separated)"
                />
              </div>

              <div className="form-group">
                <label htmlFor={`${id}-chart`}>Chart Link (optional)</label>
                <input
                  id={`${id}-chart`}
                  type="url"
                  inputMode="url"
                  value={form.chartUrl}
                  onChange={(e) => set('chartUrl', e.target.value)}
                  placeholder="https://www.tradingview.com/x/..."
                />
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3>Review <span className="tj-optional">optional - powers your edge report</span></h3>

            <div className="form-group">
              <span className="tj-chip-label" id={`${id}-setup`}>Setup</span>
              <div className="tj-chips" role="group" aria-labelledby={`${id}-setup`}>
                {SETUPS.map(setup => (
                  <button
                    key={setup}
                    type="button"
                    className={`tj-chip ${form.setup === setup ? 'active' : ''}`}
                    aria-pressed={form.setup === setup}
                    onClick={() => { set('setup', form.setup === setup ? '' : setup); setCustomSetup('') }}
                  >
                    {setup}
                  </button>
                ))}
                <input
                  type="text"
                  className={`tj-chip-input ${customSetup ? 'active' : ''}`}
                  aria-label="Another setup"
                  placeholder="Other…"
                  maxLength={MAX_SETUP_LENGTH}
                  value={customSetup}
                  onChange={(e) => { setCustomSetup(e.target.value); set('setup', e.target.value) }}
                />
              </div>
            </div>

            <div className="form-group">
              <span className="tj-chip-label" id={`${id}-mindset`}>How did you feel going in?</span>
              <div className="tj-chips" role="group" aria-labelledby={`${id}-mindset`}>
                {MINDSETS.map(mindset => (
                  <button
                    key={mindset}
                    type="button"
                    className={`tj-chip ${form.mindset === mindset ? 'active' : ''}`}
                    aria-pressed={form.mindset === mindset}
                    onClick={() => set('mindset', form.mindset === mindset ? '' : mindset)}
                  >
                    {mindset}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <span className="tj-chip-label" id={`${id}-plan`}>Did you follow your plan?</span>
                <div className="tj-chips" role="group" aria-labelledby={`${id}-plan`}>
                  {([[true, 'Yes'], [false, 'No']] as const).map(([value, label]) => (
                    <button
                      key={label}
                      type="button"
                      className={`tj-chip ${form.followedPlan === value ? 'active' : ''}`}
                      aria-pressed={form.followedPlan === value}
                      onClick={() => set('followedPlan', form.followedPlan === value ? null : value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <span className="tj-chip-label" id={`${id}-rating`}>How well did you execute it?</span>
                <div className="tj-stars" role="group" aria-labelledby={`${id}-rating`}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      type="button"
                      className={`tj-star ${form.rating !== null && star <= form.rating ? 'active' : ''}`}
                      aria-pressed={form.rating === star}
                      aria-label={`${star} out of 5`}
                      onClick={() => set('rating', form.rating === star ? null : star)}
                    >
                      <Star size={22} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-group">
              <span className="tj-chip-label" id={`${id}-mistakes`}>Mistakes</span>
              <div className="tj-chips" role="group" aria-labelledby={`${id}-mistakes`}>
                {MISTAKES.map(mistake => {
                  const on = form.mistakes.includes(mistake)
                  return (
                    <button
                      key={mistake}
                      type="button"
                      className={`tj-chip warn ${on ? 'active' : ''}`}
                      aria-pressed={on}
                      onClick={() => set('mistakes', on ? form.mistakes.filter(m => m !== mistake) : [...form.mistakes, mistake])}
                    >
                      {mistake}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {error && (
            <p className="tj-form-error" role="alert">
              <AlertCircle size={16} />
              {error}
            </p>
          )}

          <div className="tj-modal-footer">
            <button type="button" onClick={onClose} className="btn-cancel">
              Cancel
            </button>
            <button type="submit" className="btn-save" disabled={saving}>
              <CheckCircle size={18} />
              {saving ? 'Saving…' : closing ? 'Close Trade' : trade ? 'Update Trade' : 'Save Trade'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default TradeModal
