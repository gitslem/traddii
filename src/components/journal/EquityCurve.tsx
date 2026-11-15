import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { TrendingUp, Table2 } from 'lucide-react'
import type { Trade } from '../../services/firestoreService'
import { equityCurve } from '../../services/journal/analytics'
import { formatPnL, formatUsd } from '../../utils/format'
import './journal-insights.css'

const HEIGHT = 240
const PAD = { top: 16, right: 16, bottom: 28, left: 64 }

/** Round tick values: 0, 250, 500... */
const niceTicks = (min: number, max: number, count = 4): number[] => {
  const span = max - min || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

const tickLabel = (v: number): string => {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 10_000) return `${sign}$${Number((abs / 1000).toFixed(1))}K`
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: abs < 10 ? 2 : 0 })}`
}

const EquityCurve = ({ trades }: { trades: Trade[] }) => {
  const id = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [active, setActive] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const curve = useMemo(() => equityCurve(trades), [trades])

  const hasChart = curve.points.length >= 2 && !showTable
  // The chart div only exists once there are trades to draw, so measure it whenever it appears
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setWidth(Math.max(240, el.clientWidth))
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasChart])

  const points = curve.points
  // Position 0 is the starting zero, so the curve starts from nothing
  const values = [0, ...points.map(p => p.equity)]
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const innerW = width - PAD.left - PAD.right
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (values.length > 1 ? (i / (values.length - 1)) * innerW : 0)
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const area = `${line}L${x(values.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`
  const dd = curve.drawdown
  // Drawdown indexes are positions in `points`; +1 maps them onto `values`
  const ddFrom = dd ? dd.peakIndex + 1 : 0
  const ddTo = dd ? dd.troughIndex + 1 : 0
  const final = values[values.length - 1]
  const xTicks = niceTicks(0, values.length - 1, Math.min(6, values.length - 1)).filter(t => Number.isInteger(t) && t >= 0 && t <= values.length - 1)

  const pick = (clientX: number) => {
    const svg = wrapRef.current?.querySelector('svg')
    if (!svg || values.length < 2) return
    const rect = svg.getBoundingClientRect()
    const rel = ((clientX - rect.left) / rect.width) * width - PAD.left
    const i = Math.round((rel / innerW) * (values.length - 1))
    setActive(Math.min(values.length - 1, Math.max(1, i)))
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (values.length < 2) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const step = e.key === 'ArrowRight' ? 1 : -1
      setActive(a => Math.min(values.length - 1, Math.max(1, (a ?? (step > 0 ? 0 : values.length)) + step)))
    } else if (e.key === 'Home') { e.preventDefault(); setActive(1) }
    else if (e.key === 'End') { e.preventDefault(); setActive(values.length - 1) }
    else if (e.key === 'Escape') setActive(null)
  }

  const point = active !== null ? points[active - 1] : null
  const tipLeft = active !== null ? Math.min(Math.max(x(active), 90), width - 90) : 0
  // Keep the readout off the line: below the point when it is high, above when it is low
  const tipBelow = active !== null && y(values[active]) < PAD.top + innerH / 2

  return (
    <section className="ji-card ji-viz" aria-labelledby={`${id}-title`}>
      <div className="ji-card-header">
        <div className="ji-card-title">
          <TrendingUp size={24} />
          <div>
            <h2 id={`${id}-title`}>Equity curve</h2>
            <p>Your running net result, closed trade by closed trade.</p>
          </div>
        </div>
        {points.length >= 2 && (
          <button className="ji-button ghost" aria-pressed={showTable} onClick={() => setShowTable(s => !s)}>
            <Table2 size={16} />
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>

      {points.length < 2 ? (
        <p className="ji-empty">The curve appears once you have two closed trades.</p>
      ) : showTable ? (
        <div className="ji-table-wrap ji-scroll">
          <table className="ji-table">
            <caption className="ji-sr-only">Running net result by closed trade</caption>
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">Closed</th>
                <th scope="col">Pair</th>
                <th scope="col" className="num">Trade</th>
                <th scope="col" className="num">Running total</th>
              </tr>
            </thead>
            <tbody>
              {points.map(p => (
                <tr key={p.trade.id}>
                  <td className="num">{p.index}</td>
                  <td>{p.date.toLocaleDateString(undefined, { dateStyle: 'medium' })}</td>
                  <td>{p.trade.pair}</td>
                  <td className="num">{formatPnL(p.pnl)}</td>
                  <td className="num strong">{formatPnL(p.equity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ji-chart" ref={wrapRef}>
          <p className="ji-chart-summary">
            <span className="ji-hero">{formatPnL(final)}</span>
            <span className="ji-muted">
              over {points.length} closed trades
              {dd ? ` · deepest drawdown ${formatUsd(dd.amount)}` : ' · no drawdown yet'}
            </span>
          </p>
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label={`Equity curve: ${formatPnL(final)} after ${points.length} closed trades${dd ? `, deepest drawdown ${formatUsd(dd.amount)}` : ''}. Use the arrow keys to read each trade, or Show table.`}
            tabIndex={0}
            onPointerMove={e => pick(e.clientX)}
            onPointerDown={e => pick(e.clientX)}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            {ticks.map(t => (
              <g key={t}>
                <line className="ji-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
                <text className="ji-axis" x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">{tickLabel(t)}</text>
              </g>
            ))}
            {xTicks.map(t => (
              <text key={t} className="ji-axis" x={x(t)} y={HEIGHT - 8} textAnchor="middle">{t === 0 ? 'Start' : t}</text>
            ))}
            {dd && (
              <rect
                className="ji-dd-band"
                x={x(ddFrom)}
                y={PAD.top}
                width={Math.max(2, x(ddTo) - x(ddFrom))}
                height={innerH}
              />
            )}
            <path className="ji-area" d={area} />
            <path className="ji-line" d={line} />
            {dd && (
              <>
                <circle className="ji-dot loss" cx={x(ddTo)} cy={y(values[ddTo])} r={4} />
                <text
                  className="ji-label"
                  x={Math.min(Math.max(x(ddTo), PAD.left + 70), width - PAD.right - 70)}
                  y={Math.min(y(values[ddTo]) + 20, HEIGHT - PAD.bottom - 4)}
                  textAnchor="middle"
                >
                  Drawdown -{formatUsd(dd.amount)}
                </text>
              </>
            )}
            <circle className="ji-dot" cx={x(values.length - 1)} cy={y(final)} r={4} />
            {active !== null && (
              <>
                <line className="ji-crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} />
                <circle className="ji-dot" cx={x(active)} cy={y(values[active])} r={5} />
              </>
            )}
          </svg>
          {point && (
            <div className={`ji-tooltip ${tipBelow ? 'below' : 'above'}`} style={{ left: tipLeft }} role="status">
              <strong>{formatPnL(point.equity)}</strong>
              <span>Trade {point.index} · {point.trade.pair} · {point.date.toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
              <span>This trade {formatPnL(point.pnl)}</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default EquityCurve
