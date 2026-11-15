/**
 * Scheduled forward-test runner (GitHub Actions, every 15 minutes).
 *
 * Replays every active saved strategy with the same code the browser uses
 * (src/services/strategy/replayCore.ts), saves new closed trades to the
 * owner's Journal, moves the strategy's progress on, and sends Web Push
 * alerts to the browsers the owner switched alerts on in.
 *
 * Needs these environment variables (GitHub secrets, created by
 * scripts/setup-strategy-runner.sh):
 *   FIREBASE_RUNNER_KEY  service account key JSON with Firestore access
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  Web Push keys (optional: no pushes without them)
 *
 * The logs of a public repository are public, so this prints counts only:
 * never user ids, emails, strategy names or trades.
 */
import { cert, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import webpush from 'web-push'
import { pathToFileURL } from 'node:url'
import { fetchClosedCandles } from '../src/services/ohlcvService'
import { computeReplay } from '../src/services/strategy/replayCore'
import type { ReplayComputation } from '../src/services/strategy/replayCore'
import { strategiesFromDoc } from '../src/services/strategy/strategyData'
import { alertMessages } from '../src/services/strategy/alertMessages'
import type { SavedStrategy } from '../src/services/strategy/types'

const newTotals = () => ({ users: 0, strategies: 0, pairErrors: 0, trades: 0, pushes: 0, pushFailures: 0, errors: 0 })
type Totals = ReturnType<typeof newTotals>

/** Sends one push; rejects with an error carrying statusCode on failure (as web-push does) */
export type PushSender = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>

const stripUndefined = <T extends object>(data: T): T =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as T

/** Write new bot trades without ever overwriting one that already exists (the browser may have written it) */
const saveTrades = async (db: Firestore, uid: string, c: ReplayComputation, totals: Totals) => {
  const now = new Date().toISOString()
  for (const trade of c.toJournal) {
    const ref = db.collection('trades').doc(`${uid}_${trade.importId}`)
    try {
      await ref.create(stripUndefined({ ...trade, userId: uid, createdAt: now, updatedAt: now }))
      totals.trades++
    } catch (error) {
      // 6 = ALREADY_EXISTS
      if ((error as { code?: number }).code !== 6) throw error
    }
  }
}

/** Move the strategy's progress on, field by field, so changes the browser made meanwhile are kept */
const saveProgress = async (db: Firestore, uid: string, s: SavedStrategy, c: ReplayComputation): Promise<boolean> => {
  const ref = db.collection('users').doc(uid)
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const stored = strategiesFromDoc(snap.data()).find(x => x.id === s.id)
    // Deleted, or edited into a new version while this ran: leave it alone
    if (!stored || stored.version !== s.version || stored.forwardFrom !== s.forwardFrom) return false
    const updates: Record<string, unknown> = {}
    for (const [symbol, next] of Object.entries(c.nextProgress)) {
      const cur = stored.progress[symbol]
      const base = `strategies.${s.id}.progress.${symbol}`
      updates[`${base}.checkpoint`] = Math.max(cur?.checkpoint ?? 0, next.checkpoint)
      updates[`${base}.journaledThrough`] = Math.max(cur?.journaledThrough ?? 0, next.journaledThrough)
      if (next.openAlerted !== undefined) updates[`${base}.openAlerted`] = Math.max(cur?.openAlerted ?? 0, next.openAlerted)
    }
    // Totals are absolute; if the browser already counted more, keep its numbers
    if (c.stats.trades >= stored.stats.trades) updates[`strategies.${s.id}.stats`] = c.stats
    tx.update(ref, updates)
    return true
  })
}

interface StoredSubscription { endpoint: string; keys: { p256dh: string; auth: string } }

const sendPushes = async (db: Firestore, uid: string, data: Record<string, unknown> | undefined, s: SavedStrategy, c: ReplayComputation, send: PushSender, totals: Totals) => {
  const subs = Object.entries((data?.pushSubscriptions ?? {}) as Record<string, StoredSubscription>)
  if (subs.length === 0) return
  const messages = alertMessages({ strategyId: s.id, name: s.name, version: s.version, newOpens: c.newOpens, closed: c.closed })
  for (const m of messages) {
    for (const [id, sub] of subs) {
      try {
        await send(sub, JSON.stringify(m))
        totals.pushes++
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // The browser unsubscribed or the subscription expired
          await db.collection('users').doc(uid).update({ [`pushSubscriptions.${id}`]: FieldValue.delete() }).catch(() => undefined)
        } else {
          totals.pushFailures++
        }
      }
    }
  }
}

/** One pass over every user's active strategies */
export const runAll = async (db: Firestore, push: PushSender | null): Promise<Totals> => {
  const totals = newTotals()
  const users = await db.collection('users').get()
  for (const doc of users.docs) {
    const data = doc.data()
    const strategies = strategiesFromDoc(data).filter(s => s.active)
    if (strategies.length === 0) continue
    totals.users++
    for (const s of strategies) {
      totals.strategies++
      try {
        const c = await computeReplay(s)
        totals.pairErrors += c.pairs.filter(p => p.error).length
        if (!c.changed) continue
        await saveTrades(db, doc.id, c, totals)
        const saved = await saveProgress(db, doc.id, s, c)
        if (saved && push && (c.newOpens.length > 0 || c.closed.length > 0)) await sendPushes(db, doc.id, data, s, c, push, totals)
      } catch (error) {
        totals.errors++
        console.error(`A strategy replay failed: ${error instanceof Error ? error.message : 'unknown error'}`)
      }
    }
  }
  return totals
}

const main = async () => {
  const key = process.env.FIREBASE_RUNNER_KEY
  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST
  if (!key && !emulator) {
    console.log('FIREBASE_RUNNER_KEY is not set: the runner is not configured. See scripts/setup-strategy-runner.sh.')
    return
  }
  // Against the local emulator (for testing) no key is needed
  initializeApp(key ? { credential: cert(JSON.parse(key)) } : { projectId: process.env.GCLOUD_PROJECT ?? 'traddii' })
  const db = getFirestore()

  const pushReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
  if (pushReady) webpush.setVapidDetails('https://traddii.web.app', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!)
  else console.log('Web Push keys are not set: trades are saved but no alerts are sent.')

  // Fail loudly if this runner cannot reach Bybit (e.g. blocked for its region)
  try {
    const probe = await fetchClosedCandles('BTC/USDT', '1h', { count: 2 })
    if (probe.length === 0) throw new Error('empty response')
  } catch (error) {
    console.error(`Bybit could not be reached from this runner: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
    return
  }

  const totals = await runAll(db, pushReady ? (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 6 * 3600 }) : null)
  console.log(`Done. Users ${totals.users}, strategies ${totals.strategies}, new trades ${totals.trades}, pushes ${totals.pushes} (${totals.pushFailures} failed), pair errors ${totals.pairErrors}, errors ${totals.errors}.`)
  if (totals.errors > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Runner failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    process.exit(1)
  })
}
