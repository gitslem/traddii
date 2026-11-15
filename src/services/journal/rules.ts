/**
 * Personal trading rules, checked against every trade in the Journal and used
 * by the Calculator as limits. Pure functions; storage is in rulesStore.ts.
 */
import type { Trade } from '../firestoreService'
import { closedInOrder } from './analytics'
import { closeMoment, entryMoment, hasTimeOfDay, localDayKey, riskAmount } from './tradeMath'
import { formatPnL, formatUsd } from '../../utils/format'

export interface TradingRules {
  /** Account size the risk limit is measured against, in USDT */
  accountSize: number | null
  /** Most of the account to risk on one trade, in percent */
  maxRiskPercent: number | null
  maxTradesPerDay: number | null
  /** Stop trading for the day after losing this much, in USDT */
  dailyLossLimit: number | null
  maxLeverage: number | null
  /** Every trade needs a stop loss */
  requireStop: boolean
}

export const EMPTY_RULES: TradingRules = {
  accountSize: null,
  maxRiskPercent: null,
  maxTradesPerDay: null,
  dailyLossLimit: null,
  maxLeverage: null,
  requireStop: false
}

export const hasAnyRule = (r: TradingRules): boolean =>
  r.maxRiskPercent !== null || r.maxTradesPerDay !== null || r.dailyLossLimit !== null || r.maxLeverage !== null || r.requireStop

const positive = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

/** Rules read from the account, with anything missing or invalid left unset */
export const normaliseRules = (raw: unknown): TradingRules => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    accountSize: positive(r.accountSize),
    maxRiskPercent: positive(r.maxRiskPercent),
    maxTradesPerDay: positive(r.maxTradesPerDay) === null ? null : Math.floor(r.maxTradesPerDay as number),
    dailyLossLimit: positive(r.dailyLossLimit),
    maxLeverage: positive(r.maxLeverage),
    requireStop: r.requireStop === true
  }
}

// ---------------------------------------------------------------------------
// Checking trades against the rules
// ---------------------------------------------------------------------------

export type RuleId = 'risk' | 'stop' | 'leverage' | 'trades' | 'dailyLoss'

export interface RuleBreak {
  rule: RuleId
  text: string
}

/** Small rounding in sizing should not count as breaking a risk limit */
const RISK_TOLERANCE = 1.02

/** The rules each trade broke, by trade id. Trades that broke none are left out. */
export const checkRules = (trades: Trade[], rules: TradingRules): Map<string, RuleBreak[]> => {
  const breaks = new Map<string, RuleBreak[]>()
  const add = (t: Trade, rule: RuleId, text: string) => {
    const list = breaks.get(t.id) ?? []
    list.push({ rule, text })
    breaks.set(t.id, list)
  }

  const maxRisk = rules.accountSize && rules.maxRiskPercent ? rules.accountSize * rules.maxRiskPercent / 100 : null
  for (const t of trades) {
    if (maxRisk !== null) {
      const risk = riskAmount(t)
      if (risk !== null && risk > maxRisk * RISK_TOLERANCE) {
        add(t, 'risk', `Risked ${formatUsd(risk)}, above your ${rules.maxRiskPercent}% limit of ${formatUsd(maxRisk)}.`)
      }
    }
    if (rules.requireStop && !(t.stopLoss && t.stopLoss > 0)) add(t, 'stop', 'No stop loss.')
    if (rules.maxLeverage !== null && t.leverage > rules.maxLeverage) {
      add(t, 'leverage', `${t.leverage}x leverage, above your ${rules.maxLeverage}x limit.`)
    }
  }

  // Trades per day: everything past the limit on a calendar day, in entry order
  if (rules.maxTradesPerDay !== null) {
    const byDay = new Map<string, Trade[]>()
    for (const t of trades) {
      const key = localDayKey(entryMoment(t))
      byDay.set(key, [...(byDay.get(key) ?? []), t])
    }
    for (const dayTrades of byDay.values()) {
      if (dayTrades.length <= rules.maxTradesPerDay) continue
      dayTrades
        .sort((a, b) => entryMoment(a).getTime() - entryMoment(b).getTime() || (a.createdAt || '').localeCompare(b.createdAt || ''))
        .slice(rules.maxTradesPerDay)
        .forEach((t, i) => add(t, 'trades', `Trade ${rules.maxTradesPerDay! + i + 1} of the day; your limit is ${rules.maxTradesPerDay}.`))
    }
  }

  // Daily loss: a trade opened after that day's closed losses had reached the limit
  if (rules.dailyLossLimit !== null) {
    const closed = closedInOrder(trades).filter(t => hasTimeOfDay(t.exitDate))
    for (const t of trades) {
      if (!hasTimeOfDay(t.entryDate)) continue
      const entered = entryMoment(t)
      const day = localDayKey(entered)
      const lostBefore = closed
        .filter(c => c.id !== t.id && localDayKey(closeMoment(c)) === day && closeMoment(c).getTime() <= entered.getTime())
        .reduce((sum, c) => sum + c.profitLoss, 0)
      if (lostBefore <= -rules.dailyLossLimit) {
        add(t, 'dailyLoss', `Opened after losing ${formatUsd(lostBefore)} that day; your daily limit is ${formatUsd(rules.dailyLossLimit)}.`)
      }
    }
  }

  return breaks
}

export interface RulesSummary {
  /** Closed trades that broke at least one rule */
  brokenClosed: number
  brokenPnL: number
  /** Closed trades that broke none */
  keptClosed: number
  keptPnL: number
  /** How many trades broke each rule */
  byRule: Partial<Record<RuleId, number>>
}

export const summariseRules = (trades: Trade[], breaks: Map<string, RuleBreak[]>): RulesSummary => {
  const summary: RulesSummary = { brokenClosed: 0, brokenPnL: 0, keptClosed: 0, keptPnL: 0, byRule: {} }
  for (const t of trades) {
    const list = breaks.get(t.id)
    for (const b of list ?? []) summary.byRule[b.rule] = (summary.byRule[b.rule] ?? 0) + 1
    if (t.status !== 'closed') continue
    if (list) {
      summary.brokenClosed++
      summary.brokenPnL += t.profitLoss
    } else {
      summary.keptClosed++
      summary.keptPnL += t.profitLoss
    }
  }
  return summary
}

/** One sentence comparing trades that kept the rules with those that broke them */
export const rulesVerdict = (s: RulesSummary): string | null => {
  if (s.brokenClosed === 0) return s.keptClosed > 0 ? `All ${s.keptClosed} closed trades kept your rules.` : null
  const avg = (total: number, n: number) => (n > 0 ? formatPnL(total / n) : '—')
  return `${s.brokenClosed} closed trade${s.brokenClosed === 1 ? '' : 's'} broke a rule (net ${formatPnL(s.brokenPnL)}, ${avg(s.brokenPnL, s.brokenClosed)} a trade). ` +
    `Trades that kept them: net ${formatPnL(s.keptPnL)}, ${avg(s.keptPnL, s.keptClosed)} a trade.`
}
