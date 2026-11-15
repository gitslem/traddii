import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pause, Play, ArrowRight } from 'lucide-react'

const STEPS = [
  { label: 'Plan', verb: 'Size it', page: 'Calculator', to: '/calculator', pos: { left: '50%', top: '14.29%' } },
  { label: 'Read', verb: 'Read it', page: 'Market and Price', to: '/market-structure', pos: { left: '85.71%', top: '50%' } },
  { label: 'Practise', verb: 'Try it', page: 'Practice', to: '/paper-trading', pos: { left: '50%', top: '85.71%' } },
  { label: 'Review', verb: 'Learn from it', page: 'Journal', to: '/journal', pos: { left: '14.29%', top: '50%' } }
]

const STEP_MS = 4200

/**
 * The four-step loop as a ring: a gold marker travels clockwise between the
 * stations and the panel plays a short example of each page. Pauses when
 * off screen, when the user takes control, and for reduced motion.
 */
const LoopRing = () => {
  // turns = quarter turns travelled, so the marker only ever moves clockwise
  const [loop, setLoop] = useState({ step: 0, turns: 0, tick: 0 })
  const { step, turns, tick } = loop
  const [playing, setPlaying] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  // Without IntersectionObserver (very old browsers) the loop simply always runs
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const rootRef = useRef<HTMLDivElement>(null)

  /** Move to a step, or to the next one when none is given */
  const go = (target?: number) =>
    setLoop(cur => {
      const to = target ?? (cur.step + 1) % 4
      return { step: to, turns: cur.turns + ((to - cur.step + 4) % 4), tick: cur.tick + 1 }
    })

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.3 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!playing || !visible) return
    const timer = setInterval(() => go(), STEP_MS)
    return () => clearInterval(timer)
  }, [playing, visible])

  const next = (step + 1) % 4
  const running = playing && visible

  return (
    <div className="ld-lp" ref={rootRef}>
      <div className="ld-ring">
        <svg className="ld-track" viewBox="0 0 420 420" aria-hidden="true">
          <circle cx="210" cy="210" r="150" className="ld-ring-base" />
          <path className={`ld-seg ${step >= 1 ? 'done' : ''}`} d="M210 60 A150 150 0 0 1 360 210" />
          <path className={`ld-seg ${step >= 2 ? 'done' : ''}`} d="M360 210 A150 150 0 0 1 210 360" />
          <path className={`ld-seg ${step >= 3 ? 'done' : ''}`} d="M210 360 A150 150 0 0 1 60 210" />
          <path className="ld-seg back" d="M60 210 A150 150 0 0 1 210 60" />
          <text x="96" y="104" className="ld-ring-note" textAnchor="middle" transform="rotate(-45 96 104)">feeds the next plan</text>
        </svg>
        <div className="ld-orbit" style={{ transform: `rotate(${turns * 90}deg)` }} aria-hidden="true">
          <span className="ld-coin" />
        </div>
        <div className="ld-core" aria-live="polite">
          <span className="ld-core-n">0{step + 1}</span>
          <span className="ld-core-v">{STEPS[step].verb}</span>
          <span className="ld-core-s">step {step + 1} of 4</span>
        </div>
        {STEPS.map((s, i) => (
          <button
            key={s.label}
            type="button"
            className={`ld-stn ${i === step ? 'on' : ''}`}
            style={s.pos}
            aria-pressed={i === step}
            aria-label={`Step ${i + 1}: ${s.label}, ${s.verb}`}
            onClick={() => { setPlaying(false); go(i) }}
          >
            <span className="ld-stn-dot">0{i + 1}</span>
            <span className="ld-stn-lbl">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="ld-panel">
        {step === 0 && (
          <div key={`p0-${tick}`} className="ld-panel-body">
            <div className="ld-in ld-panel-copy">
              <div className="ld-cap gold">01 · Plan · Calculator</div>
              <h3 className="ld-h">Size it before you take it.</h3>
              <p>Choose what you are willing to lose. The Calculator works out the size so a stop-out costs exactly that, fees included.</p>
            </div>
            <div className="ld-demo ld-mono ld-in2" aria-label="Example calculator result">
              <div className="ld-drow" style={{ animationDelay: '.15s' }}><span>Risk 1% of 5,000</span><span>50.00</span></div>
              <div className="ld-drow" style={{ animationDelay: '.3s' }}><span>Entry → stop</span><span>150.00 → <span className="loss">145.00</span></span></div>
              <div className="ld-drow" style={{ animationDelay: '.45s' }}><span>Taker fee, both sides</span><span>0.055%</span></div>
              <div className="ld-drow" style={{ animationDelay: '.7s' }}><span>Size</span><span className="gold strong">9.6857 SOL</span></div>
            </div>
          </div>
        )}
        {step === 1 && (
          <div key={`p1-${tick}`} className="ld-panel-body">
            <div className="ld-in ld-panel-copy">
              <div className="ld-cap gold">02 · Read · Market and Price</div>
              <h3 className="ld-h">Read the structure, not the noise.</h3>
              <p>Trend from real swing highs and lows on four timeframes, the levels price keeps returning to, and what the last candle said.</p>
            </div>
            <div className="ld-demo ld-in2">
              <svg className="ld-chart" viewBox="0 0 440 150" role="img" aria-label="Example: price making higher highs and higher lows above a support level">
                <line className="ld-lvl" x1="10" y1="118" x2="430" y2="118" />
                <text x="12" y="138" style={{ animationDelay: '1.3s' }}>support 145.00</text>
                <path className="ld-price" d="M10 110 L70 52 L120 112 L190 40 L240 96 L320 24 L370 78 L430 30" />
                <circle cx="120" cy="112" r="4" style={{ animationDelay: '.7s' }} />
                <circle cx="240" cy="96" r="4" style={{ animationDelay: '1s' }} />
                <circle cx="370" cy="78" r="4" style={{ animationDelay: '1.3s' }} />
                <text x="240" y="114" textAnchor="middle" style={{ animationDelay: '1.1s' }}>HL</text>
                <text x="370" y="96" textAnchor="middle" style={{ animationDelay: '1.4s' }}>HL</text>
                <text x="320" y="16" textAnchor="middle" style={{ animationDelay: '1.2s' }}>HH</text>
              </svg>
              <div className="ld-mono ld-demo-foot"><span>4H: uptrend</span><span>1D: uptrend</span><span>Last candle: bullish engulfing</span></div>
            </div>
          </div>
        )}
        {step === 2 && (
          <div key={`p2-${tick}`} className="ld-panel-body">
            <div className="ld-in ld-panel-copy">
              <div className="ld-cap gold">03 · Practise · Practice</div>
              <h3 className="ld-h">Try it on live prices first.</h3>
              <p>Send the plan to a $10,000 paper account on live Bybit prices with real Bybit fees, or to your own Bybit Demo Trading account.</p>
            </div>
            <div className="ld-demo ld-mono ld-in2" aria-label="Example paper order">
              <div className="ld-demo-head"><span className="ld-live">Live price</span><span className="ld-muted">Paper · example</span></div>
              <div className="ld-drow" style={{ animationDelay: '.15s' }}><span>Buy 9.6857 SOL</span><span>filled 150.00</span></div>
              <div className="ld-drow" style={{ animationDelay: '.35s' }}><span>Stop · take profit</span><span><span className="loss">145.00</span> · <span className="profit">165.00</span></span></div>
              <div className="ld-muted ld-fill-label">Moving towards the take profit</div>
              <div className="ld-fill"><i /></div>
            </div>
          </div>
        )}
        {step === 3 && (
          <div key={`p3-${tick}`} className="ld-panel-body">
            <div className="ld-in ld-panel-copy">
              <div className="ld-cap gold">04 · Review · Journal</div>
              <h3 className="ld-h">Learn which setups pay you.</h3>
              <p>The Journal records the result after fees, in dollars and in R, and tells you what is working and what is costing you.</p>
            </div>
            <div className="ld-demo ld-in2" aria-label="Example journal entry and finding">
              <div className="ld-drow ld-mono" style={{ animationDelay: '.15s' }}><span>SOL/USDT long · Breakout</span><span className="profit strong">+$143.61 · +2.87R</span></div>
              <p className="ld-finding"><span className="profit strong">What's working:</span> Breakout is your best setup, averaging +0.97R a trade. <span className="ld-muted">(example)</span></p>
            </div>
          </div>
        )}

        <div className="ld-panel-foot">
          <div className={`ld-prog ${running ? (tick % 2 ? 'a' : 'b') : 'off'}`} aria-hidden="true"><i /></div>
          <div className="ld-ctl">
            <button type="button" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause the loop' : 'Play the loop'}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
              {playing ? 'Pause' : 'Play'}
            </button>
            <div className="ld-ctl-right">
              <Link to={STEPS[step].to} className="ld-ctl-link">Open {STEPS[step].page}</Link>
              <button type="button" onClick={() => go(next)}>
                Next: {STEPS[next].label}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoopRing
