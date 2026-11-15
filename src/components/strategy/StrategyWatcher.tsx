import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/auth'
import { intervalMs } from '../../services/ohlcvService'
import { onReplay, replayStrategies } from '../../services/strategy/forward'
import { alertsOn, notifyReplay } from '../../services/strategy/alerts'
import { mirrorReplay } from '../../services/strategy/mirror'
import { enablePush, pushAvailable } from '../../services/strategy/push'
import { subscribeToStrategies } from '../../services/strategy/strategyStore'
import type { SavedStrategy } from '../../services/strategy/types'

/** Wait this long after a candle closes, so Bybit has published it */
const SETTLE_MS = 15_000
const TICK_MS = 20_000

const slotOf = (s: SavedStrategy, now: number): number | null => {
  const ms = intervalMs(s.timeframe)
  return ms ? Math.floor((now - SETTLE_MS) / ms) : null
}

/**
 * Runs signed-in users' forward tests in the background while any Traddii
 * tab is open: once when the app opens, then after every candle close of
 * each strategy's timeframe. Shows alerts and mirrors entries on Bybit Demo
 * where switched on. Renders nothing.
 */
const StrategyWatcher = () => {
  const { user } = useAuth()
  const uid = user?.uid ?? null
  const [strategies, setStrategies] = useState<SavedStrategy[]>([])
  const latest = useRef<SavedStrategy[]>([])
  /** The candle (as a count of candle lengths since 1970) each strategy was last replayed up to */
  const lastSlot = useRef(new Map<string, number>())

  useEffect(() => {
    if (!uid) {
      latest.current = []
      return
    }
    return subscribeToStrategies(uid, list => {
      // A strategy seen for the first time is caught up by the replay below, so start timing it now
      const now = Date.now()
      for (const s of list) {
        const slot = slotOf(s, now)
        if (slot !== null && !lastSlot.current.has(s.id)) lastSlot.current.set(s.id, slot)
      }
      latest.current = list
      setStrategies(list)
    })
  }, [uid])

  // Alerts in this tab, and mirroring on Bybit Demo when the user switched it on
  useEffect(() => onReplay(r => {
    notifyReplay(r)
    const s = latest.current.find(x => x.id === r.strategyId)
    if (uid && s) void mirrorReplay(uid, s, r)
  }), [uid])

  // Push subscriptions can change; refresh this browser's once per visit
  useEffect(() => {
    if (uid && alertsOn() && pushAvailable()) enablePush(uid).catch(error => console.error('Push refresh failed:', error))
  }, [uid])

  // Catch up when the app opens, and when a strategy is added, changed or resumed
  const activeKey = strategies.filter(s => s.active).map(s => `${s.id}:${s.version}:${s.forwardFrom}`).join('|')
  useEffect(() => {
    if (uid && activeKey) void replayStrategies(uid, latest.current)
  }, [uid, activeKey])

  // Then after each candle close
  useEffect(() => {
    if (!uid) return
    const slots = lastSlot.current
    const tick = () => {
      const now = Date.now()
      const due = latest.current.filter(s => {
        const slot = slotOf(s, now)
        if (!s.active || slot === null) return false
        const before = slots.get(s.id)
        slots.set(s.id, slot)
        return before !== undefined && before !== slot
      })
      if (due.length > 0) void replayStrategies(uid, due, true)
    }
    const timer = setInterval(tick, TICK_MS)
    return () => clearInterval(timer)
  }, [uid])

  return null
}

export default StrategyWatcher
