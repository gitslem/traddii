import { useMemo, useState, type ReactNode } from 'react'
import { FlaskConical, Layers, Table2 } from 'lucide-react'
import type { Trade } from '../../services/firestoreService'
import { computeAnalytics } from '../../services/journal/analytics'
import type { HalfStats, RRange, RandomComparison, SimTrade, Verdict } from '../../services/strategy/engine'
import type { StrategyRules } from '../../services/strategy/types'
import { BASKET_SIZE, TIMEFRAMES } from '../../services/strategy/types'
import { formatPnL, formatPrice, formatR, formatUsd } from '../../utils/format'
import EquityCurve from '../journal/EquityCurve'

export interface PairResult {
  pair: string
  candles: number
  trades: number
  avgR: number | null
  net: number
  error: string | null
}

export interface Backtest {
  rules: StrategyRules
  pairs: string[]
  /** Candles tested per pair (the most any pair had) */
  candles: number
  /** Open time of the first and last candle tested */
  firstCandle: number
  lastCandle: number
  trades: (SimTrade & { pair: string })[]
  /** The same trades as Journal trades, for the statistics and the chart */
  journalTrades: Trade[]
  openCount: number
  byPair: PairResult[]
  random: RandomComparison | null
  halves: [HalfStats, HalfStats] | null
  range: RRange | null
  feeDrag: number | null
  verdict: Verdict
}

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`

const REASON_LABEL = { stop: 'Stop', target: 'Target', time: 'Time limit' } as const

interface Props {
  test: Backtest
  /** True when the rules were changed after this test ran */
  stale: boolean
  /** Offered when one pair gave too few trades */
  onTryBasket?: () => void
  /** Save controls, shown under the results */
  children?: ReactNode
}

const BacktestResults = ({ test, stale, onTryBasket, children }: Props) => {
  const [showTrades, setShowTrades] = useState(false)
  const a = useMemo(() => computeAnalytics(test.journalTrades), [test.journalTrades])
  const trades = test.trades
  const tf = TIMEFRAMES.find(t => t.id === test.rules.timeframe)?.label ?? test.rules.timeframe
  const multi = test.pairs.length > 1
  const reasons = trades.reduce((acc, t) => ({ ...acc, [t.reason]: (acc[t.reason] ?? 0) + 1 }), {} as Record<string, number>)
  const verdictClass = test.verdict.kind === 'promising' ? 'ok' : 'warn'
  const latest = [...trades].sort((x, y) => y.entryTime - x.entryTime).slice(0, 200)
  const edge = test.random && a.avgR !== null ? a.avgR - test.random.medianAvgR : null
  const fewOnOnePair = !multi && (test.verdict.kind === 'few' || test.verdict.kind === 'none')

  const tiles: { label: string; value: string; sub?: string; tone?: 'profit' | 'loss' }[] = [
    { label: 'Trades', value: String(trades.length), sub: multi ? `on ${test.pairs.length} pairs` : undefined },
    { label: 'Win rate', value: a.wins + a.losses > 0 ? `${a.winRate.toFixed(0)}%` : '–' },
    {
      label: 'Average R',
      value: a.avgR === null ? '–' : formatR(a.avgR),
      sub: test.range ? `likely ${signed(test.range.low)} to ${signed(test.range.high)}` : undefined,
      tone: a.avgR === null ? undefined : a.avgR >= 0 ? 'profit' : 'loss'
    },
    { label: 'Net result', value: formatPnL(a.totalPnL), tone: a.totalPnL >= 0 ? 'profit' : 'loss' },
    { label: 'Profit factor', value: a.grossLoss > 0 ? a.profitFactor.toFixed(2) : a.grossProfit > 0 ? 'No losses' : '–' },
    { label: 'Max drawdown', value: a.maxDrawdown > 0 ? `-${formatUsd(a.maxDrawdown)}` : '$0.00' },
    { label: 'Fees paid', value: formatUsd(a.totalFees), sub: test.feeDrag !== null ? `${test.feeDrag.toFixed(2)}R a trade` : undefined }
  ]

  return (
    <section className="ji-card sl-results" aria-labelledby="sl-results-title" aria-live="polite">
      <div className="ji-card-header">
        <div className="ji-card-title">
          <FlaskConical size={24} />
          <div>
            <h2 id="sl-results-title">Backtest: {multi ? `${test.pairs.length} pairs` : test.rules.pair} {tf}</h2>
            <p>
              {test.candles.toLocaleString()} closed candles{multi ? ' per pair' : ''}, {day(test.firstCandle)} to {day(test.lastCandle)}
            </p>
          </div>
        </div>
      </div>

      {stale && <p className="ji-verdict warn sl-stale">You changed the rules after this test. Run it again to see the new results.</p>}
      <p className={`ji-verdict ${verdictClass}`}>{test.verdict.text}</p>
      {fewOnOnePair && onTryBasket && !stale && (
        <button type="button" className="ji-button sl-basket-btn" onClick={onTryBasket}>
          <Layers size={16} />
          Test the same rules on {BASKET_SIZE} pairs
        </button>
      )}

      <dl className="sl-tiles">
        {tiles.map(t => (
          <div key={t.label} className="sl-tile">
            <dt>{t.label}</dt>
            <dd className={t.tone ?? ''}>{t.value}</dd>
            {t.sub && <dd className="sl-tile-sub">{t.sub}</dd>}
          </div>
        ))}
      </dl>

      <h3 className="sl-h3">Does it hold up?</h3>
      <ul className="sl-checks">
        {test.range && (
          <li>
            <strong>Likely range:</strong> the true average is probably between {signed(test.range.low)} and {signed(test.range.high)} a trade (90%).
            {test.range.low <= 0 && test.range.high > 0 ? ' That includes both winning and losing, so more trades are needed to know.' : ''}
          </li>
        )}
        {test.halves && (
          <li>
            <strong>First half vs second half:</strong>{' '}
            {test.halves.map((h, i) => (
              <span key={i}>
                {i === 1 && ' · '}
                {h.trades} trade{h.trades === 1 ? '' : 's'}{h.avgR !== null && <>, <span className={h.avgR >= 0 ? 'profit' : 'loss'}>{signed(h.avgR)}</span> a trade</>}
              </span>
            ))}
          </li>
        )}
        {test.random ? (
          <li>
            <strong>Random entries</strong> (same stops, targets and sizing, {test.random.runs} runs): {signed(test.random.medianAvgR)} a trade.
            {edge !== null && <> These rules did <span className={edge >= 0 ? 'profit' : 'loss'}>{signed(edge)}</span> {edge >= 0 ? 'better' : 'worse'}; random did as well in {Math.round(test.random.beatShare * 100)}% of runs.</>}
            {test.random.medianAvgR < 0 && ' Random entries lose because fees and slippage are paid on every trade: that is the bar to beat.'}
          </li>
        ) : (
          <li><strong>Random entries:</strong> not compared, because there were no trades.</li>
        )}
        {test.feeDrag !== null && (
          <li>
            <strong>Costs:</strong> fees take {test.feeDrag.toFixed(2)}R from every trade{test.rules.slippagePercent > 0 ? ', plus slippage' : ''}.
            {test.feeDrag >= 0.1 && ' Wider stops or a higher timeframe make fees a smaller share of each trade.'}
          </li>
        )}
        <li>
          <strong>Exits:</strong> {reasons.target ?? 0} at the target, {reasons.stop ?? 0} at the stop
          {test.rules.maxBars > 0 && <>, {reasons.time ?? 0} at the time limit</>}.
          {test.openCount > 0 && ` ${test.openCount} trade${test.openCount === 1 ? ' was' : 's were'} still open at the end, not counted.`}
        </li>
      </ul>

      {multi && (
        <div className="ji-table-wrap sl-pairs">
          <table className="ji-table">
            <caption className="ji-sr-only">Results by pair</caption>
            <thead>
              <tr>
                <th scope="col">Pair</th>
                <th scope="col" className="num">Trades</th>
                <th scope="col" className="num">Average R</th>
                <th scope="col" className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {test.byPair.map(p => (
                <tr key={p.pair}>
                  <th scope="row">{p.pair}</th>
                  {p.error ? (
                    <td colSpan={3} className="ji-muted">{p.error}</td>
                  ) : (
                    <>
                      <td className="num">{p.trades}</td>
                      <td className={`num ${p.avgR === null ? '' : p.avgR >= 0 ? 'profit' : 'loss'}`}>{p.avgR === null ? '–' : formatR(p.avgR)}</td>
                      <td className={`num strong ${p.trades === 0 ? '' : p.net >= 0 ? 'profit' : 'loss'}`}>{p.trades === 0 ? '–' : formatPnL(p.net)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ji-muted ji-table-note">Each pair trades on its own, one position at a time, risking the same amount.</p>
        </div>
      )}

      {trades.length >= 2 && (
        <div className="sl-equity">
          <EquityCurve trades={test.journalTrades} />
        </div>
      )}

      {trades.length > 0 && (
        <>
          <button type="button" className="ji-button ghost sl-toggle" aria-expanded={showTrades} onClick={() => setShowTrades(s => !s)}>
            <Table2 size={16} />
            {showTrades ? 'Hide the trades' : `Show the ${trades.length} trades`}
          </button>
          {showTrades && (
            <div className="ji-table-wrap ji-scroll sl-trades">
              <table className="ji-table">
                <caption className="ji-sr-only">Backtest trades, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Entered</th>
                    {multi && <th scope="col">Pair</th>}
                    <th scope="col">Side</th>
                    <th scope="col" className="num ji-wide-only">Entry</th>
                    <th scope="col" className="num ji-wide-only">Exit</th>
                    <th scope="col" className="ji-wide-only">Exit at</th>
                    <th scope="col" className="num">R</th>
                    <th scope="col" className="num">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.map(t => (
                    <tr key={`${t.pair}-${t.entryTime}`}>
                      <td>{when(t.entryTime)}</td>
                      {multi && <td>{t.pair.replace('/USDT', '')}</td>}
                      <td>{t.side === 'long' ? 'Long' : 'Short'}</td>
                      <td className="num ji-wide-only">{formatPrice(t.entry)}</td>
                      <td className="num ji-wide-only">{formatPrice(t.exit)}</td>
                      <td className="ji-wide-only">{REASON_LABEL[t.reason]}</td>
                      <td className={`num ${t.r >= 0 ? 'profit' : 'loss'}`}>{formatR(t.r)}</td>
                      <td className={`num strong ${t.net >= 0 ? 'profit' : 'loss'}`}>{formatPnL(t.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {trades.length > latest.length && <p className="ji-muted ji-table-note">Showing the latest {latest.length}.</p>}
            </div>
          )}
        </>
      )}

      {children}

      <p className="ji-muted sl-fine">
        A backtest shows how fixed rules would have traded the past, with fees and slippage. If a candle reached both the stop
        and the target, the stop is counted. Past results do not predict future ones. Educational only, not financial advice.
      </p>
    </section>
  )
}

export default BacktestResults
