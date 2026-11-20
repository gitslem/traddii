import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FlaskConical, Play, Save } from 'lucide-react'
import PageGuide from '../components/PageGuide'
import RulesForm from '../components/strategy/RulesForm'
import { fromDraft, toDraft } from '../components/strategy/draft'
import type { RulesDraft } from '../components/strategy/draft'
import BacktestResults from '../components/strategy/BacktestResults'
import type { Backtest, PairResult } from '../components/strategy/BacktestResults'
import SavedStrategies from '../components/strategy/SavedStrategies'
import { useAuth } from '../context/auth'
import { fetchClosedCandles } from '../services/ohlcvService'
import { avgR, compareWithRandom, feeDragR, prepare, rRange, simulate, splitHalves, verdictFor } from '../services/strategy/engine'
import type { SimTrade, TestedSeries } from '../services/strategy/engine'
import { simToTrade } from '../services/strategy/journalTrades'
import { latestReplays, onReplay, replayStrategies } from '../services/strategy/forward'
import { BYBIT_ENV_LABEL, getBybitEnv } from '../services/bybitService'
import { canMirror } from '../services/strategy/mirror'
import { alertsOn, alertsSupported, disableAlerts, enableAlerts } from '../services/strategy/alerts'
import {
  MAX_STRATEGIES, deleteStrategy, newStrategyId, patchStrategy, saveStrategy, subscribeToStrategies
} from '../services/strategy/strategyStore'
import { CANDLE_RULES, DEFAULT_RULES, EMPTY_STATS, PRESETS, TIMEFRAMES, pairsFor, rulesProblems } from '../services/strategy/types'
import type { SavedStrategy, StrategyRules } from '../services/strategy/types'
import '../components/journal/journal-insights.css'
import './Strategies.css'

const PERIODS = [1000, 3000, 5000, 10000]
const TF_DAYS: Record<string, number> = { '15m': 1 / 96, '1h': 1 / 24, '4h': 1 / 6, '1d': 1 }

const RULE_KEYS = Object.keys(DEFAULT_RULES) as (keyof StrategyRules)[]
const sameRules = (a: StrategyRules, b: StrategyRules) => RULE_KEYS.every(k => a[k] === b[k])
const rulesOf = (s: StrategyRules): StrategyRules => Object.fromEntries(RULE_KEYS.map(k => [k, s[k]])) as unknown as StrategyRules

const spanText = (candles: number, tf: string) => {
  const days = candles * (TF_DAYS[tf] ?? 1)
  return days >= 60 ? `about ${Math.round(days / 30)} months` : `about ${Math.round(days)} days`
}

const defaultName = (r: StrategyRules) => {
  const tf = TIMEFRAMES.find(t => t.id === r.timeframe)?.label ?? r.timeframe
  const candle = r.candle === 'any' ? 'Trend' : CANDLE_RULES.find(c => c.id === r.candle)?.label.replace('Any strong ', '') ?? ''
  return `${r.basket ? '8 pairs' : r.pair.replace('/USDT', '')} ${tf} ${candle}`.slice(0, 40)
}

