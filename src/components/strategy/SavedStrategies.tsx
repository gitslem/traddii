import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, Bell, BellOff, Bot, Pause, Pencil, Play, RefreshCw, Trash2 } from 'lucide-react'
import type { ForwardResult } from '../../services/strategy/forward'
import { MIN_TRADES_TO_JUDGE } from '../../services/strategy/engine'
import { describeRules, pairsFor } from '../../services/strategy/types'
import { pairToSymbol } from '../../config/pairs'
import type { SavedStrategy } from '../../services/strategy/types'
import { formatPnL, formatPrice, formatR } from '../../utils/format'

const time = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

interface Props {
  strategies: SavedStrategy[]
  results: Map<string, ForwardResult>
  checking: boolean
  editingId: string | null
  /** Null when the browser has no notifications */
  alerts: { on: boolean; note: string | null; onToggle: () => void } | null
  /** Bybit Demo mirroring: whether keys are connected, and the account's name (Demo or Testnet) */
  mirror: { connected: boolean; env: string; onSet: (s: SavedStrategy, on: boolean) => void }
  onCheck: () => void
  onEdit: (s: SavedStrategy) => void
  onToggle: (s: SavedStrategy) => void
  onDelete: (s: SavedStrategy) => void
}

const ForwardSummary = ({ s, r }: { s: SavedStrategy; r: ForwardResult | undefined }) => {
  if (!s.active) return <p className="ji-muted">Paused. Nothing is lost: when you resume, the candles since it was paused are replayed too.</p>

  const { trades: n, wins, sumR, net } = s.stats
  const avgR = n > 0 ? sumR / n : null
  const current = r && r.version === s.version ? r : undefined
  const lastCandle = current ? Math.max(0, ...current.pairs.map(p => p.lastCandle ?? 0)) : 0
  const failed = current?.pairs.filter(p => p.error) ?? []

  return (
    <>
      <dl className="sl-tiles compact">
        <div className="sl-tile"><dt>Trades</dt><dd>{n}</dd></div>
        <div className="sl-tile"><dt>Win rate</dt><dd>{n > 0 ? `${Math.round((wins / n) * 100)}%` : '–'}</dd></div>
        <div className="sl-tile"><dt>Average R</dt><dd className={avgR === null ? '' : avgR >= 0 ? 'profit' : 'loss'}>{avgR === null ? '–' : formatR(avgR)}</dd></div>
        <div className="sl-tile"><dt>Net result</dt><dd className={n === 0 ? '' : net >= 0 ? 'profit' : 'loss'}>{n === 0 ? '–' : formatPnL(net)}</dd></div>
      </dl>
      {n < MIN_TRADES_TO_JUDGE && (
        <div className="sl-progress">
          <div className="sl-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={MIN_TRADES_TO_JUDGE} aria-valuenow={n} aria-label="Closed trades towards a fair judgement">
            <i style={{ width: `${Math.min(1, n / MIN_TRADES_TO_JUDGE) * 100}%` }} />
          </div>
          <span className="ji-muted">{n} of {MIN_TRADES_TO_JUDGE} trades before the result means much</span>
        </div>
      )}
      {current?.pairs.filter(p => p.open).map(p => (
        <p key={p.pair} className="sl-open">
          <strong>Open {p.open!.side} {p.pair}</strong> since {time(p.open!.entryTime)} at {formatPrice(p.open!.entry)}, stop {formatPrice(p.open!.stop)},
          target {formatPrice(p.open!.target)}. <span className={p.open!.unrealised >= 0 ? 'profit' : 'loss'}>{formatPnL(p.open!.unrealised)}</span> at the last close.
        </p>
      ))}
      {current?.pairs.filter(p => p.pending).map(p => (
        <p key={`${p.pair}-pending`} className="sl-open">The last {p.pair} candle gave a {p.pending} signal: the trade opens at the next candle.</p>
      ))}
      {current?.error && <p className="ji-form-error">{current.error}</p>}
      {!current?.error && failed.length > 0 && (
        <p className="ji-form-error">{failed.map(p => p.pair).join(', ')}: {failed[0].error} The other pairs were checked.</p>
      )}
      <p className="ji-muted sl-checked">
        {!current ? 'Catching up on the candles since the last check…' : lastCandle > 0 ? `Up to date to ${time(lastCandle)}.` : ''}
        {current && current.sent > 0 && ` ${current.sent} new trade${current.sent === 1 ? '' : 's'} sent to your Journal.`}
      </p>
    </>
  )
}

