import { useId, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Table2 } from 'lucide-react'
import type { Trade } from '../../services/firestoreService'
import { closedInOrder, dailyPnL } from '../../services/journal/analytics'
import type { DayStats } from '../../services/journal/analytics'
import { closeMoment, localDayKey } from '../../services/journal/tradeMath'
import { formatPnL } from '../../utils/format'
import './journal-insights.css'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Four strengths of the profit or loss colour, by size against the month's biggest day */
const strength = (pnl: number, largest: number): number => {
  if (largest <= 0 || Math.abs(pnl) < 0.005) return 0
  return Math.min(4, Math.max(1, Math.ceil((Math.abs(pnl) / largest) * 4)))
}

const compact = (v: number): string => {
  const abs = Math.abs(v)
  const sign = v > 0.004 ? '+' : v < -0.004 ? '-' : ''
  if (abs >= 1000) return `${sign}${Number((abs / 1000).toFixed(1))}K`
  return `${sign}${abs < 10 ? Number(abs.toFixed(1)) : Math.round(abs)}`
}

const PnLCalendar = ({ trades }: { trades: Trade[] }) => {
  const id = useId()
  const days = useMemo(() => dailyPnL(trades), [trades])
  const closed = useMemo(() => closedInOrder(trades), [trades])
  const lastClose = closed.length > 0 ? closeMoment(closed[closed.length - 1]) : new Date()
  const firstClose = closed.length > 0 ? closeMoment(closed[0]) : new Date()
  // Until the user moves month, show the month of the latest close (trades load after the first render)
  const [chosenMonth, setMonth] = useState<Date | null>(null)
  const month = chosenMonth ?? new Date(lastClose.getFullYear(), lastClose.getMonth(), 1)
  const [showTable, setShowTable] = useState(false)
  const [focusDay, setFocusDay] = useState<string | null>(null)

  const year = month.getFullYear()
  const m = month.getMonth()
  const daysInMonth = new Date(year, m + 1, 0).getDate()
  const lead = (new Date(year, m, 1).getDay() + 6) % 7 // Monday first
  const cells: ({ key: string; day: number; stats?: DayStats } | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const key = localDayKey(new Date(year, m, i + 1))
      return { key, day: i + 1, stats: days.get(key) }
    })
  ]
  const monthDays = cells.filter((c): c is { key: string; day: number; stats: DayStats } => !!c?.stats)
  const largest = Math.max(0, ...monthDays.map(c => Math.abs(c.stats.pnl)))
  const net = monthDays.reduce((s, c) => s + c.stats.pnl, 0)
  const green = monthDays.filter(c => c.stats.pnl > 0.004).length
  const red = monthDays.filter(c => c.stats.pnl < -0.004).length
  const monthName = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const canBack = new Date(firstClose.getFullYear(), firstClose.getMonth(), 1) < month
  const canForward = new Date(year, m + 1, 1) <= new Date()

  const label = (c: { day: number; stats?: DayStats }) => {
    const date = new Date(year, m, c.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    if (!c.stats) return `${date}: no closed trades`
    const s = c.stats
    return `${date}: ${formatPnL(s.pnl)} from ${s.trades} closed trade${s.trades === 1 ? '' : 's'} (${s.wins} won, ${s.losses} lost)`
  }
  const focused = monthDays.find(c => c.key === focusDay)

  return (
    <section className="ji-card ji-viz" aria-labelledby={`${id}-title`}>
      <div className="ji-card-header">
        <div className="ji-card-title">
          <CalendarDays size={24} />
          <div>
            <h2 id={`${id}-title`}>Daily results</h2>
            <p>Net result for each day you closed trades.</p>
          </div>
        </div>
        {closed.length > 0 && (
          <button className="ji-button ghost" aria-pressed={showTable} onClick={() => setShowTable(s => !s)}>
            <Table2 size={16} />
            {showTable ? 'Show calendar' : 'Show table'}
          </button>
        )}
      </div>

      {closed.length === 0 ? (
        <p className="ji-empty">Close a trade to start filling the calendar.</p>
      ) : (
        <>
          <div className="ji-cal-head">
            <button className="ji-icon-btn" onClick={() => setMonth(new Date(year, m - 1, 1))} disabled={!canBack} aria-label="Previous month">
              <ChevronLeft size={18} />
            </button>
            <h3 aria-live="polite">{monthName}</h3>
            <button className="ji-icon-btn" onClick={() => setMonth(new Date(year, m + 1, 1))} disabled={!canForward} aria-label="Next month">
              <ChevronRight size={18} />
            </button>
          </div>
          <p className="ji-cal-summary">
            {monthDays.length === 0
              ? 'No closed trades this month.'
              : <>Net <strong>{formatPnL(net)}</strong> · {green} green day{green === 1 ? '' : 's'} · {red} red day{red === 1 ? '' : 's'}</>}
          </p>

          {showTable ? (
            monthDays.length > 0 && (
              <div className="ji-table-wrap">
                <table className="ji-table">
                  <caption className="ji-sr-only">Daily results for {monthName}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      <th scope="col" className="num">Trades</th>
                      <th scope="col" className="num">Won / lost</th>
                      <th scope="col" className="num">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthDays.map(c => (
                      <tr key={c.key}>
                        <th scope="row">{new Date(year, m, c.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</th>
                        <td className="num">{c.stats.trades}</td>
                        <td className="num">{c.stats.wins} / {c.stats.losses}</td>
                        <td className="num strong">{formatPnL(c.stats.pnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <>
              <div className="ji-cal" role="grid" aria-label={`Daily results, ${monthName}`}>
                <div className="ji-cal-row" role="row">
                  {WEEKDAYS.map(d => <span key={d} className="ji-cal-wd" role="columnheader">{d}</span>)}
                </div>
                {Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => (
                  <div className="ji-cal-row" role="row" key={w}>
                    {cells.slice(w * 7, w * 7 + 7).map((c, i) => {
                      if (!c) return <span key={`blank-${i}`} className="ji-cal-cell blank" role="gridcell" />
                      const s = c.stats
                      const tone = !s ? '' : s.pnl > 0.004 ? 'profit' : s.pnl < -0.004 ? 'loss' : 'flat'
                      return (
                        <span
                          key={c.key}
                          role="gridcell"
                          tabIndex={s ? 0 : -1}
                          aria-label={label(c)}
                          className={`ji-cal-cell ${tone} ${s ? `s${strength(s.pnl, largest)}` : ''} ${focusDay === c.key ? 'active' : ''}`}
                          onPointerEnter={() => s && setFocusDay(c.key)}
                          onPointerLeave={() => setFocusDay(null)}
                          onFocus={() => s && setFocusDay(c.key)}
                          onBlur={() => setFocusDay(null)}
                        >
                          <span className="ji-cal-day">{c.day}</span>
                          {s && <span className="ji-cal-pnl" aria-hidden="true">{compact(s.pnl)}</span>}
                        </span>
                      )
                    })}
                  </div>
                ))}
              </div>
              <p className="ji-cal-readout" role="status">
                {focused ? label(focused) : 'Hover or focus a day to see its trades.'}
              </p>
              <div className="ji-cal-legend" aria-hidden="true">
                <span>Loss</span>
                {[4, 3, 2, 1].map(n => <i key={`l${n}`} className={`ji-cal-key loss s${n}`} />)}
                <i className="ji-cal-key flat" />
                {[1, 2, 3, 4].map(n => <i key={`p${n}`} className={`ji-cal-key profit s${n}`} />)}
                <span>Profit</span>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

export default PnLCalendar
