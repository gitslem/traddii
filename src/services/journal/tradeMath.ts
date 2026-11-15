/**
 * Trade maths for the Journal: quantity, fees, net result, risk, R-multiples
 * and dates. Pure functions, no I/O.
 */
import { EXCHANGES, getExchangeFees } from '../../config/exchanges'
import type { AccountType } from '../../config/exchanges'
import type { Trade, TradeOutcome } from '../firestoreService'

type Sized = Pick<Trade, 'quantity' | 'quantityType' | 'entryPrice'>

/** Position size in the base coin (e.g. ETH for ETH/USDT) */
export const baseQuantity = (t: Sized): number =>
  t.quantityType === 'quote' ? (t.entryPrice > 0 ? t.quantity / t.entryPrice : 0) : t.quantity

const MARKET_FALLBACK: AccountType[] = ['futures', 'margin', 'spot']

/** A market the exchange actually offers, falling back from the one asked for */
export const supportedMarket = (exchange: string, wanted: AccountType): AccountType => {
  const types = EXCHANGES[exchange]?.accountTypes
  if (!types || types[wanted]) return wanted
  return MARKET_FALLBACK.find(m => types[m]) ?? 'spot'
}

/** Market a trade was taken on. Older trades don't store it: leverage above 1x means futures. */
export const tradeMarket = (t: Pick<Trade, 'market' | 'leverage' | 'exchange'>): AccountType =>
  supportedMarket(t.exchange, t.market ?? (t.leverage > 1 ? 'futures' : 'spot'))

/** Taker fee as a fraction (0.00055 = 0.055%). Estimates assume taker on both sides. */
export const takerFeeRate = (exchange: string, market: AccountType): number =>
  getExchangeFees(exchange, market).taker / 100

/** Below half a cent a result rounds to $0.00 */
const ZERO_RESULT = 0.005

/** A trade that came out flat (exit at entry, or a net result of $0.00) is neither a win nor a loss */
export const classifyOutcome = (net: number, gross: number): Exclude<TradeOutcome, 'pending'> =>
  gross === 0 || Math.abs(net) < ZERO_RESULT ? 'breakeven' : net > 0 ? 'win' : 'loss'

/** Outcome from the trade's numbers (older trades stored a flat result as a loss) */
export const outcomeOf = (t: Pick<Trade, 'status' | 'profitLoss' | 'fees'>): TradeOutcome =>
  t.status !== 'closed' ? 'pending' : classifyOutcome(t.profitLoss, t.profitLoss + (t.fees || 0))

export interface TradeResultInput {
  type: 'long' | 'short'
  entryPrice: number
  exitPrice: number | null
  baseQty: number
  leverage: number
  exchange: string
  market: AccountType
  /** Fees typed by the user; null = estimate from the exchange's taker fee */
  manualFees: number | null
}

export interface TradeResult {
  status: 'open' | 'closed'
  outcome: TradeOutcome
  /** Price move times size, before fees */
  grossPnL: number
  fees: number
  /** Gross result minus fees */
  profitLoss: number
  /** Net result as a percentage of the margin used */
  profitLossPercent: number
}

/** Result of a trade from its prices, size and fees. Without an exit price the trade is open. */
export const computeTradeResult = (i: TradeResultInput): TradeResult => {
  const rate = takerFeeRate(i.exchange, i.market)
  const entryValue = i.entryPrice * i.baseQty

  if (i.exitPrice === null) {
    return {
      status: 'open',
      outcome: 'pending',
      grossPnL: 0,
      fees: i.manualFees ?? entryValue * rate,
      profitLoss: 0,
      profitLossPercent: 0
    }
  }

  const dir = i.type === 'long' ? 1 : -1
  const grossPnL = (i.exitPrice - i.entryPrice) * i.baseQty * dir
  const fees = i.manualFees ?? (entryValue + i.exitPrice * i.baseQty) * rate
  const profitLoss = grossPnL - fees
  const margin = entryValue / Math.max(1, i.leverage)
  return {
    status: 'closed',
    outcome: classifyOutcome(profitLoss, grossPnL),
    grossPnL,
    fees,
    profitLoss,
    profitLossPercent: margin > 0 ? (profitLoss / margin) * 100 : 0
  }
}

