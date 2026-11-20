/**
 * The words of forward-test alerts. Each event has a fixed tag, so two open
 * tabs show it once.
 */
import { formatPrice } from '../../utils/format'
import type { OpenSim, SimTrade } from './engine'

export interface AlertMessage {
  title: string
  body: string
  tag: string
}

interface ReplayEvents {
  strategyId: string
  name: string
  version: number
  newOpens: (OpenSim & { pair: string; planned?: boolean })[]
  closed: (SimTrade & { pair: string })[]
}

const signedR = (r: number) => `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`
const money = (v: number) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`
const EXIT_WORD = { target: 'target', stop: 'stop', time: 'time limit' } as const

/** Opens older than this are reported as having happened while away, not as news */
const FRESH_OPEN_MS = 6 * 3_600_000

export const alertMessages = (e: ReplayEvents, now = Date.now()): AlertMessage[] => {
  const out: AlertMessage[] = []
  for (const o of e.newOpens) {
    const ago = now - o.entryTime
    out.push({
      title: `${e.name}: ${o.side} ${o.pair}`,
      body: o.planned
        ? `Signal: opening at about ${formatPrice(o.entry)}. Stop ${formatPrice(o.stop)}, target ${formatPrice(o.target)}. Paper trade.`
        : `${ago > FRESH_OPEN_MS ? 'Opened earlier' : 'Opened'} at ${formatPrice(o.entry)}. Stop ${formatPrice(o.stop)}, target ${formatPrice(o.target)}. Paper trade.`,
      tag: `open:${e.strategyId}:${e.version}:${o.pair}:${o.entryTime}`
    })
  }
  if (e.closed.length > 3) {
    const sumR = e.closed.reduce((s, t) => s + t.r, 0)
    out.push({
      title: `${e.name}: ${e.closed.length} trades closed`,
      body: `${signedR(sumR)} in total. They are in your Journal as practice trades.`,
      tag: `closed:${e.strategyId}:${e.version}:${e.closed.map(t => `${t.pair}@${t.entryTime}`).join(',')}`.slice(0, 200)
    })
  } else {
    for (const t of e.closed) {
      out.push({
        title: `${e.name}: ${t.side} ${t.pair} closed`,
        body: `${signedR(t.r)} (${money(t.net)}) at the ${EXIT_WORD[t.reason]}. Paper trade.`,
        tag: `closed:${e.strategyId}:${e.version}:${t.pair}:${t.entryTime}`
      })
    }
  }
  return out
}
