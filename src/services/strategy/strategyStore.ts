/**
 * Saved strategies live on the user's own account document (users/{uid}),
 * as a map from id to strategy, next to their trading rules.
 */
import { deleteField, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../config/firebase'
import { normaliseStrategy, strategiesFromDoc } from './strategyData'
import type { PairProgress, SavedStrategy } from './types'

export { normaliseStrategy }

export const MAX_STRATEGIES = 10

const userDoc = (userId: string) => doc(db, 'users', userId)

/** Calls back with the user's strategies (oldest first) now and whenever they change */
export const subscribeToStrategies = (userId: string, callback: (strategies: SavedStrategy[]) => void): (() => void) =>
  onSnapshot(
    userDoc(userId),
    snap => callback(strategiesFromDoc(snap.data())),
    error => {
      console.error('Error loading strategies:', error)
      callback([])
    }
  )

/** Save a whole strategy, replacing what was stored under its id (so old progress does not linger) */
export const saveStrategy = async (userId: string, strategy: SavedStrategy): Promise<void> => {
  const { id, ...data } = strategy
  await updateDoc(userDoc(userId), { [`strategies.${id}`]: data }).catch(async error => {
    // No account document yet
    if ((error as { code?: string }).code !== 'not-found' && !/No document/i.test(String(error))) throw error
    await setDoc(userDoc(userId), { strategies: { [id]: data } }, { merge: true })
  })
}

/** Change a few fields of a saved strategy */
export const patchStrategy = (userId: string, id: string, fields: Partial<Omit<SavedStrategy, 'id'>>): Promise<void> =>
  setDoc(userDoc(userId), { strategies: { [id]: fields } }, { merge: true })

/** Change a few fields of one pair's progress */
export const patchPairProgress = (userId: string, id: string, symbol: string, fields: Partial<PairProgress>): Promise<void> =>
  setDoc(userDoc(userId), { strategies: { [id]: { progress: { [symbol]: fields } } } }, { merge: true })

export const deleteStrategy = (userId: string, id: string): Promise<void> =>
  updateDoc(userDoc(userId), { [`strategies.${id}`]: deleteField() })

export const newStrategyId = (): string =>
  `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