const Strategies = () => {
  const { user } = useAuth()
  const [draft, setDraft] = useState<RulesDraft>(() => toDraft(DEFAULT_RULES))
  const [period, setPeriod] = useState(5000)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<Backtest | null>(null)

  const [progress, setProgress] = useState('')
  const [strategies, setStrategies] = useState<SavedStrategy[]>([])
  const [results, setResults] = useState(() => latestReplays())
  const [checking, setChecking] = useState(false)
  const [alerts, setAlerts] = useState(() => alertsOn())
  const [alertsNote, setAlertsNote] = useState<string | null>(null)
  const [editing, setEditing] = useState<SavedStrategy | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  const rules = useMemo(() => fromDraft(draft), [draft])
  const problems = rulesProblems(rules)
  const stale = test !== null && !sameRules(test.rules, rules)

  useEffect(() => {
    if (!user?.uid) return
    return subscribeToStrategies(user.uid, setStrategies)
  }, [user?.uid])

  // Forward tests run in the background (StrategyWatcher); show each replay as it finishes
  useEffect(() => onReplay(r => setResults(prev => new Map(prev).set(r.strategyId, r))), [])

  const checkNow = async () => {
    if (!user?.uid) return
    setChecking(true)
    try {
      await replayStrategies(user.uid, strategies, true)
    } finally {
      setChecking(false)
    }
  }

  const toggleAlerts = async () => {
    setAlertsNote(null)
    if (alerts) {
      disableAlerts()
      setAlerts(false)
      return
    }
    const on = await enableAlerts()
    setAlerts(on)
    if (!on) setAlertsNote('Notifications are blocked for this site. Allow them in the browser\'s site settings, then try again.')
  }

  const runBacktest = async (override?: StrategyRules) => {
    const r = override ?? rules
    if (rulesProblems(r).length > 0) return
    setRunning(true)
    setError(null)
    setSaveMessage(null)
    const pairs = pairsFor(r)
    try {
      const series: TestedSeries[] = []
      const byPair: PairResult[] = []
      const trades: (SimTrade & { pair: string })[] = []
      let first = Infinity
      let last = -Infinity
      let most = 0
      let openCount = 0
      let from: number | null = null
      let to: number | null = null
      for (const [k, pair] of pairs.entries()) {
        setProgress(pairs.length > 1 ? `Testing ${pair} (${k + 1} of ${pairs.length})…` : 'Testing…')
        let candles
        try {
          candles = await fetchClosedCandles(pair, r.timeframe, { count: period })
        } catch (e) {
          if (pairs.length === 1) throw e
          byPair.push({ pair, candles: 0, trades: 0, avgR: null, net: 0, error: 'Could not load candles' })
          continue
        }
        if (candles.length < 200) {
          byPair.push({ pair, candles: candles.length, trades: 0, avgR: null, net: 0, error: `Only ${candles.length} candles on Bybit, too few to test` })
          continue
        }
        // Let the progress text paint between pairs
        await new Promise(resolve => setTimeout(resolve, 0))
        const p = prepare(candles, r.timeframe)
        const result = simulate(p, r)
        series.push({ p, result })
        trades.push(...result.trades.map(t => ({ ...t, pair })))
        byPair.push({ pair, candles: candles.length, trades: result.trades.length, avgR: avgR(result.trades), net: result.trades.reduce((sum, t) => sum + t.net, 0), error: null })
        first = Math.min(first, candles[0].openTime)
        last = Math.max(last, candles[candles.length - 1].openTime)
        most = Math.max(most, candles.length)
        if (result.open) openCount++
        if (result.from !== null) from = from === null ? result.from : Math.min(from, result.from)
        if (result.to !== null) to = to === null ? result.to : Math.max(to, result.to)
      }
      if (series.length === 0) {
        setError(pairs.length === 1 ? `${byPair[0]?.error ?? 'Too few candles'} for ${pairs[0]}.` : 'None of the pairs could be tested. Check your connection and try again.')
        return
      }
      setProgress('Comparing with random entries…')
      await new Promise(resolve => setTimeout(resolve, 0))
      const random = compareWithRandom(series, r, most * series.length > 20_000 ? 30 : 60)
      const halves = splitHalves(trades, from, to)
      const range = rRange(trades)
      setTest({
        rules: r,
        pairs: byPair.map(b => b.pair),
        candles: most,
        firstCandle: first,
        lastCandle: last,
        trades,
        journalTrades: trades.map((t, i) => simToTrade(t, { ...r, pair: t.pair }, i)),
        openCount,
        byPair,
        random,
        halves,
        range,
        feeDrag: feeDragR(trades),
        verdict: verdictFor(trades, random, halves, range)
      })
      if (!name) setName(editing?.name ?? defaultName(r))
    } catch (e) {
      console.error('Backtest failed:', e)
      setError('Could not load candles from Bybit. Check your connection and try again.')
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  const tryBasket = () => {
    const wider = { ...rules, basket: true }
    setDraft(toDraft(wider))
    void runBacktest(wider)
  }

  const save = async () => {
    if (!user?.uid || !test || stale) return
    const trimmed = name.trim().slice(0, 40) || defaultName(rules)
    setSaving(true)
    setSaveMessage(null)
    try {
      const now = Date.now()
      if (editing) {
        if (sameRules(rulesOf(editing), rules)) {
          if (trimmed !== editing.name) await patchStrategy(user.uid, editing.id, { name: trimmed })
          setSaveMessage({ kind: 'ok', text: trimmed !== editing.name ? 'Name updated. The rules did not change, so the forward test carries on.' : 'The rules did not change, so the forward test carries on.' })
        } else {
          // New rules are a new version: its forward test starts now, and older trades stay under the old version
          await saveStrategy(user.uid, { ...editing, ...rules, name: trimmed, version: editing.version + 1, forwardFrom: now, progress: {}, stats: { ...EMPTY_STATS }, active: true })
          setSaveMessage({ kind: 'ok', text: `Saved as version ${editing.version + 1}. Its forward test starts with the next candle.` })
        }
      } else {
        if (strategies.length >= MAX_STRATEGIES) {
          setSaveMessage({ kind: 'error', text: `You can keep up to ${MAX_STRATEGIES} strategies. Delete one first.` })
          return
        }
        const id = newStrategyId()
        await saveStrategy(user.uid, {
          ...rules, id, name: trimmed, version: 1, createdAt: new Date(now).toISOString(),
          forwardFrom: now, progress: {}, stats: { ...EMPTY_STATS }, active: true, mirror: false, mirrorSince: 0
        })
        setEditing({ ...rules, id, name: trimmed, version: 1, createdAt: new Date(now).toISOString(), forwardFrom: now, progress: {}, stats: { ...EMPTY_STATS }, active: true, mirror: false, mirrorSince: 0 })
        setSaveMessage({ kind: 'ok', text: 'Saved. The forward test starts with the next candle that closes.' })
      }
    } catch (e) {
      console.error('Save failed:', e)
      setSaveMessage({ kind: 'error', text: 'Could not save. Check your connection and try again.' })
    } finally {
      setSaving(false)
    }
  }

  // Keep the edited strategy in step with what is saved (e.g. after a new version)
  const editingId = editing?.id ?? null
  const editingSaved = strategies.find(s => s.id === editingId) ?? null
  useEffect(() => {
    if (editingSaved) setEditing(editingSaved)
  }, [editingSaved])

  const edit = (s: SavedStrategy) => {
    setEditing(s)
    setDraft(toDraft(rulesOf(s)))
    setName(s.name)
    setTest(null)
    setSaveMessage(null)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const startNew = () => {
    setEditing(null)
    setName('')
    setTest(null)
    setSaveMessage(null)
  }

  const toggle = async (s: SavedStrategy) => {
    if (!user?.uid) return
    await patchStrategy(user.uid, s.id, { active: !s.active }).catch(e => console.error('Could not update strategy:', e))
  }

  const remove = async (s: SavedStrategy) => {
    if (!user?.uid) return
    await deleteStrategy(user.uid, s.id).catch(e => console.error('Could not delete strategy:', e))
    if (editing?.id === s.id) startNew()
  }

  const rulesChanged = editing !== null && !sameRules(rulesOf(editing), rules)

  return (
    <div className="sl-page">
      <header className="sl-hero">
        <PageGuide page="strategies" />
        <div className="sl-hero-icon"><FlaskConical size={36} /></div>
        <h1>Strategies</h1>
        <p>Write a strategy as rules, test it on past Bybit candles, then let it paper-trade new ones. Every result is after fees.</p>
      </header>

      <div className="sl-layout">
        <section className="ji-card sl-rules" ref={formRef} aria-labelledby="sl-rules-title">
          <div className="ji-card-header">
            <div className="ji-card-title">
              <div>
                <h2 id="sl-rules-title">{editing ? `Editing ${editing.name}` : 'Rules'}</h2>
                <p>{editing ? `Version ${editing.version}. Changing the rules saves a new version with a fresh forward test.` : 'All the conditions you switch on must hold on the same closed candle.'}</p>
              </div>
            </div>
            {editing && <button type="button" className="ji-button ghost" onClick={startNew}>New strategy</button>}
          </div>

          <div className="sl-presets">
            <span className="sl-label" id="sl-presets-label">Start from an idea</span>
            <div className="sl-preset-list" role="group" aria-labelledby="sl-presets-label">
              {PRESETS.map(p => (
                <button key={p.id} type="button" className="sl-preset" title={p.text} onClick={() => { setDraft(toDraft({ ...rules, ...p.rules })); setSaveMessage(null) }}>
                  {p.name}
                </button>
              ))}
            </div>
            <small className="sl-hint">Common ideas to start from, not recommendations. Each keeps your pair, timeframe and money settings.</small>
          </div>

          <RulesForm draft={draft} onChange={d => { setDraft(d); setSaveMessage(null) }} />

          <div className="sl-run">
            <div className="sl-field">
              <label className="sl-label" htmlFor="sl-period">Test period</label>
              <select id="sl-period" className="sl-input" value={period} onChange={e => setPeriod(Number(e.target.value))}>
                {PERIODS.map(n => <option key={n} value={n}>{n.toLocaleString()} candles ({spanText(n, rules.timeframe)})</option>)}
              </select>
            </div>
            {problems.length > 0 && (
              <ul className="ji-form-error sl-problems" role="alert">{problems.map(p => <li key={p}>{p}</li>)}</ul>
            )}
            {error && <p className="ji-form-error" role="alert">{error}</p>}
            <button type="button" className="ji-button sl-run-btn" onClick={() => void runBacktest()} disabled={running || problems.length > 0}>
              <Play size={16} />
              {running ? progress || 'Testing…' : 'Run backtest'}
            </button>
          </div>
        </section>

        <div className="sl-output">
          {test ? (
            <BacktestResults test={test} stale={stale} onTryBasket={running ? undefined : tryBasket}>
              <div className="sl-save">
                <h3 className="sl-h3">Forward test it</h3>
                {!user ? (
                  <p className="ji-muted">
                    <Link to="/login">Sign in</Link> to save this strategy. It will then paper-trade every new candle and send its
                    trades to your Journal.
                  </p>
                ) : (
                  <>
                    <p className="ji-muted">
                      {editing && !rulesChanged
                        ? 'These are the saved rules. Change something to save a new version.'
                        : `Saving locks the rules. From the next candle on, the strategy paper-trades new candles only${rules.basket ? ', on all the pairs tested' : ''}, so the result cannot be tuned to the past.`}
                    </p>
                    <div className="sl-save-row">
                      <div className="sl-field">
                        <label className="sl-label" htmlFor="sl-name">Name</label>
                        <input id="sl-name" className="sl-input" maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder={defaultName(rules)} />
                      </div>
                      <button type="button" className="ji-button" onClick={save} disabled={saving || stale}>
                        <Save size={16} />
                        {saving ? 'Saving…' : editing ? (rulesChanged ? `Save as version ${editing.version + 1}` : 'Save name') : 'Save and start forward test'}
                      </button>
                    </div>
                  </>
                )}
                {saveMessage && <p className={saveMessage.kind === 'ok' ? 'ji-verdict ok' : 'ji-form-error'} role="status">{saveMessage.text}</p>}
              </div>
            </BacktestResults>
          ) : (
            <section className="ji-card sl-placeholder">
              <h2>How it works</h2>
              <ol>
                <li><strong>Backtest.</strong> The rules run over past candles one at a time. Each trade opens at the next candle's open, never with hindsight.</li>
                <li><strong>Check it honestly.</strong> Compare the first and second half, and random entries with the same exits. Under {30} trades says little.</li>
                <li><strong>Forward test.</strong> Save it and it paper-trades new candles from then on. No server needed: it catches up whenever you open Traddii.</li>
                <li><strong>Learn.</strong> Bot trades land in your Journal, where "Your edge" compares them with each other and with your own trades.</li>
              </ol>
            </section>
          )}
        </div>
      </div>

      {user ? (
        <SavedStrategies
          strategies={strategies}
          results={results}
          checking={checking}
          editingId={editing?.id ?? null}
          alerts={alertsSupported() ? { on: alerts, note: alertsNote, onToggle: () => void toggleAlerts() } : null}
          mirror={{
            connected: canMirror(user.uid),
            env: BYBIT_ENV_LABEL[getBybitEnv(user.uid)],
            onSet: (s, on) => void patchStrategy(user.uid, s.id, on ? { mirror: true, mirrorSince: Date.now() } : { mirror: false })
              .catch(e => console.error('Could not change mirroring:', e))
          }}
          onCheck={() => void checkNow()}
          onEdit={edit}
          onToggle={s => void toggle(s)}
          onDelete={s => void remove(s)}
        />
      ) : (
        <section className="ji-card">
          <h2 className="sl-h3">Forward tests</h2>
          <p className="ji-empty"><Link to="/login">Sign in</Link> to save strategies and let them paper-trade new candles. Backtests work without an account.</p>
        </section>
      )}
    </div>
  )
}

export default Strategies
