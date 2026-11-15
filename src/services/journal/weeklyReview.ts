/**
 * AI review of a trading period. Only summary numbers and tag counts are sent
 * to the model - never notes, chart links or anything typed by the user.
 */
import { generate } from '../ai/aiService'
import type { Trade } from '../firestoreService'
import { closedInOrder, computeAnalytics } from './analytics'
import { breakdown, findings } from './edge'
import { checkRules, hasAnyRule, summariseRules } from './rules'
import type { TradingRules } from './rules'
import { closeMoment, rMultiple } from './tradeMath'
import { formatDuration, formatPnL, formatR, formatUsd } from '../../utils/format'

export type ReviewPeriod = 7 | 30

export interface ReviewContent {
  headline: string
  wentWell: string[]
  leak: string
  nextRule: string
}

export interface WeeklyReview {
  periodDays: ReviewPeriod
  generatedAt: number
  closedTrades: number
  review: ReviewContent | null
  rawText: string
  providerName: string
  model: string
}

/** Closed trades whose close falls in the last `days` days (or the period before that) */
export const tradesInPeriod = (trades: Trade[], days: number, now = new Date(), periodsBack = 0): Trade[] => {
  const end = now.getTime() - periodsBack * days * 86_400_000
  const start = end - days * 86_400_000
  return closedInOrder(trades).filter(t => {
    const at = closeMoment(t).getTime()
    return at > start && at <= end
  })
}

// Tags are chosen from fixed lists or short typed setups; trim anything long
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').slice(0, 40)

