/**
 * Web Push subscriptions, so forward-test alerts arrive even with every
 * Traddii tab closed. The subscription (an address only this browser's push
 * service can deliver to) is stored on the user's account document; the
 * server runner sends to it.
 */
import { deleteField, doc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../config/firebase'
import { VAPID_PUBLIC_KEY } from '../../config/push'

const SW_URL = '/push-sw.js'

export const pushAvailable = (): boolean =>
  !!VAPID_PUBLIC_KEY && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window

const keyBytes = (base64url: string): Uint8Array<ArrayBuffer> => {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Short stable id for a subscription endpoint, used as its key in Firestore */
const idFor = async (endpoint: string): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return [...new Uint8Array(hash)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Subscribe this browser and save the subscription. Needs notification permission already granted. */
export const enablePush = async (userId: string): Promise<boolean> => {
  if (!pushAvailable()) return false
  const registration = await navigator.serviceWorker.register(SW_URL)
  await navigator.serviceWorker.ready
  const subscription = (await registration.pushManager.getSubscription())
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) })
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false
  await setDoc(doc(db, 'users', userId), {
    pushSubscriptions: {
      [await idFor(json.endpoint)]: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }, createdAt: new Date().toISOString() }
    }
  }, { merge: true })
  return true
}

/** Unsubscribe this browser and forget its subscription */
export const disablePush = async (userId: string): Promise<void> => {
  if (!pushAvailable()) return
  const registration = await navigator.serviceWorker.getRegistration(SW_URL)
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  const id = await idFor(subscription.endpoint)
  await subscription.unsubscribe().catch(() => false)
  await updateDoc(doc(db, 'users', userId), { [`pushSubscriptions.${id}`]: deleteField() }).catch(error => console.error('Could not remove the push subscription:', error))
}
