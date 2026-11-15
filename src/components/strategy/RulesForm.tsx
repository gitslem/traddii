import { useId } from 'react'
import PairSelect from '../PairSelect'
import { CANDLE_RULES, TIMEFRAMES } from '../../services/strategy/types'
import type { CandleRule, Direction, StopRule, Timeframe } from '../../services/strategy/types'
import type { RulesDraft } from './draft'

interface Props {
  draft: RulesDraft
  onChange: (d: RulesDraft) => void
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  const labelId = useId()
  return (
    <div className="sl-field">
      <span className="sl-label" id={labelId}>{label}</span>
      <div className="sl-seg" role="group" aria-labelledby={labelId}>
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            className={value === o.id ? 'active' : ''}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const RulesForm = ({ draft, onChange }: Props) => {
  const id = useId()
  const set = <K extends keyof RulesDraft>(key: K, value: RulesDraft[K]) => onChange({ ...draft, [key]: value })
  const tf = TIMEFRAMES.find(t => t.id === draft.timeframe) ?? TIMEFRAMES[1]
  const sideWord = draft.direction === 'short' ? 'down' : draft.direction === 'long' ? 'up' : 'with the trade'

  const numField = (key: 'stopAtr' | 'targetR' | 'maxBars' | 'accountSize' | 'riskPercent' | 'maxLeverage' | 'slippagePercent', label: string, hint: string, step = 'any') => (
    <div className="sl-field">
      <label className="sl-label" htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        className="sl-input"
        type="number"
        inputMode="decimal"
        min="0"
        step={step}
        value={draft[key]}
        onChange={e => set(key, e.target.value)}
      />
      <small className="sl-hint">{hint}</small>
    </div>
  )

  const check = (key: 'withTrend' | 'withHigherTrend' | 'nearLevel' | 'volumeAbove', label: string, hint: string) => (
    <label className="sl-check">
      <input type="checkbox" checked={draft[key]} onChange={e => set(key, e.target.checked)} />
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </label>
  )

  return (
    <div className="sl-form">
      <div className="sl-row">
        <div className="sl-field">
          <span className="sl-label">Pair</span>
          <PairSelect value={draft.pair} onChange={v => set('pair', v)} ariaLabel="Pair to test" className="sl-input sl-pair" />
        </div>
        <Segmented<Timeframe> label="Timeframe" value={draft.timeframe} options={TIMEFRAMES.map(t => ({ id: t.id, label: t.label }))} onChange={v => set('timeframe', v)} />
      </div>
      <label className="sl-check">
        <input type="checkbox" checked={draft.basket} onChange={e => set('basket', e.target.checked)} />
        <span>
          <strong>Also test on the 8 most traded pairs</strong>
          <small>More trades to judge by, and a check that the idea is not specific to one coin</small>
        </span>
      </label>
      <Segmented<Direction>
        label="Direction"
        value={draft.direction}
        options={[{ id: 'long', label: 'Long' }, { id: 'short', label: 'Short' }, { id: 'both', label: 'Both' }]}
        onChange={v => set('direction', v)}
      />

      <fieldset className="sl-fieldset">
        <legend>Enter when the candle closes and</legend>
        {check('withTrend', `The ${tf.label} trend agrees`, `Higher highs and lows for longs, lower for shorts (${sideWord})`)}
        {check('withHigherTrend', `The ${tf.higher} trend agrees`, 'The same test one timeframe up')}
        <div className="sl-field">
          <label className="sl-label" htmlFor={`${id}-candle`}>The candle shows</label>
          <select id={`${id}-candle`} className="sl-input" value={draft.candle} onChange={e => set('candle', e.target.value as CandleRule)}>
            {CANDLE_RULES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <small className="sl-hint">
            {draft.candle === 'pattern' && 'Any pattern from the Price page rated 60 or more, pointing the trade\'s way'}
            {draft.candle === 'engulfing' && 'Bullish engulfing for longs, bearish engulfing for shorts'}
            {draft.candle === 'pinbar' && 'A long wick rejecting the move against the trade'}
            {draft.candle === 'any' && 'No candle condition'}
          </small>
        </div>
        {check('nearLevel', 'Price is near a level', 'Within one average range (ATR) of a swing level below for longs, above for shorts')}
        {check('volumeAbove', 'Volume is above average', 'Higher than the average of the 20 candles before it')}
      </fieldset>

      <fieldset className="sl-fieldset">
        <legend>Exit</legend>
        <Segmented<StopRule>
          label="Stop loss"
          value={draft.stop}
          options={[{ id: 'swing', label: 'Beyond the last swing' }, { id: 'atr', label: 'ATR distance' }]}
          onChange={v => set('stop', v)}
        />
        <div className="sl-grid">
          {draft.stop === 'atr' && numField('stopAtr', 'Stop distance (ATR)', 'Average ranges from the entry')}
          {numField('targetR', 'Take profit (R)', '2 = twice the stop distance')}
          {numField('maxBars', 'Close after (candles)', '0 = no time limit', '1')}
        </div>
      </fieldset>

      <fieldset className="sl-fieldset">
        <legend>Money</legend>
        <div className="sl-grid">
          {numField('accountSize', 'Account (USDT)', 'Fixed, so every trade risks the same')}
          {numField('riskPercent', 'Risk per trade (%)', 'Loss at the stop, fees included')}
          {numField('maxLeverage', 'Max leverage', 'Caps the size when the stop is tight', '1')}
          {numField('slippagePercent', 'Slippage (%)', 'On entries and stop exits')}
        </div>
        <small className="sl-hint">Bybit futures taker fee (0.055%) is charged on every entry and exit.</small>
      </fieldset>
    </div>
  )
}

export default RulesForm
