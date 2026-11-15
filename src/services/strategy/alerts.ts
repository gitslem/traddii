/**
 * Notifications for forward-test trades. In a tab they are shown straight
 * away at each candle close; with push switched on, the server runner also
 * sends them when every Traddii tab is closed. The choice is kept per browser.
 */
import { alertMessages } from './alertMessages'
import type { ForwardResult } from './forward'
import { disablePush, enablePush, pushAvailable } from './push'

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

export interface AlertsResult {
  on: boolean
  /** True when alerts also arrive with every tab closed */
  push: boolean
}

/** Ask for permission (must run from a click) and switch alerts on */
export const enableAlerts = async (userId: string): Promise<AlertsResult> => {
  if (!alertsSupported()) return { on: false, push: false }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return { on: false, push: false }
  try { localStorage.setItem(KEY, 'on') } catch { /* private mode: alerts last for this page only */ }
  let push = false
  try {
    push = await enablePush(userId)
  } catch (error) {
    console.error('Push subscription failed:', error)
  }
  return { on: true, push }
}

export const disableAlerts = async (userId: string) => {
  try { localStorage.setItem(KEY, 'off') } catch { /* nothing stored */ }
  await disablePush(userId).catch(error => console.error('Could not unsubscribe from push:', error))
}

export { pushAvailable }

/** Show a replay's alerts in this tab, if alerts are on. The tag stops repeats across tabs and pushes. */
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
