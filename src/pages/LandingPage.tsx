import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react'
import LoopRing from '../components/landing/LoopRing'
import EmailSubscription from '../components/EmailSubscription'
import './LandingPage.css'

const GITHUB = 'https://github.com/gitslem/traddii'

const TOOLS = [
  {
    n: '01', name: 'Calculator', to: '/calculator', question: 'How much do I buy?',
    text: 'Position size from your risk, with entry and exit fees, the liquidation price and up to three take-profits.',
    chips: ['10 exchanges', 'Spot · futures · margin', 'Live price', 'Log to Journal']
  },
  {
    n: '02', name: 'Market', to: '/market-structure', question: 'Which way is it going?',
    text: 'Trend from higher highs and lows, support and resistance from swing points, and the trend on four timeframes side by side.',
    chips: ['15m · 1H · 4H · 1D', 'Fibonacci', 'AI Market Brief']
  },
  {
    n: '03', name: 'Price', to: '/price-action', question: 'What did that candle say?',
    text: 'Reads the last closed candle against the trend before it, compares its volume with the 20-candle average, and runs a pre-trade checklist.',
    chips: ['Engulfing', 'Hammer · shooting star', 'Inside bar', 'Doji']
  },
  {
    n: '04', name: 'Practice', to: '/paper-trading', question: 'Would this have worked?',
    text: 'Paper trading with $10,000 of virtual money on live Bybit prices and real Bybit fees, including liquidation.',
    chips: ['Market & limit orders', 'Take profit · stop loss', 'Bybit Demo Trading']
  },
  {
    n: '05', name: 'Journal', to: '/journal', question: 'What actually works for me?',
    text: 'Results after fees, R-multiples, practice trades kept apart from real ones, and a report on your own patterns.',
    chips: ['Your edge', 'Personal rules', 'CSV · PDF export']
  }
]

