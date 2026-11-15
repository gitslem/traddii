import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Sparkles, Loader2, RefreshCw, CheckCircle, AlertTriangle, ListChecks } from 'lucide-react'
import type { Trade } from '../../services/firestoreService'
import type { TradingRules } from '../../services/journal/rules'
import { generateReview, getCachedReview, periodSignature, tradesInPeriod } from '../../services/journal/weeklyReview'
import type { ReviewPeriod, WeeklyReview } from '../../services/journal/weeklyReview'
import AISettings from '../AISettings'
import './journal-insights.css'

interface WeeklyCoachProps {
  userId: string
  trades: Trade[]
  rules: TradingRules
}

const WeeklyCoach = ({ userId, trades, rules }: WeeklyCoachProps) => {
  const id = useId()
  const [days, setDays] = useState<ReviewPeriod>(7)
  const [fresh, setFresh] = useState<WeeklyReview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const inPeriod = useMemo(() => tradesInPeriod(trades, days).length, [trades, days])
  const signature = useMemo(() => periodSignature(trades, days), [trades, days])
  // A saved review is shown until the trades in the period change
  const review = fresh && fresh.periodDays === days ? fresh : getCachedReview(userId, days, signature)

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const result = await generateReview(userId, trades, rules, days, controller.signal)
      if (!controller.signal.aborted) setFresh(result)
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const choosePeriod = (d: ReviewPeriod) => {
    abortRef.current?.abort()
    setLoading(false)
    setError(null)
    setDays(d)
  }

  return (
    <section className="ji-card ji-coach" aria-labelledby={`${id}-title`}>
      <div className="ji-card-header">
        <div className="ji-card-title">
          <Sparkles size={24} />
          <div>
            <h2 id={`${id}-title`}>AI review</h2>
            <p>A short coach's read of your recent trading: what worked, the biggest leak, and one rule to try next.</p>
          </div>
        </div>
        <div className="ji-coach-actions">
          <div className="ji-segmented" role="group" aria-label="Period to review">
            {([7, 30] as const).map(d => (
              <button key={d} className={days === d ? 'active' : ''} aria-pressed={days === d} onClick={() => choosePeriod(d)}>
                {d} days
              </button>
            ))}
          </div>
          <AISettings />
        </div>
      </div>

      {inPeriod === 0 ? (
        <p className="ji-empty">No closed trades in the last {days} days. {days === 7 ? 'Try 30 days, or c' : 'C'}lose a trade to get a review.</p>
      ) : (
        <>
          <div className="ji-coach-run">
            <button className="ji-button" onClick={run} disabled={loading}>
              {loading ? <Loader2 size={16} className="ji-spin" /> : review ? <RefreshCw size={16} /> : <Sparkles size={16} />}
              {loading ? 'Reviewing…' : review ? 'Review again' : `Review my last ${days} days`}
            </button>
            <span className="ji-muted">
              {inPeriod} closed trade{inPeriod === 1 ? '' : 's'}. Only summary numbers and tags are sent to the AI, never your notes.
            </span>
          </div>

          {error && (
            <p className="ji-form-error" role="alert"><strong>No AI model answered.</strong> {error}</p>
          )}

          {review && !loading && (
            <div className="ji-coach-result" aria-live="polite">
              {review.review ? (
                <>
                  {review.review.headline && <p className="ji-coach-headline">{review.review.headline}</p>}
                  <div className="ji-findings">
                    {review.review.wentWell.length > 0 && (
                      <div className="ji-finding-list good">
                        <h3><CheckCircle size={18} /> What went well</h3>
                        <ul>{review.review.wentWell.map(p => <li key={p}>{p}</li>)}</ul>
                      </div>
                    )}
                    {review.review.leak && (
                      <div className="ji-finding-list bad">
                        <h3><AlertTriangle size={18} /> Biggest leak</h3>
                        <p className="ji-coach-text">{review.review.leak}</p>
                      </div>
                    )}
                  </div>
                  {review.review.nextRule && (
                    <p className="ji-coach-rule"><ListChecks size={18} /> <span><strong>Try next:</strong> {review.review.nextRule}</span></p>
                  )}
                </>
              ) : (
                <p className="ji-coach-text">{review.rawText}</p>
              )}
              <p className="ji-coach-foot">
                {review.providerName} ({review.model}) · {new Date(review.generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                {review.closedTrades} trades · AI can be wrong. Educational only - not financial advice.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default WeeklyCoach
