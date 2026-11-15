import type { StrategyRules } from '../../services/strategy/types'

/** Number inputs are kept as typed text, so a half-typed value like "1." is not lost */
export type RulesDraft = Omit<StrategyRules, 'stopAtr' | 'targetR' | 'maxBars' | 'accountSize' | 'riskPercent' | 'maxLeverage' | 'slippagePercent'> & {
  stopAtr: string
  targetR: string
  maxBars: string
  accountSize: string
  riskPercent: string
  maxLeverage: string
  slippagePercent: string
}

export const toDraft = (r: StrategyRules): RulesDraft => ({
  ...r,
  stopAtr: String(r.stopAtr),
  targetR: String(r.targetR),
  maxBars: String(r.maxBars),
  accountSize: String(r.accountSize),
  riskPercent: String(r.riskPercent),
  maxLeverage: String(r.maxLeverage),
  slippagePercent: String(r.slippagePercent)
})

const n = (v: string) => (v.trim() === '' ? NaN : Number(v))

export const fromDraft = (d: RulesDraft): StrategyRules => ({
  ...d,
  stopAtr: n(d.stopAtr),
  targetR: n(d.targetR),
  maxBars: n(d.maxBars),
  accountSize: n(d.accountSize),
  riskPercent: n(d.riskPercent),
  maxLeverage: n(d.maxLeverage),
  slippagePercent: n(d.slippagePercent)
})