/** The plain-text fact sheet the model sees */
export const reviewFacts = (trades: Trade[], rules: TradingRules, days: ReviewPeriod, now = new Date()): string => {
  const period = tradesInPeriod(trades, days, now)
  const previous = tradesInPeriod(trades, days, now, 1)
  const a = computeAnalytics(period, now)
  const p = computeAnalytics(previous, now)
  const lines: string[] = []

  lines.push(`Period: the last ${days} days. Closed trades: ${a.closedTrades}.`)
  lines.push(`Wins ${a.wins}, losses ${a.losses}, breakeven ${a.breakevens}. Win rate ${a.winRate.toFixed(0)}%.`)
  lines.push(`Net result after fees: ${formatPnL(a.totalPnL)}. Fees paid: ${formatUsd(a.totalFees)}.`)
  lines.push(`Profit factor: ${a.profitFactor === Infinity ? 'no losses' : a.profitFactor.toFixed(2)}. Average win ${formatPnL(a.avgWin)}, average loss ${formatPnL(-a.avgLoss)}.`)
  if (a.avgR !== null) lines.push(`Average R (result per unit of risk, ${a.rCount} trades with a stop): ${formatR(a.avgR)}.`)
  if (a.avgHoldMs !== null) lines.push(`Average time in a trade: ${formatDuration(a.avgHoldMs)}.`)
  lines.push(`Longest losing run: ${a.worstLossStreak}. Deepest drawdown: ${formatUsd(a.maxDrawdown)}.`)
  lines.push(p.closedTrades > 0
    ? `Previous ${days} days for comparison: ${p.closedTrades} trades, win rate ${p.winRate.toFixed(0)}%, net ${formatPnL(p.totalPnL)}.`
    : `Previous ${days} days: no closed trades.`)

  const best = [...period].sort((x, y) => y.profitLoss - x.profitLoss)[0]
  const worst = [...period].sort((x, y) => x.profitLoss - y.profitLoss)[0]
  const tradeLine = (t: Trade) => {
    const r = rMultiple(t)
    return `${t.pair} ${t.type}, ${formatPnL(t.profitLoss)}${r === null ? '' : ` (${formatR(r)})`}${t.setup ? `, setup ${clean(t.setup)}` : ''}${t.mindset ? `, felt ${clean(t.mindset)}` : ''}`
  }
  if (best && best.profitLoss > 0) lines.push(`Best trade: ${tradeLine(best)}.`)
  if (worst && worst.profitLoss < 0) lines.push(`Worst trade: ${tradeLine(worst)}.`)

  const groupLines = (dim: 'setup' | 'mindset' | 'mistake' | 'plan' | 'pair', title: string) => {
    const groups = breakdown(period, dim).groups.slice(0, 4)
    if (groups.length === 0) return
    lines.push(`${title}: ${groups.map(g => `${clean(g.label)} ${g.trades} trades, ${g.wins}W/${g.losses}L, net ${formatPnL(g.totalPnL)}`).join('; ')}.`)
  }
  groupLines('setup', 'By setup')
  groupLines('mindset', 'By mindset')
  groupLines('plan', 'By plan')
  groupLines('mistake', 'Mistakes tagged')
  groupLines('pair', 'By pair')

  if (hasAnyRule(rules)) {
    const s = summariseRules(period, checkRules(period, rules))
    lines.push(`Personal rules broken: ${s.brokenClosed} of ${a.closedTrades} closed trades (net ${formatPnL(s.brokenPnL)} on those, ${formatPnL(s.keptPnL)} on the rest).`)
  } else {
    lines.push('The trader has not set any personal rules yet.')
  }

  const f = findings(trades)
  if (f.working.length + f.costing.length > 0) {
    lines.push('Patterns across all their closed trades:')
    for (const x of f.working) lines.push(`- Working: ${x.text}`)
    for (const x of f.costing) lines.push(`- Costing: ${x.text}`)
  }
  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are a calm, practical trading coach reviewing a retail crypto trader's journal.

Rules:
- Use ONLY the facts given. Do not invent trades, numbers, markets or news.
- Coach the process (risk, discipline, setups, mindset, rules), not the market. Never tell them to buy or sell a coin.
- Be specific: quote the numbers from the facts that support each point.
- Be honest but kind. One clear leak, not a list of everything wrong.
- The next rule must be concrete and checkable, e.g. "Risk at most 1% per trade" or "No trades after two losses in a day".
- If there are very few trades, say the sample is small.
- Plain English, short sentences.

Reply with a JSON object exactly in this shape:
{
  "headline": "one sentence summary of the period, max 20 words",
  "wentWell": ["1-3 short points"],
  "leak": "the single biggest thing costing them, with numbers",
  "nextRule": "one concrete rule to follow next period"
}`

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 3) : []

export const parseReview = (text: string): ReviewContent | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const o = JSON.parse(text.slice(start, end + 1))
    const review: ReviewContent = {
      headline: typeof o?.headline === 'string' ? o.headline : '',
      wentWell: asList(o?.wentWell),
      leak: typeof o?.leak === 'string' ? o.leak : '',
      nextRule: typeof o?.nextRule === 'string' ? o.nextRule : ''
    }
    return review.headline || review.leak || review.nextRule ? review : null
  } catch {
    return null
  }
}

// One saved review per user and period, until their closed trades change
const CACHE_KEY = 'ai-journal-review-v1'

/** Changes whenever a closed trade in the period is added, edited or removed */
export const periodSignature = (trades: Trade[], days: ReviewPeriod, now = new Date()): string =>
  tradesInPeriod(trades, days, now).map(t => `${t.id}:${t.updatedAt}:${t.profitLoss}`).join('|')

const readCache = (): Record<string, { signature: string; review: WeeklyReview }> => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

export const getCachedReview = (userId: string, days: ReviewPeriod, signature: string): WeeklyReview | null => {
  const entry = readCache()[`${userId}:${days}`]
  return entry && entry.signature === signature ? entry.review : null
}

export const generateReview = async (
  userId: string, trades: Trade[], rules: TradingRules, days: ReviewPeriod, signal?: AbortSignal
): Promise<WeeklyReview> => {
  const now = new Date()
  const facts = reviewFacts(trades, rules, days, now)
  const result = await generate({ system: SYSTEM_PROMPT, prompt: `Journal facts:\n\n${facts}`, json: true, signal })
  const review: WeeklyReview = {
    periodDays: days,
    generatedAt: Date.now(),
    closedTrades: tradesInPeriod(trades, days, now).length,
    review: parseReview(result.text),
    rawText: result.text,
    providerName: result.providerName,
    model: result.model
  }
  try {
    const cache = readCache()
    cache[`${userId}:${days}`] = { signature: periodSignature(trades, days, now), review }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // The cache only saves repeat requests
  }
  return review
}
