import { useMemo, useState } from 'react'
import { Crosshair, CheckCircle, AlertTriangle } from 'lucide-react'
import type { Trade } from '../../services/firestoreService'
import { breakdown, findings, DIMENSIONS, MIN_TRADES_FOR_FINDINGS } from '../../services/journal/edge'
import type { Dimension, GroupStats } from '../../services/journal/edge'
import { formatPnL, formatR } from '../../utils/format'
import './journal-insights.css'

/** Groups this small are shown, but marked as too few trades to trust */
const SMALL_GROUP = 3

const EdgeReport = ({ trades }: { trades: Trade[] }) => {
  const [dimension, setDimension] = useState<Dimension>('setup')
  const found = useMemo(() => findings(trades), [trades])
  const table = useMemo(() => breakdown(trades, dimension), [trades, dimension])
  const active = DIMENSIONS.find(d => d.id === dimension) ?? DIMENSIONS[0]
  const largest = Math.max(...table.groups.map(g => Math.abs(g.totalPnL)), 0)
  const enough = found.closedTrades >= MIN_TRADES_FOR_FINDINGS

  const bar = (g: GroupStats) => {
    const share = largest > 0 ? (Math.abs(g.totalPnL) / largest) * 50 : 0
    const side = g.totalPnL >= 0 ? 'profit' : 'loss'
    return (
      <span className="ji-bar-track" aria-hidden="true">
        <span className={`ji-bar ${side}`} style={{ width: `${share}%` }} />
      </span>
    )
  }

  return (
    <section className="ji-card ji-viz" aria-labelledby="ji-edge-title">
      <div className="ji-card-header">
        <div className="ji-card-title">
          <Crosshair size={24} />
          <div>
            <h2 id="ji-edge-title">Your edge</h2>
            <p>What your own closed trades say is working, and what is costing you.</p>
          </div>
        </div>
      </div>

      {!enough ? (
        <p className="ji-empty">
          {found.closedTrades === 0
            ? `Close ${MIN_TRADES_FOR_FINDINGS} trades to see your patterns.`
            : `${found.closedTrades} closed trade${found.closedTrades === 1 ? '' : 's'} so far. Findings appear after ${MIN_TRADES_FOR_FINDINGS}.`}{' '}
          Tag each trade's setup, mindset and mistakes when you log or close it: those tags are what this report is built from.
        </p>
      ) : (
        <div className="ji-findings">
          <div className="ji-finding-list good">
            <h3><CheckCircle size={18} /> What's working</h3>
            {found.working.length > 0 ? (
              <ul>{found.working.map(f => <li key={f.id}>{f.text}</li>)}</ul>
            ) : (
              <p className="ji-muted">Nothing stands out yet. A pattern needs at least 3 trades before it is listed.</p>
            )}
          </div>
          <div className="ji-finding-list bad">
            <h3><AlertTriangle size={18} /> What's costing you</h3>
            {found.costing.length > 0 ? (
              <ul>{found.costing.map(f => <li key={f.id}>{f.text}</li>)}</ul>
            ) : (
              <p className="ji-muted">No clear leak yet. A pattern needs at least 3 trades before it is listed.</p>
            )}
          </div>
        </div>
      )}

      {found.closedTrades > 0 && (
        <>
          <div className="ji-tabs" role="group" aria-label="Group results by">
            {DIMENSIONS.map(d => (
              <button
                key={d.id}
                className={dimension === d.id ? 'active' : ''}
                aria-pressed={dimension === d.id}
                onClick={() => setDimension(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>

          {table.groups.length === 0 ? (
            <p className="ji-empty">{active.empty}</p>
          ) : (
            <div className="ji-table-wrap">
              <table className="ji-table">
                <caption className="ji-sr-only">Closed trades grouped by {active.label.toLowerCase()}</caption>
                <thead>
                  <tr>
                    <th scope="col">{active.label}</th>
                    <th scope="col" className="num">Trades</th>
                    <th scope="col" className="num">Win rate</th>
                    <th scope="col" className="num ji-wide-only" title="Average result in units of the amount risked">Avg R</th>
                    <th scope="col" className="num ji-wide-only">Avg</th>
                    <th scope="col" className="num">Net P&amp;L</th>
                    <th scope="col" className="ji-bar-col ji-wide-only"><span className="ji-sr-only">Net P&amp;L bar</span></th>
                  </tr>
                </thead>
                <tbody>
                  {table.groups.map(g => (
                    <tr key={g.key} className={g.trades < SMALL_GROUP ? 'few' : ''}>
                      <th scope="row">
                        {g.label}
                        {g.trades < SMALL_GROUP && <span className="ji-few">few trades</span>}
                      </th>
                      <td className="num">{g.trades}</td>
                      <td className="num">{g.wins + g.losses > 0 ? `${g.winRate.toFixed(0)}%` : '—'}</td>
                      <td className="num ji-wide-only">{g.avgR === null ? '—' : formatR(g.avgR)}</td>
                      <td className="num ji-wide-only">{formatPnL(g.avgPnL)}</td>
                      <td className="num strong">{formatPnL(g.totalPnL)}</td>
                      <td className="ji-bar-col ji-wide-only">{bar(g)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {table.groups.length > 0 && table.untagged > 0 && (
            <p className="ji-muted ji-table-note">
              {table.untagged} closed trade{table.untagged === 1 ? ' has' : 's have'} no {active.label.toLowerCase()} and {table.untagged === 1 ? 'is' : 'are'} left out.
            </p>
          )}
        </>
      )}
    </section>
  )
}

export default EdgeReport
