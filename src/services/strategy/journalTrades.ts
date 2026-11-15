/** Simulated trades as Journal trades, so the Journal's statistics and charts work on them */
import type { NewTrade, Trade } from '../firestoreService'
import { classifyOutcome, toStoredDate } from '../journal/tradeMath'
import { MAX_SETUP_LENGTH } from '../../config/journalTags'
import type { SimTrade } from './engine'
import type { StrategyRules } from './types'

const REASONS: Record<SimTrade['reason'], string> = {
  stop: 'closed at the stop',
  target: 'closed at the target',
  time: 'closed at the time limit'
}

/** Identifies a bot trade, so it is never sent to the Journal twice */
export const botImportId = (strategyId: string, version: number, entryTime: number) =>
  `bot-${strategyId}-v${version}-${entryTime}`

export const simToNewTrade = (
  t: SimTrade,
  rules: StrategyRules,
  meta: { name: string; version: number; strategyId: string } | null
): NewTrade => {
  const margin = (t.entry * t.qty) / t.leverage
  return {
    pair: rules.pair,
    type: t.side,
    entryPrice: t.entry,
    exitPrice: t.exit,
    quantity: t.qty,
    quantityType: 'base',
    entryDate: toStoredDate(new Date(t.entryTime)),
    exitDate: toStoredDate(new Date(t.exitTime)),
    stopLoss: t.stop,
    takeProfit: t.target,
    leverage: t.leverage,
    exchange: 'bybit',
    market: 'futures',
    status: 'closed',
    outcome: classifyOutcome(t.net, t.gross),
    profitLoss: t.net,
    profitLossPercent: margin > 0 ? (t.net / margin) * 100 : 0,
    fees: t.fees,
    feesManual: true,
    notes: meta
      ? `Paper trade by the "${meta.name}" bot (version ${meta.version}), ${REASONS[t.reason]}.`
      : `Backtest trade, ${REASONS[t.reason]}.`,
    tags: meta ? [`Bot v${meta.version}`] : [],
    screenshots: [],
    source: 'bot',
    isPractice: true,
    followedPlan: true,
    ...(meta ? { setup: meta.name.slice(0, MAX_SETUP_LENGTH), importId: botImportId(meta.strategyId, meta.version, t.entryTime) } : {})
  }
}

/** A simulated trade as a full Trade object (for the statistics, never saved) */
export const simToTrade = (t: SimTrade, rules: StrategyRules, index: number): Trade => {
  const stamp = new Date(t.exitTime).toISOString()
  return { ...simToNewTrade(t, rules, null), id: `sim-${index}`, userId: '', createdAt: stamp, updatedAt: stamp }
}
