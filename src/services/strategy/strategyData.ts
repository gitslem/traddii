/** Reading saved strategies from stored data. No Firebase imports, so it can be tested in Node. */
import { DEFAULT_RULES, EMPTY_STATS, TIMEFRAMES } from './types'
import type { ForwardStats, PairProgress, SavedStrategy, StrategyRules } from './types'

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

const readProgress = (raw: unknown, forwardFrom: number): Record<string, PairProgress> => {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, PairProgress> = {}
  for (const [symbol, v] of Object.entries(raw as Record<string, unknown>)) {
    const p = (v ?? {}) as Record<string, unknown>
    out[symbol] = {
      checkpoint: num(p.checkpoint, forwardFrom),
      journaledThrough: num(p.journaledThrough, forwardFrom),
      ...(typeof p.openAlerted === 'number' ? { openAlerted: p.openAlerted } : {}),
      ...(typeof p.mirrored === 'number' ? { mirrored: p.mirrored } : {}),
      ...(typeof p.mirrorOpen === 'number' ? { mirrorOpen: p.mirrorOpen } : {}),
      ...(typeof p.mirrorNote === 'string' ? { mirrorNote: p.mirrorNote.slice(0, 300) } : {})
    }
  }
  return out
}

const readStats = (raw: unknown): ForwardStats => {
  const v = (raw ?? {}) as Record<string, unknown>
  return { trades: num(v.trades, 0), wins: num(v.wins, 0), sumR: num(v.sumR, 0), net: num(v.net, 0) }
}

/** A stored strategy with every field present and of the right type; null if unusable */
export const normaliseStrategy = (id: string, raw: unknown): SavedStrategy | null => {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const pick = <K extends keyof StrategyRules>(key: K, ok: (v: unknown) => boolean): StrategyRules[K] =>
    (ok(s[key]) ? s[key] : DEFAULT_RULES[key]) as StrategyRules[K]
  const isBool = (v: unknown) => typeof v === 'boolean'
  const forwardFrom = num(s.forwardFrom, NaN)
  if (typeof s.pair !== 'string' || !Number.isFinite(forwardFrom)) return null
  return {
    id,
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 40) : 'Strategy',
    version: Math.max(1, Math.floor(num(s.version, 1))),
    createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date(forwardFrom).toISOString(),
    forwardFrom,
    active: s.active !== false,
    mirror: s.mirror === true,
    mirrorSince: num(s.mirrorSince, Number.MAX_SAFE_INTEGER),
    progress: readProgress(s.progress, forwardFrom),
    stats: s.stats ? readStats(s.stats) : { ...EMPTY_STATS },
    pair: s.pair,
    basket: pick('basket', isBool),
    timeframe: pick('timeframe', v => TIMEFRAMES.some(t => t.id === v)),
    direction: pick('direction', v => v === 'long' || v === 'short' || v === 'both'),
    withTrend: pick('withTrend', isBool),
    withHigherTrend: pick('withHigherTrend', isBool),
    candle: pick('candle', v => v === 'any' || v === 'pattern' || v === 'engulfing' || v === 'pinbar'),
    nearLevel: pick('nearLevel', isBool),
    volumeAbove: pick('volumeAbove', isBool),
    stop: pick('stop', v => v === 'swing' || v === 'atr'),
    stopAtr: num(s.stopAtr, DEFAULT_RULES.stopAtr),
    targetR: num(s.targetR, DEFAULT_RULES.targetR),
    maxBars: num(s.maxBars, DEFAULT_RULES.maxBars),
    accountSize: num(s.accountSize, DEFAULT_RULES.accountSize),
    riskPercent: num(s.riskPercent, DEFAULT_RULES.riskPercent),
    maxLeverage: num(s.maxLeverage, DEFAULT_RULES.maxLeverage),
    slippagePercent: num(s.slippagePercent, DEFAULT_RULES.slippagePercent)
  }
}

/** Every usable strategy in a user document's strategies map, oldest first */
export const strategiesFromDoc = (data: Record<string, unknown> | undefined): SavedStrategy[] =>
  Object.entries((data?.strategies ?? {}) as Record<string, unknown>)
    .map(([id, raw]) => normaliseStrategy(id, raw))
    .filter((s): s is SavedStrategy => s !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
