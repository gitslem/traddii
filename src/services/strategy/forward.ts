/**
 * Forward tests in the browser. A saved strategy is replayed over the candles
 * that closed since its last resume point (see replayCore): the same candles
 * always give the same trades, so nothing is lost while the app is closed.
 * New closed trades are counted once and sent to the Journal as practice trades.
 *
 * Replays run when the app opens and at every candle close while any Traddii
 * tab is open (StrategyWatcher).
 */
import { firestoreService } from '../firestoreService'
import { computeReplay } from './replayCore'
import type { PairForward } from './replayCore'
import type { OpenSim, SimTrade } from './engine'
import { patchStrategy } from './strategyStore'
import type { ForwardStats, SavedStrategy } from './types'

export type { PairForward }

/** A replay younger than this is reused instead of fetching again */
const REUSE_MS = 60_000

export interface ForwardResult {
  strategyId: string
  name: string
  version: number
  checkedAt: number
  pairs: PairForward[]
  /** Trades that closed since the last replay (counted and sent to the Journal now) */
  closed: (SimTrade & { pair: string })[]
  /** Trades opened, or about to open, seen for the first time */
  newOpens: (OpenSim & { pair: string; planned: boolean })[]
  /** Running totals after this replay */
  stats: ForwardStats
  /** Trades newly written to the Journal */
  sent: number
  error: string | null
}

const cache = new Map<string, { at: number; done: boolean; promise: Promise<ForwardResult> }>()
const latest = new Map<string, ForwardResult>()
const listeners = new Set<(r: ForwardResult) => void>()

/** Calls back with every finished replay. Returns an unsubscribe function. */
export const onReplay = (listener: (r: ForwardResult) => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The most recent replay of each strategy in this tab */
export const latestReplays = (): Map<string, ForwardResult> => new Map(latest)

const replay = async (userId: string, s: SavedStrategy): Promise<ForwardResult> => {
  const c = await computeReplay(s)
  const out: ForwardResult = {
    strategyId: s.id, name: s.name, version: s.version, checkedAt: Date.now(),
    pairs: c.pairs, closed: c.closed, newOpens: c.newOpens, stats: c.stats, sent: 0, error: null
  }
  try {
    // Trades are keyed by importId, so the same trade written twice (another tab, the server) is stored once
    if (c.toJournal.length > 0) await firestoreService.addImportedTrades(userId, c.toJournal)
    out.sent = c.toJournal.length
    // Totals are absolute values from the snapshot this replay started from, so two replays
    // finishing the same work write the same numbers instead of counting twice
    if (c.changed) await patchStrategy(userId, s.id, { progress: c.nextProgress, stats: c.stats })
  } catch (error) {
    console.error('Saving the replay failed:', error)
    out.error = 'Could not save the new trades. They will be picked up next time.'
  }
  if (!out.error && out.pairs.length > 0 && out.pairs.every(p => p.error)) out.error = out.pairs[0].error
  return out
}

/**
 * Replay every active strategy. Results under a minute old are reused unless
 * `force` is set, so pages opened together fetch once.
 */
export const replayStrategies = (userId: string, strategies: SavedStrategy[], force = false): Promise<ForwardResult[]> =>
  Promise.all(strategies.filter(s => s.active).map(s => {
    const key = `${userId}:${s.id}:${s.version}:${s.forwardFrom}`
    const hit = cache.get(key)
    // A replay still running is always shared, even when forced
    if (hit && (!hit.done || (!force && Date.now() - hit.at < REUSE_MS))) return hit.promise
    const entry = { at: Date.now(), done: false, promise: Promise.resolve(null as unknown as ForwardResult) }
    entry.promise = replay(userId, s).then(r => {
      entry.done = true
      latest.set(s.id, r)
      listeners.forEach(l => l(r))
      return r
    })
    cache.set(key, entry)
    return entry.promise
  }))