const SavedStrategies = ({ strategies, results, checking, editingId, alerts, mirror, onCheck, onEdit, onToggle, onDelete }: Props) => {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [mirrorAsk, setMirrorAsk] = useState<string | null>(null)

  return (
    <section className="ji-card" aria-labelledby="sl-saved-title">
      <div className="ji-card-header">
        <div className="ji-card-title">
          <Bot size={24} />
          <div>
            <h2 id="sl-saved-title">Forward tests</h2>
            <p>
              Saved strategies paper-trade from the moment you save them. While any Traddii tab is open they trade each candle as it
              closes; when you come back after closing it, they catch up on the candles they missed.
            </p>
          </div>
        </div>
        {strategies.some(s => s.active) && (
          <div className="sl-actions">
            {alerts && (
              <button type="button" className="ji-button ghost" onClick={alerts.onToggle} aria-pressed={alerts.on}>
                {alerts.on ? <Bell size={16} /> : <BellOff size={16} />}
                {alerts.on ? 'Alerts on' : 'Turn on alerts'}
              </button>
            )}
            <button type="button" className="ji-button ghost" onClick={onCheck} disabled={checking}>
              <RefreshCw size={16} className={checking ? 'ji-spin' : ''} />
              {checking ? 'Checking…' : 'Check now'}
            </button>
          </div>
        )}
      </div>
      {alerts?.note && <p className="ji-form-error">{alerts.note}</p>}
      {alerts?.on && strategies.some(s => s.active) && (
        <p className="ji-muted sl-alert-note">You get a notification when a bot opens or closes a trade, while any Traddii tab is open in this browser.</p>
      )}

      {strategies.length === 0 ? (
        <p className="ji-empty">
          No forward tests yet. Backtest a strategy above, then save it. From then on it trades new candles only, which is the
          fairest test there is: the rules cannot have been tuned to them.
        </p>
      ) : (
        <ul className="sl-saved">
          {strategies.map(s => (
            <li key={s.id} className={`sl-strategy ${editingId === s.id ? 'editing' : ''}`}>
              <div className="sl-strategy-head">
                <div>
                  <h3>{s.name} <span className="sl-version">v{s.version}</span>{!s.active && <span className="sl-version paused">Paused</span>}</h3>
                  <p className="ji-muted">{describeRules(s)}</p>
                  <p className="ji-muted">Forward test since {time(s.forwardFrom)}</p>
                </div>
                <div className="sl-actions">
                  <button type="button" className="ji-button ghost" onClick={() => onEdit(s)} aria-label={`Edit ${s.name}`}>
                    <Pencil size={16} /> Edit
                  </button>
                  <button type="button" className="ji-button ghost" onClick={() => onToggle(s)} aria-label={`${s.active ? 'Pause' : 'Resume'} ${s.name}`}>
                    {s.active ? <Pause size={16} /> : <Play size={16} />} {s.active ? 'Pause' : 'Resume'}
                  </button>
                  {confirming === s.id ? (
                    <>
                      <button type="button" className="ji-button danger" onClick={() => { setConfirming(null); onDelete(s) }}>Delete it</button>
                      <button type="button" className="ji-button ghost" onClick={() => setConfirming(null)}>Keep</button>
                    </>
                  ) : (
                    <button type="button" className="ji-button ghost" onClick={() => setConfirming(s.id)} aria-label={`Delete ${s.name}`}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
              {confirming === s.id && <p className="ji-muted">Deletes the strategy. Its trades already in your Journal stay there.</p>}
              <ForwardSummary s={s} r={results.get(s.id)} />
              <div className="sl-mirror">
                {s.mirror ? (
                  <>
                    <p className="sl-mirror-state">
                      <ArrowLeftRight size={16} aria-hidden="true" />
                      <span><strong>Mirroring on Bybit {mirror.env}</strong> while a Traddii tab is open in this browser.</span>
                      <button type="button" className="ji-button ghost" onClick={() => mirror.onSet(s, false)}>Stop mirroring</button>
                    </p>
                    {!mirror.connected && <p className="ji-form-error">Your Bybit keys are not connected in this browser, so nothing is mirrored here. Connect them on the <Link to="/paper-trading">Practice</Link> page.</p>}
                    {pairsFor(s).map(pair => s.progress[pairToSymbol(pair)]?.mirrorNote && (
                      <p key={pair} className="ji-muted sl-mirror-note">{pairsFor(s).length > 1 ? `${pair}: ` : ''}{s.progress[pairToSymbol(pair)]?.mirrorNote}</p>
                    ))}
                  </>
                ) : mirrorAsk === s.id ? (
                  <div className="sl-mirror-ask">
                    <p>
                      From the next entry, each trade this bot opens is also placed on your Bybit {mirror.env} account (demo funds) as a market
                      order of the same size, with its stop and target. It only works while a Traddii tab is open in this browser, where your
                      keys are; entries made while Traddii is closed are skipped, never placed late. When the bot closes a trade, whatever is
                      left of that position on {mirror.env} is closed too, so do not trade {pairsFor(s).length > 1 ? 'these pairs' : 'this pair'} by hand on that account.
                    </p>
                    <div className="sl-actions">
                      <button type="button" className="ji-button" onClick={() => { setMirrorAsk(null); mirror.onSet(s, true) }}>Start mirroring</button>
                      <button type="button" className="ji-button ghost" onClick={() => setMirrorAsk(null)}>Cancel</button>
                    </div>
                  </div>
                ) : mirror.connected ? (
                  <button type="button" className="ji-button ghost" onClick={() => setMirrorAsk(s.id)} disabled={!s.active}>
                    <ArrowLeftRight size={16} /> Mirror on Bybit {mirror.env}
                  </button>
                ) : (
                  <p className="ji-muted">To mirror this bot on Bybit Demo Trading, connect your Demo keys on the <Link to="/paper-trading">Practice</Link> page.</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {strategies.length > 0 && (
        <p className="ji-muted sl-fine">
          Closed bot trades go to your <Link to="/journal">Journal</Link> as practice trades, with the strategy name as the setup, so
          "Your edge" compares your strategies with each other and with your own trades.
        </p>
      )}
    </section>
  )
}

export default SavedStrategies
