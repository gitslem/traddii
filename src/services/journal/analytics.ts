/**
 * Journal statistics. Everything here is derived from closed trades and their
 * net (after-fee) results. Pure functions, no I/O.
 */
import type { Trade } from '../firestoreService'
import { closeMoment, entryMoment, holdingMs, localDayKey, outcomeOf, rMultiple } from './tradeMath'

/** Which trades to look at: real money, practice (paper/demo), or both */
export type AccountMode = 'real' | 'practice' | 'all'

export const filterByAccount = (trades: Trade[], mode: AccountMode): Trade[] =>
  mode === 'all' ? trades : trades.filter(t => !!t.isPractice === (mode === 'practice'))

/** Closed trades, oldest close first */
export const closedInOrder = (trades: Trade[]): Trade[] =>
  trades
    .filter(t => t.status === 'closed')
    .sort((a, b) =>
      closeMoment(a).getTime() - closeMoment(b).getTime() ||
      (a.createdAt || '').localeCompare(b.createdAt || ''))

export interface JournalAnalytics {
  totalTrades: number
  openTrades: number
  closedTrades: number
  wins: number
  losses: number
  /** Flat trades: counted in the totals but in neither wins nor losses */
  breakevens: number
  /** Wins as a percentage of wins plus losses */
  winRate: number
  totalPnL: number
  /** Sum of all profitable trades */
  grossProfit: number
  /** Sum of all losing trades, as a positive number */
  grossLoss: number
  /** Gross profit divided by gross loss. Above 1 means the account is making money. */
  profitFactor: number
  avgWin: number
  avgLoss: number
  largestWin: number
  largestLoss: number
  /** Average net result per closed trade */
  expectancy: number
  /** Average R-multiple of the closed trades that have a stop loss */
  avgR: number | null
  rCount: number
  totalFees: number
  currentStreak: number
  currentStreakType: 'win' | 'loss' | null
  bestWinStreak: number
  worstLossStreak: number
  /** Largest fall from a peak in cumulative P&L */
  maxDrawdown: number
  avgHoldMs: number | null
  tradesThisWeek: number
  tradesThisMonth: number
  bestPair: string | null
  worstPair: string | null
}

export const computeAnalytics = (trades: Trade[], now: Date = new Date()): JournalAnalytics => {
  const closed = closedInOrder(trades)

  let wins = 0, losses = 0, breakevens = 0
  let winSum = 0, lossSum = 0
  let grossProfit = 0, grossLoss = 0, totalPnL = 0, totalFees = 0
  let largestWin = 0, largestLoss = 0
  let rSum = 0, rCount = 0
  let holdSum = 0, holdCount = 0
  let run = 0
  let runType: 'win' | 'loss' | null = null
  let bestWinStreak = 0, worstLossStreak = 0
  let equity = 0, peak = 0, maxDrawdown = 0
  const byPair = new Map<string, number>()

  for (const t of closed) {
    const pnl = t.profitLoss
    totalPnL += pnl
    totalFees += t.fees || 0
    if (pnl > 0) grossProfit += pnl
    else grossLoss -= pnl
    byPair.set(t.pair, (byPair.get(t.pair) || 0) + pnl)

    const outcome = outcomeOf(t)
    if (outcome === 'win') {
      wins++
      winSum += pnl
      largestWin = Math.max(largestWin, pnl)
    } else if (outcome === 'loss') {
      losses++
      lossSum -= pnl
      largestLoss = Math.min(largestLoss, pnl)
    } else {
      breakevens++
    }

    // A flat trade neither extends nor ends a streak
    if (outcome === 'win' || outcome === 'loss') {
      run = runType === outcome ? run + 1 : 1
      runType = outcome
      if (outcome === 'win') bestWinStreak = Math.max(bestWinStreak, run)
      else worstLossStreak = Math.max(worstLossStreak, run)
    }

    const r = rMultiple(t)
    if (r !== null) {
      rSum += r
      rCount++
    }
    const held = holdingMs(t)
    if (held !== null) {
      holdSum += held
      holdCount++
    }

    equity += pnl
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, peak - equity)
  }

  const decided = wins + losses
  const pairs = [...byPair.entries()].sort((a, b) => b[1] - a[1])
  const weekAgo = now.getTime() - 7 * 86_400_000
  const monthAgo = new Date(now)
  monthAgo.setMonth(monthAgo.getMonth() - 1)

  return {
    totalTrades: trades.length,
    openTrades: trades.filter(t => t.status === 'open').length,
    closedTrades: closed.length,
    wins,
    losses,
    breakevens,
    winRate: decided > 0 ? (wins / decided) * 100 : 0,
    totalPnL,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin: wins > 0 ? winSum / wins : 0,
    avgLoss: losses > 0 ? lossSum / losses : 0,
    largestWin,
    largestLoss,
    expectancy: closed.length > 0 ? totalPnL / closed.length : 0,
    avgR: rCount > 0 ? rSum / rCount : null,
    rCount,
    totalFees,
    currentStreak: run,
    currentStreakType: runType,
    bestWinStreak,
    worstLossStreak,
    maxDrawdown,
    avgHoldMs: holdCount > 0 ? holdSum / holdCount : null,
    tradesThisWeek: trades.filter(t => entryMoment(t).getTime() >= weekAgo).length,
    tradesThisMonth: trades.filter(t => entryMoment(t).getTime() >= monthAgo.getTime()).length,
    bestPair: pairs.length > 0 ? pairs[0][0] : null,
    worstPair: pairs.length > 0 ? pairs[pairs.length - 1][0] : null
  }
}

export interface EquityPoint {
  /** 1-based position in the sequence of closed trades */
  index: number
  date: Date
  /** Net result of this trade */
  pnl: number
  /** Cumulative net result up to and including this trade */
  equity: number
  trade: Trade
}

export interface EquityCurve {
  points: EquityPoint[]
  /** Largest peak-to-trough fall; indexes are positions in `points` (peak -1 = the starting zero) */
  drawdown: { amount: number; peakIndex: number; troughIndex: number } | null
}

/** Cumulative net P&L trade by trade, with the deepest drawdown located */
export const equityCurve = (trades: Trade[]): EquityCurve => {
  const points: EquityPoint[] = []
  let equity = 0
  let peak = 0
  let peakIndex = -1
  let drawdown: EquityCurve['drawdown'] = null

  closedInOrder(trades).forEach((trade, i) => {
    equity += trade.profitLoss
    points.push({ index: i + 1, date: closeMoment(trade), pnl: trade.profitLoss, equity, trade })
    if (equity > peak) {
      peak = equity
      peakIndex = i
    } else if (peak - equity > (drawdown?.amount ?? 0)) {
      drawdown = { amount: peak - equity, peakIndex, troughIndex: i }
    }
  })

  return { points, drawdown }
}

export interface DayStats {
  pnl: number
  trades: number
  wins: number
  losses: number
}

/** Net result per local calendar day, by the day each trade closed */
export const dailyPnL = (trades: Trade[]): Map<string, DayStats> => {
  const days = new Map<string, DayStats>()
  for (const t of closedInOrder(trades)) {
    const key = localDayKey(closeMoment(t))
    const day = days.get(key) ?? { pnl: 0, trades: 0, wins: 0, losses: 0 }
    day.pnl += t.profitLoss
    day.trades++
    const outcome = outcomeOf(t)
    if (outcome === 'win') day.wins++
    else if (outcome === 'loss') day.losses++
    days.set(key, day)
  }
  return days
}
