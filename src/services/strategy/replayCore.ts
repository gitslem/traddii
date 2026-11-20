/**
 * The part of a forward-test replay that decides what happened. No Firebase
 * imports: forward.ts writes the results, and the engine tests run it in Node.
 */
import { fetchClosedCandles, intervalMs } from '../ohlcvService'
import type { NewTrade } from '../firestoreService'
import { pairToSymbol } from '../../config/pairs'
import { WARMUP_BARS, prepare, simulate } from './engine'
import type { OpenSim, Side, SimTrade } from './engine'
import { simToNewTrade } from './journalTrades'
import { pairsFor } from './types'
import type { ForwardStats, PairProgress, SavedStrategy } from './types'

/** Most candles fetched for one pair in one replay */
const MAX_REPLAY_CANDLES = 20_000

export interface PairForward {
  pair: string
  open: OpenSim | null
  pending: Side | null
  /** The pending trade as planned now (see SimResult.pendingPlan) */
  pendingPlan: OpenSim | null
  /** Close time of the last candle replayed */
  lastCandle: number | null
  error: string | null
}

export type JournalBotTrade = NewTrade & { importId: string }

export interface ReplayComputation {
  pairs: PairForward[]
  /** Trades that closed since the last replay */
  closed: (SimTrade & { pair: string })[]
  /** Trades opened, or about to open at the next candle (planned), that no alert has been sent for yet */
  newOpens: (OpenSim & { pair: string; planned: boolean })[]
  /** The closed trades as Journal trades */
  toJournal: JournalBotTrade[]
  /** Progress per symbol for the pairs that replayed (failed pairs keep theirs) */
  nextProgress: Record<string, PairProgress>
  /** Running totals including the new closed trades */
  stats: ForwardStats
  /** True when something needs saving */
  changed: boolean
}

export const friendlyReplayError = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error)
  if (/403|forbidden|blocked|451/i.test(text)) return 'Bybit refused the request from this location.'
  return /network|timeout|fetch|ECONN|ENOTFOUND/i.test(text) ? 'Could not reach Bybit. Check your connection.' : 'The replay failed. Try again later.'
}

export const computeReplay = async (s: SavedStrategy, fetchCandles = fetchClosedCandles): Promise<ReplayComputation> => {
  const ms = intervalMs(s.timeframe)
  const out: ReplayComputation = { pairs: [], closed: [], newOpens: [], toJournal: [], nextProgress: {}, stats: { ...s.stats }, changed: false }
  const meta = { name: s.name, version: s.version, strategyId: s.id }

  for (const pair of pairsFor(s)) {
    const symbol = pairToSymbol(pair)
    const before = s.progress[symbol]
    const progress: PairProgress = before ?? { checkpoint: s.forwardFrom, journaledThrough: s.forwardFrom }
    try {
      if (!ms) throw new Error('Unknown timeframe')
      const candles = await fetchCandles(pair, s.timeframe, { from: progress.checkpoint - WARMUP_BARS * ms, max: MAX_REPLAY_CANDLES })
      if (candles.length === 0) throw new Error('No candles came back from Bybit.')
      const result = simulate(prepare(candles, s.timeframe), s, { signalFrom: progress.checkpoint })

      for (const t of result.trades.filter(t => t.exitTime > progress.journaledThrough)) {
        out.closed.push({ ...t, pair })
        out.toJournal.push(simToNewTrade(t, { ...s, pair }, meta) as JournalBotTrade)
      }
      const next: PairProgress = {
        ...progress,
        checkpoint: Math.max(progress.checkpoint, result.checkpoint ?? progress.checkpoint),
        journaledThrough: Math.max(progress.journaledThrough, ...result.trades.map(t => t.exitTime))
      }
      const alerted = progress.openAlerted ?? progress.checkpoint - 1
      const opening = result.open && result.open.entryTime > alerted
        ? { ...result.open, planned: false }
        : result.pendingPlan && result.pendingPlan.entryTime > alerted ? { ...result.pendingPlan, planned: true } : null
      if (opening) {
        out.newOpens.push({ ...opening, pair })
        next.openAlerted = opening.entryTime
      }
      out.nextProgress[symbol] = next
      if (!before || before.checkpoint !== next.checkpoint || before.journaledThrough !== next.journaledThrough || before.openAlerted !== next.openAlerted) {
        out.changed = true
      }
      out.pairs.push({ pair, open: result.open, pending: result.pending, pendingPlan: result.pendingPlan, lastCandle: candles[candles.length - 1].closeTime, error: null })
    } catch (error) {
      console.error(`Strategy replay failed for ${pair}:`, error)
      out.pairs.push({ pair, open: null, pending: null, pendingPlan: null, lastCandle: null, error: friendlyReplayError(error) })
    }
  }

  for (const t of out.closed) {
    out.stats = {
      trades: out.stats.trades + 1,
      wins: out.stats.wins + (t.net > 0 ? 1 : 0),
      sumR: out.stats.sumR + t.r,
      net: out.stats.net + t.net
    }
  }
  if (out.closed.length > 0) out.changed = true
  return out
}
