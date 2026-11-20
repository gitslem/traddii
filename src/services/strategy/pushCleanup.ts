/**
 * Removes what the earlier push-alert setup left behind: a service worker in
 * this browser and saved push addresses on the account. Push alerts are no
 * longer used; alerts are shown by an open Traddii tab. Runs once per browser
 * and account.
 */
import { deleteField, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../config/firebase'

const doneKey = (userId: string) => `traddii-push-removed:${userId}`

export const removeOldPush = async (userId: string): Promise<void> => {
  try {
    if (localStorage.getItem(doneKey(userId))) return
  } catch {
    return
  }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    for (const reg of registrations) {
      const script = reg.active?.scriptURL ?? reg.waiting?.scriptURL ?? reg.installing?.scriptURL ?? ''
      if (!script.endsWith('/push-sw.js')) continue
      const subscription = await reg.pushManager?.getSubscription().catch(() => null)
      await subscription?.unsubscribe().catch(() => false)
      await reg.unregister().catch(() => false)
    }
  }
  await updateDoc(doc(db, 'users', userId), { pushSubscriptions: deleteField() }).catch(() => undefined)
  try { localStorage.setItem(doneKey(userId), '1') } catch { /* tries again next visit */ }
}
