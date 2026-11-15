/**
 * "Your edge": closed trades grouped by setup, pair, side, time and review
 * tags, plus plain-language findings drawn from those groups. Pure functions.
 */
import type { Trade } from '../firestoreService'
import { closedInOrder } from './analytics'
import { entryMoment, hasTimeOfDay, holdingMs, outcomeOf, rMultiple } from './tradeMath'
import { formatDuration, formatPnL, formatR, formatUsd } from '../../utils/format'

export interface GroupStats {
  key: string
  label: string
  trades: number
  wins: number
  losses: number
  /** Wins as a percentage of wins plus losses */
  winRate: number
  totalPnL: number
  avgPnL: number
  /** Average R of the trades in the group that have a stop loss */
  avgR: number | null
  rCount: number
  /** Identifies the exact set of trades, so two findings about the same trades can be spotted */
  signature: string
}

export type Dimension = 'setup' | 'pair' | 'side' | 'weekday' | 'session' | 'mindset' | 'plan' | 'mistake'

export const DIMENSIONS: { id: Dimension; label: string; empty: string }[] = [
  { id: 'setup', label: 'Setup', empty: 'Tag a setup on your trades to see which ones pay.' },
  { id: 'pair', label: 'Pair', empty: 'No closed trades yet.' },
  { id: 'side', label: 'Long / short', empty: 'No closed trades yet.' },
  { id: 'weekday', label: 'Day', empty: 'No closed trades yet.' },
  { id: 'session', label: 'Time of day', empty: 'Trades need an entry time to be grouped by time of day.' },
  { id: 'mindset', label: 'Mindset', empty: 'Tag how you felt going in to see how it affects your results.' },
  { id: 'plan', label: 'Plan', empty: 'Answer "Did you follow your plan?" on your trades to compare.' },
  { id: 'mistake', label: 'Mistakes', empty: 'Tag mistakes when you review a trade to see what they cost.' }
]

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const pad = (n: number) => String(n).padStart(2, '0')
/** Four-hour blocks of the local day */
const sessionOf = (hour: number) => {
  const start = Math.floor(hour / 4) * 4
  return { key: pad(start), label: `${pad(start)}:00 to ${pad(start + 4)}:00` }
}

/** The group(s) a trade belongs to on one dimension; none when it has no value there */
const keysOf = (t: Trade, dim: Dimension): { key: string; label: string }[] => {
  switch (dim) {
    case 'setup':
      return t.setup ? [{ key: t.setup.toLowerCase(), label: t.setup }] : []
    case 'pair':
      return [{ key: t.pair, label: t.pair }]
    case 'side':
      return [{ key: t.type, label: t.type === 'long' ? 'Long' : 'Short' }]
    case 'weekday': {
      const day = (entryMoment(t).getDay() + 6) % 7 // Monday first
      return [{ key: String(day), label: WEEKDAYS[day] }]
    }
    case 'session':
      return hasTimeOfDay(t.entryDate) ? [sessionOf(entryMoment(t).getHours())] : []
    case 'mindset':
      return t.mindset ? [{ key: t.mindset.toLowerCase(), label: t.mindset }] : []
    case 'plan':
      return t.followedPlan === true ? [{ key: 'yes', label: 'Followed the plan' }]
        : t.followedPlan === false ? [{ key: 'no', label: 'Went off-plan' }]
        : []
    case 'mistake':
      return (t.mistakes ?? []).map(m => ({ key: m.toLowerCase(), label: m }))
  }
}

const summarise = (key: string, label: string, trades: Trade[]): GroupStats => {
  let wins = 0, losses = 0, totalPnL = 0, rSum = 0, rCount = 0
  for (const t of trades) {
    totalPnL += t.profitLoss
    const outcome = outcomeOf(t)
    if (outcome === 'win') wins++
    else if (outcome === 'loss') losses++
    const r = rMultiple(t)
    if (r !== null) {
      rSum += r
      rCount++
    }
  }
  return {
    key, label, trades: trades.length, wins, losses,
    winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
    totalPnL,
    avgPnL: trades.length > 0 ? totalPnL / trades.length : 0,
    avgR: rCount > 0 ? rSum / rCount : null,
    rCount,
    signature: trades.map(t => t.id).sort().join(',')
  }
}

const groupBy = (trades: Trade[], keys: (t: Trade) => { key: string; label: string }[]): GroupStats[] => {
  const buckets = new Map<string, { label: string; trades: Trade[] }>()
  for (const t of trades) {
    for (const { key, label } of keys(t)) {
      const bucket = buckets.get(key) ?? { label, trades: [] }
      bucket.trades.push(t)
      buckets.set(key, bucket)
    }
  }
  return [...buckets.entries()].map(([key, b]) => summarise(key, b.label, b.trades))
}

export interface Breakdown {
  groups: GroupStats[]
  /** Closed trades with no value on this dimension (e.g. no setup tagged) */
  untagged: number
}

