/** A trading strategy written as rules the backtester and the paper bot can run */
import { POPULAR_PAIRS } from '../../config/pairs'

export type Timeframe = '15m' | '1h' | '4h' | '1d'
export type Direction = 'long' | 'short' | 'both'
/** What the last closed candle must show */
export type CandleRule = 'any' | 'pattern' | 'engulfing' | 'pinbar'
/** Where the stop goes: beyond the last swing point, or a multiple of the average range */
export type StopRule = 'swing' | 'atr'

export interface StrategyRules {
  /** The main pair (the only one unless basket is on) */
  pair: string
  /** Also run on the 8 most traded pairs: more trades, and a test that the idea is not specific to one coin */
  basket: boolean
  timeframe: Timeframe
  direction: Direction

  // Entry conditions, checked on each closed candle (all that are switched on must hold)
  /** The trend on this timeframe points the same way as the trade */
  withTrend: boolean
  /** The trend on the next timeframe up points the same way as the trade */
  withHigherTrend: boolean
  candle: CandleRule
  /** The close is within one average range of a swing level on the right side */
  nearLevel: boolean
  /** The candle's volume is above the average of the 20 before it */
  volumeAbove: boolean

  // Exits
  stop: StopRule
  /** Stop distance in average ranges (ATR) when stop is 'atr' */
  stopAtr: number
  /** Take profit at this many times the stop distance */
  targetR: number
  /** Close at the candle's close after this many candles; 0 = no time limit */
  maxBars: number

  // Money
  accountSize: number
  riskPercent: number
  maxLeverage: number
  /** Price slippage on market entries and stop exits, in percent */
  slippagePercent: number
}

/** A strategy saved to the user's account and paper-trading forward */
export interface SavedStrategy extends StrategyRules {
  id: string
  name: string
  /** Goes up each time the rules change; trades are kept per version */
  version: number
  createdAt: string
  /** Rules were locked at this time (ms): only candles closing after it can open trades */
  forwardFrom: number
  /** Paused strategies are not replayed */
  active: boolean
  /** Also place the bot's entries on the user's Bybit Demo (or testnet) account, from the browser */
  mirror: boolean
  /** Mirroring was switched on at this time (ms); earlier bot entries are never mirrored */
  mirrorSince: number
  /** Where each pair's forward test has got to, keyed by symbol (e.g. BTCUSDT) */
  progress: Record<string, PairProgress>
  /** Running totals of the closed forward-test trades of this version */
  stats: ForwardStats
}

export interface PairProgress {
  /** The next replay starts signalling after this time (ms) */
  checkpoint: number
  /** Trades that closed up to this time (ms) are already counted and in the Journal */
  journaledThrough: number
  /** Entry time of the last open trade an alert was sent for */
  openAlerted?: number
  /** Entry time of the last bot entry handled for Bybit Demo mirroring */
  mirrored?: number
  /** Entry time of the bot trade whose Demo position is believed open (0 = none) */
  mirrorOpen?: number
  /** What happened to the last mirrored entry, in plain words */
  mirrorNote?: string
}

export interface ForwardStats {
  trades: number
  wins: number
  sumR: number
  net: number
}

export const EMPTY_STATS: ForwardStats = { trades: 0, wins: 0, sumR: 0, net: 0 }

/** Pairs a basket test runs on: the 8 most traded, plus the main pair if it is not one of them */
export const BASKET_SIZE = 8
export const pairsFor = (r: Pick<StrategyRules, 'pair' | 'basket'>): string[] => {
  if (!r.basket) return [r.pair]
  const top = POPULAR_PAIRS.slice(0, BASKET_SIZE)
  return top.includes(r.pair) ? [r.pair, ...top.filter(p => p !== r.pair)] : [r.pair, ...top]
}

export const DEFAULT_RULES: StrategyRules = {
  pair: 'BTC/USDT',
  basket: false,
  timeframe: '1h',
  direction: 'both',
  withTrend: true,
  withHigherTrend: true,
  candle: 'pattern',
  nearLevel: false,
  volumeAbove: false,
  stop: 'swing',
  stopAtr: 1.5,
  targetR: 2,
  maxBars: 0,
  accountSize: 10_000,
  riskPercent: 1,
  maxLeverage: 10,
  slippagePercent: 0.05
}

export const TIMEFRAMES: { id: Timeframe; label: string; higher: string }[] = [
  { id: '15m', label: '15m', higher: '1H' },
  { id: '1h', label: '1H', higher: '4H' },
  { id: '4h', label: '4H', higher: '1D' },
  { id: '1d', label: '1D', higher: '1W' }
]

export const CANDLE_RULES: { id: CandleRule; label: string }[] = [
  { id: 'any', label: 'Any candle' },
  { id: 'pattern', label: 'Any strong pattern' },
  { id: 'engulfing', label: 'Engulfing' },
  { id: 'pinbar', label: 'Pin bar' }
]

