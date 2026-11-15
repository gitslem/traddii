/**
 * Runs a strategy over closed candles, one candle at a time, the way a bot
 * would have traded it. Pure functions, no I/O.
 *
 * No look-ahead: a signal uses only candles that had closed, the trade opens
 * at the next candle's open, and swing points count only once the candles
 * that confirm them have closed.
 */
import type { CandleData, StructureTrend, SwingPoint } from '../ohlcvService'
import { classifyStructure, detectPatterns, findSwingPoints, getTrendContext } from '../ohlcvService'
import { takerFeeRate } from '../journal/tradeMath'
import type { StrategyRules, Timeframe } from './types'

export const SWING_WIDTH = 3
const ATR_LEN = 14
const VOLUME_LEN = 20
/** Swing levels older than this many candles are ignored */
const LEVEL_LOOKBACK = 150
/**
 * Candles fetched before the first candle that may signal. Long enough that
 * trends (including the weekly trend on 1D) come out the same whether a
 * replay starts at the beginning of a forward test or at a later resume point.
 */
export const WARMUP_BARS = 1000
/** Bybit futures taker fee, charged on entry and exit */
export const FEE_RATE = takerFeeRate('bybit', 'futures')

const DAY = 86_400_000
/** The timeframe one step up, as candles of this one. Weeks start on Monday (1970-01-05 was one). */
const HIGHER: Record<Timeframe, { ms: number; offset: number }> = {
  '15m': { ms: 3_600_000, offset: 0 },
  '1h': { ms: 14_400_000, offset: 0 },
  '4h': { ms: DAY, offset: 0 },
  '1d': { ms: 7 * DAY, offset: 4 * DAY }
}

const PIN_BARS = {
  long: ['Hammer', 'Hanging Man', 'Hammer Shape', 'Dragonfly Doji'],
  short: ['Shooting Star', 'Inverted Hammer', 'Inverted Hammer Shape', 'Gravestone Doji']
}

export type Side = 'long' | 'short'

/** Indicators worked out once for the whole series */
export interface Prepared {
  candles: CandleData[]
  atr: (number | null)[]
  trend: StructureTrend[]
  higherTrend: StructureTrend[]
  swingHighs: SwingPoint[]
  swingLows: SwingPoint[]
  /** Number of swing highs / lows confirmed by the close of each candle */
  confirmedHighs: number[]
  confirmedLows: number[]
}

/** Average true range over the previous ATR_LEN candles, including this one */
const averageTrueRange = (c: CandleData[]): (number | null)[] => {
  const tr = c.map((k, i) => i === 0
    ? k.high - k.low
    : Math.max(k.high - k.low, Math.abs(k.high - c[i - 1].close), Math.abs(k.low - c[i - 1].close)))
  let sum = 0
  return tr.map((v, i) => {
    sum += v
    if (i >= ATR_LEN) sum -= tr[i - ATR_LEN]
    return i >= ATR_LEN - 1 ? sum / ATR_LEN : null
  })
}

/**
 * Trend at each candle from the last two confirmed swing highs and lows.
 * `knownAt(point)` is the candle index at which a swing point is confirmed.
 */
const trendSeries = (n: number, highs: SwingPoint[], lows: SwingPoint[], knownAt: (p: SwingPoint) => number) => {
  const out: StructureTrend[] = new Array(n)
  const counts = { highs: new Array<number>(n), lows: new Array<number>(n) }
  let h = 0
  let l = 0
  for (let i = 0; i < n; i++) {
    while (h < highs.length && knownAt(highs[h]) <= i) h++
    while (l < lows.length && knownAt(lows[l]) <= i) l++
    counts.highs[i] = h
    counts.lows[i] = l
    out[i] = classifyStructure(
      highs[h - 1]?.price ?? null, highs[h - 2]?.price ?? null,
      lows[l - 1]?.price ?? null, lows[l - 2]?.price ?? null
    )
  }
  return { trend: out, ...counts }
}