/** Closed trades grouped on one dimension. Days and times stay in calendar order; the rest are ranked by total result. */
export const breakdown = (trades: Trade[], dim: Dimension): Breakdown => {
  const closed = closedInOrder(trades)
  const groups = groupBy(closed, t => keysOf(t, dim))
  if (dim === 'weekday' || dim === 'session') groups.sort((a, b) => a.key.localeCompare(b.key))
  else groups.sort((a, b) => b.totalPnL - a.totalPnL)
  return { groups, untagged: closed.filter(t => keysOf(t, dim).length === 0).length }
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export interface Finding {
  id: string
  text: string
  /** Used to put the findings that moved the most money first */
  weight: number
  /** The trades the finding is about, when it is about one group */
  signature?: string
}

export interface EdgeFindings {
  closedTrades: number
  working: Finding[]
  costing: Finding[]
}

/** Closed trades needed before any finding is shown */
export const MIN_TRADES_FOR_FINDINGS = 5
/** Trades a group needs before it is called out */
const MIN_GROUP = 3
/** Findings shown in each list */
const MAX_FINDINGS = 5

/** R when most of the group has a stop loss, otherwise dollars */
const usesR = (g: GroupStats) => g.avgR !== null && g.rCount >= Math.ceil(g.trades * 0.6)
const measure = (g: GroupStats) => (usesR(g) ? (g.avgR as number) : g.avgPnL)
const avgText = (g: GroupStats) => (usesR(g) ? formatR(g.avgR as number) : formatPnL(g.avgPnL))
const lower = (label: string) => (label === label.toUpperCase() ? label : label.toLowerCase())

export const findings = (trades: Trade[]): EdgeFindings => {
  const closed = closedInOrder(trades)
  const working: Finding[] = []
  const costing: Finding[] = []
  if (closed.length < MIN_TRADES_FOR_FINDINGS) return { closedTrades: closed.length, working, costing }

  const sized = (dim: Dimension, min = MIN_GROUP) => breakdown(closed, dim).groups.filter(g => g.trades >= min)
  const best = (groups: GroupStats[]) => groups.filter(g => measure(g) > 0).sort((a, b) => measure(b) - measure(a))[0]
  const worst = (groups: GroupStats[]) => groups.filter(g => measure(g) < 0).sort((a, b) => measure(a) - measure(b))[0]
  const weight = (g: GroupStats) => Math.abs(g.totalPnL)

  // Setups
  const setups = sized('setup')
  const bestSetup = best(setups)
  const worstSetup = worst(setups)
  if (bestSetup) {
    working.push({
      id: 'setup-best', weight: weight(bestSetup), signature: bestSetup.signature,
      text: `${bestSetup.label} is your best setup: ${bestSetup.wins} of ${bestSetup.trades} won, averaging ${avgText(bestSetup)} a trade.`
    })
  }
  if (worstSetup) {
    costing.push({
      id: 'setup-worst', weight: weight(worstSetup), signature: worstSetup.signature,
      text: `${worstSetup.label} is losing money: ${worstSetup.losses} of ${worstSetup.trades} lost, averaging ${avgText(worstSetup)} a trade.`
    })
  }

  // Mindset
  const mindsets = sized('mindset')
  const bestMind = best(mindsets)
  const worstMind = worst(mindsets)
  if (bestMind) {
    working.push({
      id: 'mindset-best', weight: weight(bestMind), signature: bestMind.signature,
      text: `You trade best when ${lower(bestMind.label)}: ${avgText(bestMind)} a trade over ${bestMind.trades} trades.`
    })
  }
  if (worstMind) {
    costing.push({
      id: 'mindset-worst', weight: weight(worstMind), signature: worstMind.signature,
      text: `Trades taken feeling ${lower(worstMind.label)} average ${avgText(worstMind)} (${worstMind.trades} trades).`
    })
  }

  // Following the plan
  const plan = sized('plan')
  const onPlan = plan.find(g => g.key === 'yes')
  const offPlan = plan.find(g => g.key === 'no')
  if (onPlan && offPlan) {
    const text = `On-plan trades win ${onPlan.winRate.toFixed(0)}% and average ${avgText(onPlan)}; off-plan trades win ${offPlan.winRate.toFixed(0)}% and average ${avgText(offPlan)}.`
    if (measure(offPlan) < measure(onPlan)) {
      costing.push({ id: 'plan', weight: weight(offPlan), signature: offPlan.signature, text: `Going off-plan costs you. ${text}` })
    } else {
      working.push({ id: 'plan', weight: weight(offPlan), text })
    }
  }

  // The most expensive mistake
  const mistake = sized('mistake', 2).filter(g => g.totalPnL < 0).sort((a, b) => a.totalPnL - b.totalPnL)[0]
  if (mistake) {
    costing.push({
      id: 'mistake', weight: weight(mistake), signature: mistake.signature,
      text: `"${mistake.label}" is tagged on ${mistake.trades} trades that lost ${formatUsd(mistake.totalPnL)} in total.`
    })
  }

  // One side of one pair
  const pairSides = groupBy(closed, t => [{ key: `${t.pair}|${t.type}`, label: `${t.type === 'long' ? 'Longs' : 'Shorts'} on ${t.pair.split('/')[0]}` }])
    .filter(g => g.trades >= 4)
  const bestPairSide = [...pairSides].filter(g => g.totalPnL > 0).sort((a, b) => b.totalPnL - a.totalPnL)[0]
  const worstPairSide = [...pairSides].filter(g => g.totalPnL < 0).sort((a, b) => a.totalPnL - b.totalPnL)[0]
  if (bestPairSide) {
    working.push({
      id: 'pair-side-best', weight: weight(bestPairSide), signature: bestPairSide.signature,
      text: `${bestPairSide.label} have won ${bestPairSide.wins} of ${bestPairSide.trades} (${formatPnL(bestPairSide.totalPnL)}).`
    })
  }
  if (worstPairSide) {
    costing.push({
      id: 'pair-side-worst', weight: weight(worstPairSide), signature: worstPairSide.signature,
      text: `${worstPairSide.label} have lost ${worstPairSide.losses} of ${worstPairSide.trades} (${formatPnL(worstPairSide.totalPnL)}).`
    })
  }

  // Days and times, only when there is more than one to compare
  const timing: [Dimension, (g: GroupStats) => string, (g: GroupStats) => string][] = [
    ['weekday', g => `${g.label} is your best day`, g => `${g.label} is your worst day`],
    ['session', g => `Your best entries come between ${g.label.replace(' to ', ' and ')}`, g => `Entries between ${g.label.replace(' to ', ' and ')} are your worst`]
  ]
  for (const [dim, good, bad] of timing) {
    const groups = sized(dim)
    if (groups.length < 2) continue
    const top = [...groups].filter(g => g.totalPnL > 0).sort((a, b) => b.totalPnL - a.totalPnL)[0]
    const bottom = [...groups].filter(g => g.totalPnL < 0).sort((a, b) => a.totalPnL - b.totalPnL)[0]
    if (top) working.push({ id: `${dim}-best`, weight: weight(top) / 2, text: `${good(top)}: ${formatPnL(top.totalPnL)} over ${top.trades} trades.` })
    if (bottom) costing.push({ id: `${dim}-worst`, weight: weight(bottom) / 2, text: `${bad(bottom)}: ${formatPnL(bottom.totalPnL)} over ${bottom.trades} trades.` })
  }

  // Holding winners against losers
  const holds = (outcome: 'win' | 'loss') =>
    closed.filter(t => outcomeOf(t) === outcome).map(holdingMs).filter((ms): ms is number => ms !== null)
  const winHolds = holds('win')
  const lossHolds = holds('loss')
  if (winHolds.length >= MIN_GROUP && lossHolds.length >= MIN_GROUP) {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const w = avg(winHolds)
    const l = avg(lossHolds)
    const total = Math.abs(closed.reduce((sum, t) => sum + t.profitLoss, 0))
    if (l > w * 1.5) {
      costing.push({ id: 'hold', weight: total / 2, text: `You hold losers longer than winners: ${formatDuration(l)} against ${formatDuration(w)} on average.` })
    } else if (w > l * 1.5) {
      working.push({ id: 'hold', weight: total / 2, text: `You cut losers quickly and let winners run: ${formatDuration(l)} against ${formatDuration(w)} on average.` })
    }
  }

  // Losses bigger than the planned risk
  const lossRs = closed.filter(t => outcomeOf(t) === 'loss').map(rMultiple).filter((r): r is number => r !== null)
  if (lossRs.length >= MIN_GROUP) {
    const avgLossR = lossRs.reduce((a, b) => a + b, 0) / lossRs.length
    if (avgLossR < -1.15) {
      const lost = closed.filter(t => outcomeOf(t) === 'loss').reduce((sum, t) => sum + t.profitLoss, 0)
      costing.push({
        id: 'loss-size', weight: Math.abs(lost) / 2,
        text: `Your average loss is ${formatR(avgLossR)}. A loss bigger than 1R means the stop was moved or missed.`
      })
    }
  }

  // Fees
  const fees = closed.reduce((sum, t) => sum + (t.fees || 0), 0)
  const beforeFees = closed.reduce((sum, t) => sum + t.profitLoss, 0) + fees
  if (fees > 0 && beforeFees > 0 && fees / beforeFees >= 0.25) {
    costing.push({
      id: 'fees', weight: fees,
      text: `Fees took ${Math.min(100, (fees / beforeFees) * 100).toFixed(0)}% of your profit before fees (${formatUsd(fees)}).`
    })
  }

  // Biggest money first. When several findings describe exactly the same trades
  // (same setup, mindset and mistake on each), two are enough.
  const top = (list: Finding[]) => {
    const seen = new Map<string, number>()
    return list
      .sort((a, b) => b.weight - a.weight)
      .filter(f => {
        if (!f.signature) return true
        const count = seen.get(f.signature) ?? 0
        seen.set(f.signature, count + 1)
        return count < 2
      })
      .slice(0, MAX_FINDINGS)
  }
  return { closedTrades: closed.length, working: top(working), costing: top(costing) }
}