type Risked = Sized & Pick<Trade, 'type' | 'stopLoss' | 'market' | 'leverage' | 'exchange'>

/**
 * Money lost if the stop is hit, fees included (the same definition the
 * Calculator sizes positions with). Null without a stop on the losing side.
 */
export const riskAmount = (t: Risked): number | null => {
  const stop = t.stopLoss
  if (!stop || !(stop > 0) || !(t.entryPrice > 0)) return null
  const dir = t.type === 'long' ? 1 : -1
  if ((t.entryPrice - stop) * dir <= 0) return null
  const rate = takerFeeRate(t.exchange, tradeMarket(t))
  const risk = baseQuantity(t) * (Math.abs(t.entryPrice - stop) + (t.entryPrice + stop) * rate)
  return risk > 0 ? risk : null
}

/** Result in units of the amount risked: +2R made twice the risk, -1R is a full stop-out */
export const rMultiple = (t: Trade): number | null => {
  if (t.status !== 'closed') return null
  const risk = riskAmount(t)
  return risk ? t.profitLoss / risk : null
}

/** Planned reward-to-risk if the take profit is hit, after fees */
export const plannedRewardRisk = (t: Risked & Pick<Trade, 'takeProfit'>): number | null => {
  const risk = riskAmount(t)
  const tp = t.takeProfit
  if (!risk || !tp || !(tp > 0)) return null
  const dir = t.type === 'long' ? 1 : -1
  if ((tp - t.entryPrice) * dir <= 0) return null
  const qty = baseQuantity(t)
  const rate = takerFeeRate(t.exchange, tradeMarket(t))
  const reward = qty * (Math.abs(tp - t.entryPrice) - (t.entryPrice + tp) * rate)
  return reward > 0 ? reward / risk : null
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

// Older trades stored only a calendar day, written as midnight UTC
const DATE_ONLY = /T00:00:00(\.000)?Z$/

/**
 * A moment as stored on a trade. A real time that lands exactly on midnight
 * UTC (09:00 in Tokyo, for example) is moved by 1 ms, so it is never mistaken
 * for an older day-only date.
 */
export const toStoredDate = (d: Date): string => {
  const iso = d.toISOString()
  return DATE_ONLY.test(iso) ? new Date(d.getTime() + 1).toISOString() : iso
}

/** True when the stored value has a real time of day, not just a calendar day */
export const hasTimeOfDay = (iso: string | null | undefined): boolean => !!iso && !DATE_ONLY.test(iso)

/**
 * A stored trade date as a local Date. A day-only value keeps its calendar
 * day (at noon) instead of sliding to the previous day west of UTC.
 */
export const parseTradeDate = (iso: string): Date => {
  if (DATE_ONLY.test(iso)) {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
    return new Date(y, m - 1, d, 12)
  }
  return new Date(iso)
}

export const entryMoment = (t: Pick<Trade, 'entryDate'>): Date => parseTradeDate(t.entryDate)

/** When a closed trade ended; falls back to the entry date for trades saved without one */
export const closeMoment = (t: Pick<Trade, 'entryDate' | 'exitDate'>): Date => parseTradeDate(t.exitDate || t.entryDate)

/** Time in the trade, when both ends have a real time */
export const holdingMs = (t: Pick<Trade, 'entryDate' | 'exitDate'>): number | null => {
  if (!hasTimeOfDay(t.entryDate) || !hasTimeOfDay(t.exitDate)) return null
  const ms = new Date(t.exitDate as string).getTime() - new Date(t.entryDate).getTime()
  return ms > 0 ? ms : null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Local calendar day as YYYY-MM-DD */
export const localDayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Value for an <input type="datetime-local"> in local time */
export const toLocalInput = (d: Date): string => `${localDayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