/** Candles of the next timeframe up, built from these ones. Only complete candles are kept. */
const higherCandles = (c: CandleData[], tf: Timeframe): { candles: CandleData[]; lastIndex: number[] } => {
  const { ms, offset } = HIGHER[tf]
  const candles: CandleData[] = []
  const lastIndex: number[] = []
  let i = 0
  while (i < c.length) {
    const bucket = Math.floor((c[i].openTime - offset) / ms)
    const start = bucket * ms + offset
    let j = i
    while (j + 1 < c.length && Math.floor((c[j + 1].openTime - offset) / ms) === bucket) j++
    const group = c.slice(i, j + 1)
    // Complete only if it starts and ends on the bucket's edges
    if (group[0].openTime === start && group[group.length - 1].closeTime === start + ms - 1) {
      candles.push({
        openTime: start,
        open: group[0].open,
        high: Math.max(...group.map(k => k.high)),
        low: Math.min(...group.map(k => k.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((s, k) => s + k.volume, 0),
        closeTime: start + ms - 1,
        quoteVolume: group.reduce((s, k) => s + k.quoteVolume, 0)
      })
      lastIndex.push(j)
    }
    i = j + 1
  }
  return { candles, lastIndex }
}

export const prepare = (candles: CandleData[], timeframe: Timeframe): Prepared => {
  const n = candles.length
  const { highs, lows } = findSwingPoints(candles, SWING_WIDTH)
  const base = trendSeries(n, highs, lows, p => p.index + SWING_WIDTH)

  const htf = higherCandles(candles, timeframe)
  const hSwings = findSwingPoints(htf.candles, SWING_WIDTH)
  // A higher-timeframe swing is known once the higher candle that confirms it has closed
  const htfKnownAt = (p: SwingPoint) => htf.lastIndex[p.index + SWING_WIDTH] ?? Infinity
  const higher = trendSeries(n, hSwings.highs, hSwings.lows, htfKnownAt)

  return {
    candles,
    atr: averageTrueRange(candles),
    trend: base.trend,
    higherTrend: higher.trend,
    swingHighs: highs,
    swingLows: lows,
    confirmedHighs: base.highs,
    confirmedLows: base.lows
  }
}

/** First candle on which every indicator can be known */
export const FIRST_SIGNAL_BAR = Math.max(VOLUME_LEN, ATR_LEN, 11)

const wantTrend = (side: Side): StructureTrend => (side === 'long' ? 'uptrend' : 'downtrend')

/** Nearest confirmed swing level on the trade's side of the close (below for longs, above for shorts) */
const nearestLevel = (p: Prepared, i: number, side: Side): number | null => {
  const close = p.candles[i].close
  let best: number | null = null
  const consider = (points: SwingPoint[], count: number) => {
    for (let k = count - 1; k >= 0 && points[k].index >= i - LEVEL_LOOKBACK; k--) {
      const price = points[k].price
      if (side === 'long' ? price < close && (best === null || price > best) : price > close && (best === null || price < best)) best = price
    }
  }
  consider(p.swingLows, p.confirmedLows[i])
  consider(p.swingHighs, p.confirmedHighs[i])
  return best
}

/** True when the closed candle `i` meets every entry condition for this side */
export const meetsEntry = (p: Prepared, r: StrategyRules, i: number, side: Side): boolean => {
  const c = p.candles
  const atr = p.atr[i]
  if (atr === null || i < FIRST_SIGNAL_BAR) return false
  if (r.withTrend && p.trend[i] !== wantTrend(side)) return false
  if (r.withHigherTrend && p.higherTrend[i] !== wantTrend(side)) return false
  if (r.candle !== 'any') {
    const patterns = detectPatterns(c[i], c[i - 1], getTrendContext(c.slice(Math.max(0, i - 10), i)))
    const type = side === 'long' ? 'bullish' : 'bearish'
    const ok = r.candle === 'pattern'
      ? patterns.some(pt => pt.type === type && pt.strength >= 60)
      : r.candle === 'engulfing'
        ? patterns.some(pt => pt.name === (side === 'long' ? 'Bullish Engulfing' : 'Bearish Engulfing'))
        : patterns.some(pt => PIN_BARS[side].includes(pt.name))
    if (!ok) return false
  }
  if (r.nearLevel) {
    const level = nearestLevel(p, i, side)
    if (level === null || Math.abs(c[i].close - level) > atr) return false
  }
  if (r.volumeAbove) {
    let sum = 0
    for (let k = i - VOLUME_LEN; k < i; k++) sum += c[k].volume
    if (!(c[i].volume > sum / VOLUME_LEN)) return false
  }
  return true
}

/** The side to trade on closed candle `i`, or null */
export const signalAt = (p: Prepared, r: StrategyRules, i: number): Side | null => {
  if (r.direction !== 'short' && meetsEntry(p, r, i, 'long')) return 'long'
  if (r.direction !== 'long' && meetsEntry(p, r, i, 'short')) return 'short'
  return null
}

/** Stop price for a trade signalled on candle `i` and filled at `fill`; null if it would be on the wrong side */
export const stopFor = (p: Prepared, r: StrategyRules, i: number, side: Side, fill: number): number | null => {
  const atr = p.atr[i]
  if (atr === null) return null
  const dir = side === 'long' ? 1 : -1
  let stop: number
  if (r.stop === 'atr') {
    stop = fill - dir * r.stopAtr * atr
  } else {
    // Beyond the last confirmed swing on the stop side, or the signal candle's extreme if that is further
    const c = p.candles[i]
    if (side === 'long') {
      const swing = p.swingLows[p.confirmedLows[i] - 1]?.price
      stop = Math.min(c.low, swing !== undefined && swing < c.close ? swing : c.low) - 0.1 * atr
    } else {
      const swing = p.swingHighs[p.confirmedHighs[i] - 1]?.price
      stop = Math.max(c.high, swing !== undefined && swing > c.close ? swing : c.high) + 0.1 * atr
    }
  }
  // At least 0.05% from the fill, and positive
  if (!(stop > 0) || (fill - stop) * dir < fill * 0.0005) return null
  return stop
}

export type ExitReason = 'stop' | 'target' | 'time'

export interface SimTrade {
  side: Side
  /** Open time of the candle the trade was entered on */
  entryTime: number
  /** Close time of the candle it was exited on (open time if it gapped through at the open) */
  exitTime: number
  /** Close time of the exit candle */
  exitBarClose: number
  entry: number
  exit: number
  stop: number
  target: number
  /** Size in the base coin */
  qty: number
  leverage: number
  /** Money lost at the stop, fees included */
  risk: number
  gross: number
  fees: number
  net: number
  r: number
  reason: ExitReason
  /** Candles held, counting the entry candle */
  bars: number
}

export interface OpenSim {
  side: Side
  entryTime: number
  entry: number
  stop: number
  target: number
  qty: number
  leverage: number
  risk: number
  bars: number
  /** Result after fees if it were closed at the last close */
  unrealised: number
}

export interface SimResult {
  trades: SimTrade[]
  open: OpenSim | null
  /** A signal on the last closed candle: the trade opens at the next candle's open */
  pending: Side | null
  /**
   * That trade as planned now, taking the last close as the entry: what a
   * live bot would place at this moment. Null without a pending signal or
   * when its stop would be on the wrong side.
   */
  pendingPlan: OpenSim | null
  /** Candles on which a signal could be taken (flat, warmed up, inside the window) */
  flatBars: number
  /** Times of the first and last candle that could signal */
  from: number | null
  to: number | null
  /**
   * Close time of the last candle that ended with no position and no signal.
   * A replay that starts signalling after it gives the same trades as one
   * that started earlier, so forward tests resume from here.
   */
  checkpoint: number | null
}

export interface SimOptions {
  /** Only candles closing after this time (ms) may signal */
  signalFrom?: number
  /** Replaces the strategy's entry rules (used for the random-entry comparison) */
  signal?: (i: number) => Side | null
}

/** Size so a stop-out loses exactly the risk amount, fees included, capped by the leverage limit */
const sizeTrade = (r: StrategyRules, fill: number, stop: number) => {
  const riskMoney = r.accountSize * r.riskPercent / 100
  const perUnit = Math.abs(fill - stop) + (fill + stop) * FEE_RATE
  const qty = Math.min(riskMoney / perUnit, (r.accountSize * r.maxLeverage) / fill)
  const leverage = Math.min(r.maxLeverage, Math.max(1, Math.ceil((qty * fill) / r.accountSize)))
  return { qty, leverage, risk: qty * perUnit }
}

type OpenPart = Omit<SimTrade, 'exit' | 'exitTime' | 'exitBarClose' | 'gross' | 'fees' | 'net' | 'r' | 'reason' | 'bars'>

const close = (t: OpenPart, exit: number, exitTime: number, bar: CandleData, reason: ExitReason, bars: number): SimTrade => {
  const dir = t.side === 'long' ? 1 : -1
  const gross = (exit - t.entry) * t.qty * dir
  const fees = (t.entry + exit) * t.qty * FEE_RATE
  const net = gross - fees
  return { ...t, exit, exitTime, exitBarClose: bar.closeTime, gross, fees, net, r: net / t.risk, reason, bars }
}

/** Trade the strategy over the prepared candles, one position at a time */
export const simulate = (p: Prepared, r: StrategyRules, opts: SimOptions = {}): SimResult => {
  const c = p.candles
  const slip = r.slippagePercent / 100
  const trades: SimTrade[] = []
  let pos: (OpenSim & { signalBar: number }) | null = null
  let pending: { side: Side; bar: number } | null = null
  let flatBars = 0
  let from: number | null = null
  let to: number | null = null
  let checkpoint: number | null = null
  const signal = opts.signal ?? ((i: number) => signalAt(p, r, i))

  for (let i = 0; i < c.length; i++) {
    const bar = c[i]

    // 1. A signal on the previous candle opens at this candle's open
    if (pending && !pos) {
      const dir = pending.side === 'long' ? 1 : -1
      const fill = bar.open * (1 + dir * slip)
      const stop = stopFor(p, r, pending.bar, pending.side, fill)
      if (stop !== null) {
        const target = fill + dir * r.targetR * Math.abs(fill - stop)
        pos = { side: pending.side, entryTime: bar.openTime, entry: fill, stop, target, ...sizeTrade(r, fill, stop), bars: 0, unrealised: 0, signalBar: pending.bar }
      }
      pending = null
    }

    // 2. Manage the open position with this candle
    if (pos) {
      const dir = pos.side === 'long' ? 1 : -1
      pos.bars++
      const base = { side: pos.side, entryTime: pos.entryTime, entry: pos.entry, stop: pos.stop, target: pos.target, qty: pos.qty, leverage: pos.leverage, risk: pos.risk }
      const gapStop = pos.bars > 1 && (bar.open - pos.stop) * dir <= 0
      const gapTarget = pos.bars > 1 && (bar.open - pos.target) * dir >= 0
      const hitStop = dir === 1 ? bar.low <= pos.stop : bar.high >= pos.stop
      const hitTarget = dir === 1 ? bar.high >= pos.target : bar.low <= pos.target
      let done: SimTrade | null = null
      if (gapStop) done = close(base, bar.open * (1 - dir * slip), bar.openTime, bar, 'stop', pos.bars)
      else if (gapTarget) done = close(base, bar.open, bar.openTime, bar, 'target', pos.bars)
      // Both inside one candle: the order is unknown, so count the stop (the cautious choice)
      else if (hitStop) done = close(base, pos.stop * (1 - dir * slip), bar.closeTime, bar, 'stop', pos.bars)
      else if (hitTarget) done = close(base, pos.target, bar.closeTime, bar, 'target', pos.bars)
      else if (r.maxBars > 0 && pos.bars >= r.maxBars) done = close(base, bar.close * (1 - dir * slip), bar.closeTime, bar, 'time', pos.bars)
      if (done) {
        trades.push(done)
        pos = null
      } else {
        const exit = bar.close
        pos.unrealised = (exit - pos.entry) * pos.qty * dir - (pos.entry + exit) * pos.qty * FEE_RATE
      }
    }

    // 3. When flat, look for a signal on this closed candle
    const inWindow = i >= FIRST_SIGNAL_BAR && (opts.signalFrom === undefined || bar.closeTime > opts.signalFrom)
    if (!pos && inWindow) {
      flatBars++
      from ??= bar.openTime
      to = bar.openTime
      const side = signal(i)
      if (side) pending = { side, bar: i }
      else checkpoint = bar.closeTime
    } else if (inWindow) {
      to = bar.openTime
    }
  }

  let pendingPlan: OpenSim | null = null
  if (pending && !pos) {
    const bar = c[pending.bar]
    const dir = pending.side === 'long' ? 1 : -1
    const fill = bar.close * (1 + dir * slip)
    const stop = stopFor(p, r, pending.bar, pending.side, fill)
    if (stop !== null) {
      // Opens at the next candle, whose open time is just after this one's close
      pendingPlan = { side: pending.side, entryTime: bar.closeTime + 1, entry: fill, stop, target: fill + dir * r.targetR * Math.abs(fill - stop), ...sizeTrade(r, fill, stop), bars: 0, unrealised: 0 }
    }
  }

  let open: OpenSim | null = null
  if (pos) {
    const { signalBar: _signalBar, ...rest } = pos
    void _signalBar
    open = rest
  }
  return { trades, open, pending: pending?.side ?? null, pendingPlan, flatBars, from, to, checkpoint }
}

// ---------------------------------------------------------------------------
// Honesty checks
// ---------------------------------------------------------------------------

/** Small seeded random number generator, so the comparison is the same every run */
const mulberry32 = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export const avgR = (trades: SimTrade[]): number | null =>
  trades.length === 0 ? null : trades.reduce((s, t) => s + t.r, 0) / trades.length

/** One pair's candles and the strategy's result on them */
export interface TestedSeries {
  p: Prepared
  result: SimResult
}

export interface RandomComparison {
  runs: number
  /** Median average R of the random runs */
  medianAvgR: number
  /** Share of random runs (0 to 1) that did at least as well as the strategy */
  beatShare: number
}

/**
 * The same stops, targets, sizing and fees, but entries on random candles,
 * about as often as the strategy entered on each pair. If random entries
 * often do as well, the entry rules are not what made the money.
 */
export const compareWithRandom = (series: TestedSeries[], r: StrategyRules, runs = 60, opts: SimOptions = {}): RandomComparison | null => {
  const actual = avgR(series.flatMap(s => s.result.trades))
  if (actual === null) return null
  const chances = series.map(({ result }) => result.flatBars > 0
    ? Math.min(1, (result.trades.length + (result.open ? 1 : 0)) / result.flatBars)
    : 0)
  const rand = mulberry32(12345)
  const sides: Side[] = r.direction === 'both' ? ['long', 'short'] : [r.direction]
  const scores: number[] = []
  for (let run = 0; run < runs; run++) {
    const trades: SimTrade[] = []
    series.forEach(({ p }, k) => {
      if (chances[k] === 0) return
      const sim = simulate(p, r, {
        signalFrom: opts.signalFrom,
        signal: () => (rand() < chances[k] ? sides[Math.floor(rand() * sides.length)] : null)
      })
      trades.push(...sim.trades)
    })
    const score = avgR(trades)
    if (score !== null) scores.push(score)
  }
  if (scores.length === 0) return null
  scores.sort((a, b) => a - b)
  const mid = Math.floor(scores.length / 2)
  return {
    runs: scores.length,
    medianAvgR: scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2,
    beatShare: scores.filter(s => s >= actual).length / scores.length
  }
}

export interface HalfStats { trades: number; avgR: number | null; net: number }

/** Results in the first and second half of the tested period, to see whether they hold up */
export const splitHalves = (trades: SimTrade[], from: number | null, to: number | null): [HalfStats, HalfStats] | null => {
  if (from === null || to === null) return null
  const mid = (from + to) / 2
  const stats = (ts: SimTrade[]): HalfStats => ({ trades: ts.length, avgR: avgR(ts), net: ts.reduce((s, t) => s + t.net, 0) })
  return [stats(trades.filter(t => t.entryTime <= mid)), stats(trades.filter(t => t.entryTime > mid))]
}

export interface RRange { low: number; high: number }

/**
 * Likely range (90%) of the true average R, from how much the trades vary:
 * average ± 1.645 standard errors. Wide with few trades, narrow with many.
 */
export const rRange = (trades: SimTrade[]): RRange | null => {
  const n = trades.length
  if (n < 5) return null
  const mean = trades.reduce((s, t) => s + t.r, 0) / n
  const variance = trades.reduce((s, t) => s + (t.r - mean) ** 2, 0) / (n - 1)
  const half = 1.645 * Math.sqrt(variance / n)
  return { low: mean - half, high: mean + half }
}

/** Average fees per trade, in R: what costs take from every trade before the market does anything */
export const feeDragR = (trades: SimTrade[]): number | null =>
  trades.length === 0 ? null : trades.reduce((s, t) => s + t.fees / t.risk, 0) / trades.length

/** Below this many trades a result says little */
export const MIN_TRADES_TO_JUDGE = 30

export type VerdictKind = 'none' | 'few' | 'losing' | 'eaten' | 'random' | 'unstable' | 'uncertain' | 'promising'

export interface Verdict { kind: VerdictKind; text: string }

const fmtR = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`

/**
 * One plain verdict. It always says what the trades suggest, even when there
 * are too few to be sure, and separates "the entries have no edge" from "the
 * entries have an edge that costs and exits eat".
 */
export const verdictFor = (
  trades: SimTrade[],
  random: RandomComparison | null,
  halves: [HalfStats, HalfStats] | null,
  range: RRange | null
): Verdict => {
  const n = trades.length
  const r = avgR(trades)
  if (n === 0 || r === null) {
    return { kind: 'none', text: 'No trades: the conditions never all held on one candle in this period. Switch one off, or test on 8 pairs.' }
  }
  const edge = random ? r - random.medianAvgR : null
  const beatsRandom = random !== null && random.beatShare <= 0.05 && edge !== null && edge > 0
  const vsRandom = beatsRandom ? `, ${fmtR(edge!)} better than random entries` : ''

  if (n < MIN_TRADES_TO_JUDGE) {
    return { kind: 'few', text: `${n} trade${n === 1 ? '' : 's'} is too few to be sure. So far: ${fmtR(r)} a trade${vsRandom}. Test on 8 pairs or a longer period to reach ${MIN_TRADES_TO_JUDGE}.` }
  }
  if (r <= 0) {
    if (beatsRandom && edge! >= 0.1) {
      const fees = feeDragR(trades)
      return {
        kind: 'eaten',
        text: `Loses ${fmtR(r)} a trade after fees, but beats random entries by ${fmtR(edge!)}. The entries pick better moments than chance; costs and exits take the rest${fees !== null ? ` (fees alone are ${fees.toFixed(2)}R a trade)` : ''}.`
      }
    }
    if (random && edge !== null && edge >= 0.05 && random.beatShare < 0.3) {
      return { kind: 'losing', text: `Loses ${fmtR(r)} a trade after fees. Random entries lose more (${fmtR(random.medianAvgR)}), so the entries may help a little, but not by enough to cover the costs.` }
    }
    return {
      kind: 'losing',
      text: random
        ? `Loses ${fmtR(r)} a trade after fees, about what random entries do (${fmtR(random.medianAvgR)}). These entry rules are not adding an edge here.`
        : `Loses ${fmtR(r)} a trade after fees.`
    }
  }
  if (random && random.beatShare >= 0.2) {
    return { kind: 'random', text: `Made ${fmtR(r)} a trade, but random entries with the same stops and targets did as well in ${Math.round(random.beatShare * 100)}% of runs. The entry rules may not be what made the money.` }
  }
  if (halves && halves.some(h => h.trades > 0 && (h.avgR ?? 0) <= 0)) {
    return { kind: 'unstable', text: `Made ${fmtR(r)} a trade overall, but not in both halves of the period. The result may not hold up.` }
  }
  if (range && range.low <= 0) {
    return { kind: 'uncertain', text: `Made ${fmtR(r)} a trade and beat random entries, but the likely range (${fmtR(range.low)} to ${fmtR(range.high)}) still includes losing. More trades would settle it.` }
  }
  return { kind: 'promising', text: `Promising: ${fmtR(r)} a trade, profitable in both halves and better than random entries. The real test is how it does from here, so start a forward test.` }
}