export const hasEntryCondition = (r: StrategyRules): boolean =>
  r.withTrend || r.withHigherTrend || r.candle !== 'any' || r.nearLevel || r.volumeAbove

/** Problems that stop the rules from running, in plain words; empty when fine */
export const rulesProblems = (r: StrategyRules): string[] => {
  const problems: string[] = []
  if (!hasEntryCondition(r)) problems.push('Switch on at least one entry condition, or the bot would trade every candle.')
  if (r.stop === 'atr' && !(r.stopAtr >= 0.2 && r.stopAtr <= 10)) problems.push('The ATR stop must be between 0.2 and 10.')
  if (!(r.targetR >= 0.2 && r.targetR <= 20)) problems.push('The target must be between 0.2R and 20R.')
  if (!(Number.isInteger(r.maxBars) && r.maxBars >= 0 && r.maxBars <= 1000)) problems.push('"Close after" must be a whole number of candles, 0 to 1000.')
  if (!(r.accountSize >= 10 && r.accountSize <= 1e9)) problems.push('The account size must be at least 10 USDT.')
  if (!(r.riskPercent > 0 && r.riskPercent <= 10)) problems.push('Risk per trade must be above 0% and at most 10%.')
  if (!(r.maxLeverage >= 1 && r.maxLeverage <= 100)) problems.push('Max leverage must be between 1x and 100x.')
  if (!(r.slippagePercent >= 0 && r.slippagePercent <= 2)) problems.push('Slippage must be between 0% and 2%.')
  return problems
}

/** One line describing the entry rules, e.g. "Long when the 1H and 4H trends are up and the candle shows a strong pattern" */
export const describeRules = (r: StrategyRules): string => {
  const tf = TIMEFRAMES.find(t => t.id === r.timeframe) ?? TIMEFRAMES[1]
  const side = r.direction === 'both' ? 'Long or short' : r.direction === 'long' ? 'Long' : 'Short'
  const market = r.basket ? `${r.pair} and ${pairsFor(r).length - 1} more pairs` : r.pair
  const parts: string[] = []
  if (r.withTrend && r.withHigherTrend) parts.push(`the ${tf.label} and ${tf.higher} trends agree`)
  else if (r.withTrend) parts.push(`the ${tf.label} trend agrees`)
  else if (r.withHigherTrend) parts.push(`the ${tf.higher} trend agrees`)
  if (r.candle === 'pattern') parts.push('the candle shows a strong pattern')
  if (r.candle === 'engulfing') parts.push('the candle is an engulfing')
  if (r.candle === 'pinbar') parts.push('the candle is a pin bar')
  if (r.nearLevel) parts.push('price is near a level')
  if (r.volumeAbove) parts.push('volume is above average')
  const stop = r.stop === 'swing' ? 'stop beyond the last swing' : `stop ${r.stopAtr} ATR away`
  const exit = `${stop}, target ${r.targetR}R${r.maxBars > 0 ? `, close after ${r.maxBars} candles` : ''}`
  const when = parts.length === 0 ? '' : ` when ${parts.slice(0, -1).join(', ')}${parts.length > 1 ? ' and ' : ''}${parts.at(-1)}`
  return `${side} ${market} on ${tf.label}${when}. ${exit[0].toUpperCase()}${exit.slice(1)}.`
}

/**
 * Starting points covering common ideas, not recommendations. Each is a
 * full set of rules; the money settings are left as they are.
 */
export const PRESETS: { id: string; name: string; text: string; rules: Partial<StrategyRules> }[] = [
  {
    id: 'trend-pattern',
    name: 'Trend + pattern',
    text: 'Both trends agree and the candle shows a strong pattern',
    rules: { direction: 'both', withTrend: true, withHigherTrend: true, candle: 'pattern', nearLevel: false, volumeAbove: false, stop: 'swing', targetR: 2, maxBars: 0 }
  },
  {
    id: 'pullback',
    name: 'Pullback to a level',
    text: 'In a trend on both timeframes, price dips back to a swing level',
    rules: { direction: 'both', withTrend: true, withHigherTrend: true, candle: 'any', nearLevel: true, volumeAbove: false, stop: 'atr', stopAtr: 1.5, targetR: 2, maxBars: 0 }
  },
  {
    id: 'reversal',
    name: 'Rejection at a level',
    text: 'A pin bar at a swing level, against or with the trend',
    rules: { direction: 'both', withTrend: false, withHigherTrend: false, candle: 'pinbar', nearLevel: true, volumeAbove: false, stop: 'swing', targetR: 1.5, maxBars: 0 }
  },
  {
    id: 'momentum',
    name: 'Momentum with volume',
    text: 'Higher-timeframe trend, a strong candle and above-average volume, held at most 24 candles',
    rules: { direction: 'both', withTrend: false, withHigherTrend: true, candle: 'pattern', nearLevel: false, volumeAbove: true, stop: 'atr', stopAtr: 1, targetR: 2, maxBars: 24 }
  }
]
