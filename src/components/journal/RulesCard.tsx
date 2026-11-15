import { useEffect, useId, useState } from 'react'
import { ShieldCheck, Pencil, AlertTriangle } from 'lucide-react'
import type { Trade } from '../../services/firestoreService'
import { EMPTY_RULES, hasAnyRule, rulesVerdict, summariseRules } from '../../services/journal/rules'
import type { RuleBreak, TradingRules } from '../../services/journal/rules'
import { saveRules } from '../../services/journal/rulesStore'
import { entryMoment } from '../../services/journal/tradeMath'
import { formatUsd } from '../../utils/format'
import './journal-insights.css'

interface RulesCardProps {
  userId: string
  rules: TradingRules
  trades: Trade[]
  breaks: Map<string, RuleBreak[]>
}

type Draft = Record<'accountSize' | 'maxRiskPercent' | 'maxTradesPerDay' | 'dailyLossLimit' | 'maxLeverage', string> & { requireStop: boolean }

const toDraft = (r: TradingRules): Draft => ({
  accountSize: r.accountSize?.toString() ?? '',
  maxRiskPercent: r.maxRiskPercent?.toString() ?? '',
  maxTradesPerDay: r.maxTradesPerDay?.toString() ?? '',
  dailyLossLimit: r.dailyLossLimit?.toString() ?? '',
  maxLeverage: r.maxLeverage?.toString() ?? '',
  requireStop: r.requireStop
})

const RulesCard = ({ userId, rules, trades, breaks }: RulesCardProps) => {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>(toDraft(rules))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(toDraft(rules))
  }, [rules, editing])

  const anyRule = hasAnyRule(rules)
  const summary = summariseRules(trades, breaks)
  const verdict = anyRule ? rulesVerdict(summary) : null
  const recent = trades
    .filter(t => breaks.has(t.id))
    .sort((a, b) => entryMoment(b).getTime() - entryMoment(a).getTime())
    .slice(0, 5)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const read = (text: string, label: string, max?: number): number | null | string => {
      if (text.trim() === '') return null
      const n = parseFloat(text)
      if (!Number.isFinite(n) || n <= 0) return `${label} must be a number above 0, or empty.`
      if (max !== undefined && n > max) return `${label} must be at most ${max}.`
      return n
    }
    const fields = {
      accountSize: read(draft.accountSize, 'Account size'),
      maxRiskPercent: read(draft.maxRiskPercent, 'Risk per trade', 100),
      maxTradesPerDay: read(draft.maxTradesPerDay, 'Trades per day', 1000),
      dailyLossLimit: read(draft.dailyLossLimit, 'Daily loss limit'),
      maxLeverage: read(draft.maxLeverage, 'Max leverage', 200)
    }
    const problem = Object.values(fields).find(v => typeof v === 'string')
    if (typeof problem === 'string') {
      setError(problem)
      return
    }
    if (fields.maxRiskPercent !== null && fields.accountSize === null) {
      setError('Add your account size so the risk limit can be worked out in dollars.')
      return
    }
    const next: TradingRules = {
      ...EMPTY_RULES,
      ...(fields as Record<string, number | null>),
      maxTradesPerDay: fields.maxTradesPerDay === null ? null : Math.floor(fields.maxTradesPerDay as number),
      requireStop: draft.requireStop
    }
    setSaving(true)
    try {
      await saveRules(userId, next)
      setEditing(false)
      setError(null)
    } catch {
      setError('Could not save your rules. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const field = (key: keyof Omit<Draft, 'requireStop'>, label: string, hint: string, step = 'any') => (
    <div className="ji-rule-field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        type="number"
        inputMode="decimal"
        min="0"
        step={step}
        value={draft[key]}
        placeholder="No limit"
        onChange={e => { setDraft({ ...draft, [key]: e.target.value }); setError(null) }}
      />
      <small>{hint}</small>
    </div>
  )

  const chips: string[] = []
  if (rules.maxRiskPercent !== null && rules.accountSize !== null) {
    chips.push(`Risk at most ${rules.maxRiskPercent}% (${formatUsd(rules.accountSize * rules.maxRiskPercent / 100)}) a trade`)
  }
  if (rules.maxTradesPerDay !== null) chips.push(`At most ${rules.maxTradesPerDay} trade${rules.maxTradesPerDay === 1 ? '' : 's'} a day`)
  if (rules.dailyLossLimit !== null) chips.push(`Stop for the day after losing ${formatUsd(rules.dailyLossLimit)}`)
  if (rules.maxLeverage !== null) chips.push(`Leverage at most ${rules.maxLeverage}x`)
  if (rules.requireStop) chips.push('Every trade has a stop loss')

  return (
    <section className="ji-card" aria-labelledby={`${id}-title`}>
      <div className="ji-card-header">
        <div className="ji-card-title">
          <ShieldCheck size={24} />
          <div>
            <h2 id={`${id}-title`}>Your rules</h2>
            <p>Set limits once. Every trade is checked against them, and the Calculator uses them.</p>
          </div>
        </div>
        {!editing && (
          <button className="ji-button" onClick={() => setEditing(true)}>
            <Pencil size={16} />
            {anyRule ? 'Edit rules' : 'Set your rules'}
          </button>
        )}
      </div>

      {editing ? (
        <form className="ji-rules-form" onSubmit={save} noValidate>
          <div className="ji-rule-grid">
            {field('accountSize', 'Account size (USDT)', 'What the risk limit is measured against')}
            {field('maxRiskPercent', 'Risk per trade (%)', 'Loss at the stop, as a share of the account')}
            {field('maxTradesPerDay', 'Trades per day', 'Trades opened on one calendar day', '1')}
            {field('dailyLossLimit', 'Daily loss limit (USDT)', 'No new trades after losing this much in a day')}
            {field('maxLeverage', 'Max leverage', 'Highest leverage you allow yourself', '1')}
            <label className="ji-rule-check">
              <input
                type="checkbox"
                checked={draft.requireStop}
                onChange={e => setDraft({ ...draft, requireStop: e.target.checked })}
              />
              Every trade needs a stop loss
            </label>
          </div>
          {error && <p className="ji-form-error" role="alert">{error}</p>}
          <div className="ji-rules-actions">
            <button type="button" className="ji-button ghost" onClick={() => { setEditing(false); setError(null) }}>Cancel</button>
            <button type="submit" className="ji-button" disabled={saving}>{saving ? 'Saving…' : 'Save rules'}</button>
          </div>
        </form>
      ) : !anyRule ? (
        <p className="ji-empty">
          No rules yet. Most traders set a risk limit per trade (1% is common), a daily loss limit and a
          maximum number of trades per day. Breaking them is where most losses come from.
        </p>
      ) : (
        <>
          <ul className="ji-rule-chips">{chips.map(c => <li key={c}>{c}</li>)}</ul>
          {verdict && <p className={`ji-verdict ${summary.brokenClosed > 0 ? 'warn' : 'ok'}`}>{verdict}</p>}
          {recent.length > 0 && (
            <div className="ji-breaks">
              <h3><AlertTriangle size={16} /> Recent rule breaks</h3>
              <ul>
                {recent.map(t => (
                  <li key={t.id}>
                    <strong>{t.pair} {t.type}</strong>
                    <span className="ji-muted"> · {entryMoment(t).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
                    <span className="ji-break-text">{breaks.get(t.id)?.map(b => b.text).join(' ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default RulesCard
