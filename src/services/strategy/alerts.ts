/**
 * Notifications for forward-test trades, shown by an open Traddii tab at each
 * candle close (even in the background). The choice is kept per browser.
 */
import { alertMessages } from './alertMessages'
import type { ForwardResult } from './forward'

const KEY = 'strategy-alerts'

export const alertsSupported = (): boolean => typeof window !== 'undefined' && 'Notification' in window

export const alertsOn = (): boolean => {
  if (!alertsSupported() || Notification.permission !== 'granted') return false
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

/** Ask for permission (must run from a click) and switch alerts on. Returns whether they are on. */
export const enableAlerts = async (): Promise<boolean> => {
  if (!alertsSupported()) return false
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return false
  try { localStorage.setItem(KEY, 'on') } catch { /* private mode: alerts last for this page only */ }
  return true
}

export const disableAlerts = () => {
  try { localStorage.setItem(KEY, 'off') } catch { /* nothing stored */ }
}

/** Show a replay's alerts in this tab, if alerts are on. The tag stops two tabs showing the same one twice. */
export const notifyReplay = (r: ForwardResult) => {
  if (!alertsOn()) return
  for (const m of alertMessages(r)) {
    try {
      new Notification(m.title, { body: m.body, tag: m.tag, icon: '/favicon.svg' })
    } catch (error) {
      console.error('Notification failed:', error)
    }
  }
}