const LandingPage = () => (
  <div className="ledger">
    {/* Hero */}
    <header className="ld-hero">
      <div className="ld-wrap ld-hero-in">
        <div className="ld-hero-copy">
          <div className="ld-cap gold">Free · Open source · No API key</div>
          <h1 className="ld-h ld-title">Every trade,<br />accounted for.</h1>
          <p className="ld-lede">
            Traddii sizes your position from the money you are willing to lose, reads the chart's structure,
            lets you practise on live prices, and turns your journal into a record of what actually works for you.
          </p>
          <div className="ld-actions">
            <Link className="ld-btn gold" to="/calculator">
              Open the calculator
              <ArrowRight size={18} />
            </Link>
            <a className="ld-btn line" href={GITHUB} target="_blank" rel="noopener noreferrer">View the code</a>
          </div>
          <p className="ld-note">No sign-up for the Calculator, Market, Price and Practice pages. The Journal saves to your Google account.</p>
        </div>

        <figure className="ld-slip" aria-label="Example trade plan from the calculator">
          <div className="ld-slip-head">
            <span className="ld-cap">Trade plan · example</span>
            <span className="ld-mono ld-muted">Bybit futures · 5x</span>
          </div>
          <div className="ld-slip-pair">
            <span className="ld-h">SOL/USDT</span>
            <span className="ld-mono ld-tag profit">LONG</span>
          </div>
          <div className="ld-mono">
            <div className="ld-row"><span>Account</span><span>5,000.00</span></div>
            <div className="ld-row"><span>Risk 1%</span><span>50.00</span></div>
            <div className="ld-row"><span>Entry</span><span>150.00</span></div>
            <div className="ld-row"><span>Stop loss</span><span className="loss">145.00</span></div>
            <div className="ld-row"><span>Take profit</span><span className="profit">165.00</span></div>
            <div className="ld-row"><span>Size</span><span>9.6857 SOL</span></div>
            <div className="ld-row"><span>Margin</span><span>290.57</span></div>
            <div className="ld-row"><span>Liquidation est.</span><span>120.75</span></div>
            <div className="ld-row last"><span>Reward to risk</span><span>1 : 2.87</span></div>
          </div>
          <div className="ld-slip-total">
            <span>Loss if the stop is hit, fees included</span>
            <span className="ld-mono gold">$50.00</span>
          </div>
        </figure>
      </div>
    </header>

    {/* The loop */}
    <section className="ld-wrap ld-section" aria-labelledby="ld-loop-title">
      <div className="ld-section-head">
        <div className="ld-head-col">
          <div className="ld-cap gold">How it fits together</div>
          <h2 className="ld-h ld-h2" id="ld-loop-title">One loop. Every trade goes round it.</h2>
        </div>
        <p className="ld-sub">Each page does one job and hands the trade to the next. What you learn at the end feeds the next plan.</p>
      </div>
      <LoopRing />
    </section>

    {/* The tools */}
    <section className="ld-wrap ld-section" id="tools" aria-labelledby="ld-tools-title">
      <div className="ld-cap">The tools</div>
      <h2 className="ld-h ld-h2 ld-tools-title" id="ld-tools-title">Five pages. Each answers one question.</h2>
      {TOOLS.map(tool => (
        <article key={tool.n} className="ld-tool">
          <div className="ld-mono ld-muted">{tool.n}</div>
          <div>
            <h3 className="ld-h ld-tool-name">{tool.name}</h3>
            <p className="ld-tool-q">{tool.question}</p>
          </div>
          <div className="ld-tool-body">
            <p>{tool.text}</p>
            <div className="ld-chips">{tool.chips.map(c => <span key={c} className="ld-chip">{c}</span>)}</div>
          </div>
          <Link to={tool.to} className="ld-tool-link" aria-label={`Open ${tool.name}`}>Open <ArrowRight size={16} /></Link>
        </article>
      ))}
    </section>

    {/* Journal spotlight */}
    <section className="ld-band" aria-labelledby="ld-edge-title">
      <div className="ld-wrap ld-two">
        <div className="ld-head-col">
          <div className="ld-cap">The Journal</div>
          <h2 className="ld-h ld-h2 ld-big" id="ld-edge-title">Your trades, read back to you.</h2>
          <p className="ld-sub">Tag the setup, how you felt and what went wrong. Traddii groups your closed trades and says, in plain words, what is making money and what is costing it.</p>
          <p className="ld-note">Built from your own trades. The optional AI review sends summary numbers only, never your notes.</p>
        </div>
        <figure className="ld-edge" aria-label="Example of the Your edge report">
          <div className="ld-card">
            <div className="ld-cap">Your edge · example</div>
            <div className="ld-edge-line">
              <CheckCircle2 size={20} className="profit" aria-hidden="true" />
              <p><strong>Working:</strong> Breakout is your best setup: 4 of 5 won, averaging <span className="ld-mono">+0.97R</span> a trade.</p>
            </div>
            <div className="ld-edge-line">
              <AlertTriangle size={20} className="gold" aria-hidden="true" />
              <p><strong>Costing you:</strong> Trades taken feeling FOMO average <span className="ld-mono">-1.37R</span> over 3 trades.</p>
            </div>
          </div>
          <div className="ld-card ld-trade">
            <div className="ld-trade-pair">
              <span className="ld-h">SOL/USDT</span>
              <span className="ld-mono ld-muted">LONG 5x · Breakout</span>
            </div>
            <div className="ld-mono ld-trade-nums">
              <span className="ld-muted">fees $1.71</span>
              <span className="profit strong">+$98.30</span>
              <span className="ld-pill">+1.9R</span>
            </div>
          </div>
        </figure>
      </div>
    </section>

    {/* AI brief */}
    <section className="ld-wrap ld-section" aria-labelledby="ld-brief-title">
      <div className="ld-two top">
        <div className="ld-head-col">
          <div className="ld-cap">AI Market Brief</div>
          <h2 className="ld-h ld-h2 ld-big" id="ld-brief-title">A second opinion that only uses the facts on the page.</h2>
          <p className="ld-sub">
            A short bull and bear case built from the structure, the levels and the positioning. It never tells you to buy or sell.
            It runs on Traddii's free Gemini, or on your own model through Ollama, LM Studio, OpenRouter or Groq.
          </p>
        </div>
        <div className="ld-head-col">
          <div className="ld-cap">Positioning · example data</div>
          <div className="ld-tiles">
            <div className="ld-tile"><div className="ld-cap sm">Funding 8h</div><div className="ld-mono ld-tile-v">+0.0040%</div><div className="ld-muted">Longs pay shorts</div></div>
            <div className="ld-tile"><div className="ld-cap sm">Open interest</div><div className="ld-mono ld-tile-v">+1.43%</div><div className="ld-muted">Last 24 hours</div></div>
            <div className="ld-tile"><div className="ld-cap sm">Accounts long</div><div className="ld-mono ld-tile-v">77%</div><div className="ld-muted">Bybit, last hour</div></div>
            <div className="ld-tile"><div className="ld-cap sm">Fear &amp; Greed</div><div className="ld-mono ld-tile-v">13</div><div className="ld-muted">Extreme fear</div></div>
          </div>
          <p className="ld-note">AI can be wrong. Educational only, not financial advice.</p>
        </div>
      </div>
    </section>

    {/* Facts */}
    <section className="ld-facts-band" aria-label="Facts about Traddii">
      <div className="ld-wrap ld-facts">
        <div><div className="ld-mono ld-fact">36</div><div className="ld-muted">USDT pairs, searchable</div></div>
        <div><div className="ld-mono ld-fact">10</div><div className="ld-muted">exchanges' fee and leverage tables</div></div>
        <div><div className="ld-mono ld-fact">0</div><div className="ld-muted">API keys needed to start</div></div>
        <div><div className="ld-mono ld-fact">MIT</div><div className="ld-muted">licence, <a href={GITHUB} target="_blank" rel="noopener noreferrer">code on GitHub</a></div></div>
      </div>
    </section>

    <EmailSubscription />

    {/* Closing call */}
    <section className="ld-wrap ld-cta" aria-labelledby="ld-cta-title">
      <h2 className="ld-h ld-cta-title" id="ld-cta-title">Decide the loss before the trade decides it for you.</h2>
      <p className="ld-sub">Start with the calculator. No account, no card, no API key.</p>
      <div className="ld-actions center">
        <Link className="ld-btn gold" to="/calculator">Open the calculator</Link>
        <Link className="ld-btn line" to="/journal">Start a journal</Link>
      </div>
      <p className="ld-note">Educational tools, not financial advice. Trading crypto is risky: never risk money you can't afford to lose.</p>
    </section>
  </div>
)

export default LandingPage
