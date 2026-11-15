/** Trading rules are stored on the user's own account document (users/{uid}) */
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../../config/firebase'
import { EMPTY_RULES, normaliseRules } from './rules'
import type { TradingRules } from './rules'

const userDoc = (userId: string) => doc(db, 'users', userId)

/** Calls back with the user's rules now and whenever they change */
export const subscribeToRules = (userId: string, callback: (rules: TradingRules) => void): (() => void) =>
  onSnapshot(
    userDoc(userId),
    snap => callback(normaliseRules(snap.data()?.tradingRules)),
    error => {
      console.error('Error loading trading rules:', error)
      callback(EMPTY_RULES)
    }
  )

export const saveRules = (userId: string, rules: TradingRules): Promise<void> =>
  setDoc(userDoc(userId), { tradingRules: { ...rules, updatedAt: new Date().toISOString() } }, { merge: true })
