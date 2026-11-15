/**
 * Turns closed Practice trades (paper trades in this browser, and positions
 * closed on a connected Bybit Demo Trading or testnet account) into Journal
 * trades marked as practice.
 */
import { apiKeyService } from '../apiKeyService'
import { bybitService, getBybitEnv } from '../bybitService'
import type { BybitClosedPnl } from '../bybitService'
import { paperTradingService } from '../paperTradingService'
import type { PaperTrade } from '../paperTradingService'
import type { NewTrade, Trade } from '../firestoreService'
import { symbolToPair } from '../../config/pairs'
import { classifyOutcome, toStoredDate } from './tradeMath'

const CLOSE_REASONS: Record<NonNullable<PaperTrade['closeReason']>, string> = {
  manual: 'closed by hand',
  takeProfit: 'closed at the take profit',
  stopLoss: 'closed at the stop loss',
  liquidation: 'liquidated'
}

const practiceBase = {
  quantityType: 'base' as const,
  exchange: 'bybit',
  market: 'futures' as const,
  status: 'closed' as const,
  feesManual: true, // the real fees charged, not an estimate
  tags: [],
  screenshots: [],
  source: 'practice' as const,
  isPractice: true
}

/** A closed paper trade as a Journal trade */
export const paperTradeToJournal = (t: PaperTrade): NewTrade | null => {
  if (t.status !== 'closed' || t.exitPrice === undefined || !(t.entryPrice > 0) || !(t.quantity > 0)) return null
  const net = t.pnl ?? 0
  const fees = t.fees || 0
  const margin = (t.entryPrice * t.quantity) / Math.max(1, t.leverage)
  return {
    ...practiceBase,
    pair: symbolToPair(t.symbol),
    type: t.side,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    quantity: t.quantity,
    entryDate: toStoredDate(new Date(t.timestamp)),
    exitDate: toStoredDate(new Date(t.exitTimestamp ?? t.timestamp)),
    stopLoss: t.stopLoss ?? null,
    takeProfit: t.takeProfit ?? null,
    leverage: t.leverage,
    outcome: classifyOutcome(net, net + fees),
    profitLoss: net,
    profitLossPercent: margin > 0 ? (net / margin) * 100 : 0,
    fees,
    notes: `Paper trade, ${CLOSE_REASONS[t.closeReason ?? 'manual']}.`,
    importId: `paper-${t.id}`
  }
}

/** A position closed on Bybit Demo Trading or testnet as a Journal trade */
export const bybitClosedPnlToJournal = (row: BybitClosedPnl, envName: string): NewTrade | null => {
  const entryPrice = parseFloat(row.avgEntryPrice)
  const exitPrice = parseFloat(row.avgExitPrice)
  const quantity = parseFloat(row.closedSize || row.qty)
  const net = parseFloat(row.closedPnl)
  const closedAt = Number(row.updatedTime || row.createdTime)
  if (!(entryPrice > 0) || !(exitPrice > 0) || !(quantity > 0) || !Number.isFinite(net) || !(closedAt > 0) || !row.orderId) return null

  const leverage = Math.max(1, parseFloat(row.leverage) || 1)
  // The closing order's side is the opposite of the position's
  const type = row.side === 'Sell' ? 'long' : 'short'
  const gross = (exitPrice - entryPrice) * quantity * (type === 'long' ? 1 : -1)
  const reportedFees = (parseFloat(row.openFee ?? '') || 0) + (parseFloat(row.closeFee ?? '') || 0)
  // Older responses have no fee fields; the gap between gross and net is fees (and funding)
  const fees = reportedFees > 0 ? reportedFees : Math.max(0, gross - net)
  const margin = (entryPrice * quantity) / leverage
  const closedIso = toStoredDate(new Date(closedAt))
  return {
    ...practiceBase,
    pair: symbolToPair(row.symbol),
    type,
    entryPrice,
    exitPrice,
    quantity,
    // Bybit reports when the position closed, not when it opened
    entryDate: closedIso,
    exitDate: closedIso,
    stopLoss: null,
    takeProfit: null,
    leverage,
    outcome: classifyOutcome(net, net + fees),
    profitLoss: net,
    profitLossPercent: margin > 0 ? (net / margin) * 100 : 0,
    fees,
    notes: `${envName} trade. Bybit reports only the close time, so the entry time is not known.`,
    importId: `bybit-${row.orderId}`
  }
}

export interface PracticeImport {
  /** Trades not yet in the Journal, oldest first */
  trades: NewTrade[]
  paperCount: number
  bybitCount: number
  /** Set when a connected Bybit account could not be read */
  bybitError: string | null
}

/**
 * Closed Practice trades that are not in the Journal yet. Paper trades come
 * from this browser (signed in or not); Bybit trades need connected keys.
 */
export const findPracticeTrades = async (userId: string, existing: Trade[]): Promise<PracticeImport> => {
  const known = new Set(existing.map(t => t.importId).filter(Boolean))
  const fresh = (t: NewTrade | null): t is NewTrade => !!t && !known.has(t.importId) && (known.add(t.importId), true)

  const paper = [...paperTradingService.peekClosedTrades(userId), ...paperTradingService.peekClosedTrades('anonymous')]
    .map(paperTradeToJournal)
    .filter(fresh)

  let bybit: NewTrade[] = []
  let bybitError: string | null = null
  if (apiKeyService.hasCredentials(userId, 'bybit_testnet')) {
    const envName = getBybitEnv(userId) === 'demo' ? 'Bybit Demo Trading' : 'Bybit testnet'
    try {
      bybit = (await bybitService.getClosedPnl(userId)).map(row => bybitClosedPnlToJournal(row, envName)).filter(fresh)
    } catch (error) {
      bybitError = error instanceof Error ? error.message : `Could not read ${envName}`
    }
  }

  const trades = [...paper, ...bybit].sort((a, b) => (a.exitDate ?? '').localeCompare(b.exitDate ?? ''))
  return { trades, paperCount: paper.length, bybitCount: bybit.length, bybitError }
}
