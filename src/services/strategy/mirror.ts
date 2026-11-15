/**
 * Mirrors a forward test's entries on the user's Bybit Demo Trading (or
 * testnet) account. The API keys stay in this browser, so this runs only
 * while a Traddii tab is open:
 * - when a candle closes with an entry signal, the trade the bot is about to
 *   open is placed straight away as a market order, same size, with its stop
 *   and target attached (the bot itself fills at the next candle's open);
 * - a signal the browser was not open for is skipped, never placed late;
 * - when the bot's trade closes (e.g. at its time limit), any Demo position
 *   still open on that pair and side is closed too.
 */
import { apiKeyService } from '../apiKeyService'
import { BYBIT_ENV_LABEL, bybitService, getBybitEnv } from '../bybitService'
import { intervalMs } from '../ohlcvService'
import { pairToSymbol } from '../../config/pairs'
import { formatPrice } from '../../utils/format'
import type { ForwardResult } from './forward'
import { roundPrice, roundQty } from './orderMath'
import { patchPairProgress } from './strategyStore'
import type { PairProgress, SavedStrategy } from './types'

/** A signal older than this (or one candle, if shorter) is too late to place */
const LATE_MS = 10 * 60_000

export const canMirror = (userId: string): boolean => apiKeyService.hasCredentials(userId, 'bybit_testnet')

const markKey = (s: SavedStrategy, symbol: string) => `traddii-mirror:${s.id}:${s.version}:${symbol}`
const readMark = (key: string): number => {
  try {
    return Number(localStorage.getItem(key)) || 0
  } catch {
    return 0
  }
}
const writeMark = (key: string, value: number) => {
  try { localStorage.setItem(key, String(value)) } catch { /* the Firestore mark still applies */ }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 160)

const mirrorPair = async (userId: string, s: SavedStrategy, r: ForwardResult, index: number) => {
  const p = r.pairs[index]
  const symbol = pairToSymbol(p.pair)
  const progress: Partial<PairProgress> = s.progress[symbol] ?? {}
  const env = BYBIT_ENV_LABEL[getBybitEnv(userId)]
  const save = (fields: Partial<PairProgress>) => patchPairProgress(userId, s.id, symbol, fields)
  const key = markKey(s, symbol)
  const mark = Math.max(progress.mirrored ?? 0, readMark(key), s.mirrorSince)

  // Bot exits: close whatever is left of the mirrored position
  for (const t of r.closed.filter(t => t.pair === p.pair && progress.mirrorOpen && t.entryTime === progress.mirrorOpen)) {
    const why = t.reason === 'time' ? 'its time limit' : t.reason === 'target' ? 'its target' : 'its stop'
    try {
      const positions = await bybitService.getPositions(userId, symbol)
      const side = t.side === 'long' ? 'Buy' : 'Sell'
      const open = positions.find(x => x.side === side && parseFloat(x.size) > 0)
      if (open) await bybitService.closePosition(userId, symbol, open.side, open.size)
      await save({ mirrorOpen: 0, mirrorNote: open ? `The bot closed at ${why}, so the ${env} position was closed too.` : `The bot closed at ${why}; the ${env} position had already closed on Bybit.` })
    } catch (error) {
      await save({ mirrorNote: `Could not close the ${env} position: ${errorText(error)}` })
    }
  }

  // A signal on the candle that just closed: place the trade the bot is about to open
  const plan = p.pendingPlan
  if (plan && plan.entryTime > mark) {
    writeMark(key, plan.entryTime)
    const ms = intervalMs(s.timeframe) ?? LATE_MS
    if (Date.now() - plan.entryTime > Math.min(ms, LATE_MS)) {
      await save({ mirrored: plan.entryTime, mirrorNote: `Skipped a ${plan.side} signal: it was ${Math.round((Date.now() - plan.entryTime) / 60_000)} minutes old when Traddii saw it, and entries are never placed late.` })
      return
    }
    try {
      const inst = await bybitService.getInstrument(symbol)
      const qty = roundQty(plan.qty, inst.qtyStep)
      if (parseFloat(qty) < inst.minOrderQty) {
        await save({ mirrored: plan.entryTime, mirrorNote: `Skipped: ${qty} is below Bybit's minimum order of ${inst.minOrderQty}.` })
        return
      }
      await bybitService.setLeverage(userId, symbol, String(Math.min(plan.leverage, inst.maxLeverage))).catch(error => {
        console.warn('Could not set leverage before mirroring:', error)
      })
      const side = plan.side === 'long' ? 'Buy' : 'Sell'
      const stopLoss = roundPrice(plan.stop, inst.tickSize)
      const takeProfit = roundPrice(plan.target, inst.tickSize)
      await bybitService.placeOrder(userId, { symbol, side, orderType: 'Market', qty, stopLoss, takeProfit })
      await save({ mirrored: plan.entryTime, mirrorOpen: plan.entryTime, mirrorNote: `Opened ${plan.side} ${qty} ${p.pair.replace('/USDT', '')} on Bybit ${env} at market, stop ${stopLoss}, target ${takeProfit}.` })
    } catch (error) {
      await save({ mirrored: plan.entryTime, mirrorNote: `The ${env} order failed: ${errorText(error)}` })
    }
    return
  }

  // A bot entry whose signal this browser never saw (Traddii was closed): note it, never place it late
  const o = p.open
  if (o && o.entryTime > mark) {
    writeMark(key, o.entryTime)
    await save({ mirrored: o.entryTime, mirrorNote: `Skipped the ${o.side} entry at ${formatPrice(o.entry)}: Traddii was not open when the signal came, and entries are never placed late.` })
  }
}

/** Mirror one replay's new entries and exits. Tabs take turns, so an entry is placed once. */
export const mirrorReplay = async (userId: string, s: SavedStrategy, r: ForwardResult): Promise<void> => {
  if (!s.mirror || !s.active || r.version !== s.version || !canMirror(userId)) return
  const run = async () => {
    for (let i = 0; i < r.pairs.length; i++) {
      if (r.pairs[i].error) continue
      await mirrorPair(userId, s, r, i).catch(error => console.error('Mirroring failed:', error))
    }
  }
  if (typeof navigator !== 'undefined' && navigator.locks) {
    await navigator.locks.request(`traddii-mirror-${s.id}`, { ifAvailable: true }, async lock => {
      if (lock) await run()
    })
  } else {
    await run()
  }
}
