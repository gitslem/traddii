import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  getDocs,
  onSnapshot,
  writeBatch,
  type QuerySnapshot,
  type DocumentData
} from 'firebase/firestore'
import { db } from '../config/firebase'

export type TradeOutcome = 'win' | 'loss' | 'breakeven' | 'pending'
export type TradeMarket = 'spot' | 'futures' | 'margin'
export type TradeSource = 'manual' | 'calculator' | 'practice'

/** Fields of a trade that the app sets when saving (everything except ids and timestamps) */
export type NewTrade = Omit<Trade, 'id' | 'userId' | 'createdAt' | 'updatedAt'>

// Firestore rejects undefined values, so optional fields that were never set are dropped
const stripUndefined = <T extends object>(data: T): T =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as T

export interface Trade {
  id: string
  userId: string
  pair: string
  type: 'long' | 'short'
  entryPrice: number
  exitPrice?: number | null
  quantity: number
  quantityType: 'base' | 'quote' // 'base' = ETH in ETH/USDT, 'quote' = USDT in ETH/USDT
  entryDate: string
  exitDate?: string | null
  stopLoss?: number | null
  takeProfit?: number | null
  leverage: number
  exchange: string
  status: 'open' | 'closed'
  outcome: TradeOutcome
  /** Net result in the quote currency, after fees */
  profitLoss: number
  /** Net result as a percentage of the margin used */
  profitLossPercent: number
  /** Entry fee while open; entry plus exit fee once closed */
  fees: number
  notes: string
  tags: string[]
  screenshots: string[]
  createdAt: string
  updatedAt: string

  // Added later - older trades don't have these
  /** Spot, futures or margin. Missing on older trades: leverage above 1x is treated as futures. */
  market?: TradeMarket
  /** True when the user typed the fee instead of using the exchange estimate */
  feesManual?: boolean
  /** Where the trade came from */
  source?: TradeSource
  /** Paper or demo trade, kept apart from real-money results */
  isPractice?: boolean
  /** Id of the Practice trade this was imported from, so it is not imported twice */
  importId?: string
  /** Link to a chart of the trade (e.g. a TradingView snapshot) */
  chartUrl?: string

  // Review tags, used by the "Your edge" report
  /** Why the trade was taken, e.g. "Breakout" */
  setup?: string
  /** State of mind going in, e.g. "Calm" or "FOMO" */
  mindset?: string
  /** Whether the trade followed the plan; null = not answered */
  followedPlan?: boolean | null
  /** Execution mistakes, e.g. "Moved stop" */
  mistakes?: string[]
  /** How well the trade was executed, 1 to 5; null = not rated */
  rating?: number | null
}

export interface JournalNote {
  id: string
  userId: string
  title: string
  content: string
  category: 'strategy' | 'plan' | 'idea' | 'reflection' | 'concept' | 'general'
  tags: string[]
  relatedTrades: string[] // Array of trade IDs
  isPinned: boolean
  createdAt: string
  updatedAt: string
}

class FirestoreService {
  private collectionName = 'trades'
  private notesCollectionName = 'journal_notes'

  // Add a new trade
  async addTrade(userId: string, trade: NewTrade): Promise<string> {
    try {
      const tradeData = stripUndefined({
        ...trade,
        userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })

      const docRef = await addDoc(collection(db, this.collectionName), tradeData)
      return docRef.id
    } catch (error) {
      console.error('Error adding trade:', error)
      throw error
    }
  }

  // Add several trades in one write (all or nothing)
  async addTrades(userId: string, trades: NewTrade[]): Promise<void> {
    if (trades.length === 0) return
    try {
      const now = new Date().toISOString()
      // A batch holds at most 500 writes
      for (let i = 0; i < trades.length; i += 400) {
        const batch = writeBatch(db)
        for (const trade of trades.slice(i, i + 400)) {
          batch.set(doc(collection(db, this.collectionName)), stripUndefined({ ...trade, userId, createdAt: now, updatedAt: now }))
        }
        await batch.commit()
      }
    } catch (error) {
      console.error('Error adding trades:', error)
      throw error
    }
  }

  // Update an existing trade
  async updateTrade(tradeId: string, updates: Partial<Trade>): Promise<void> {
    try {
      const tradeRef = doc(db, this.collectionName, tradeId)
      await updateDoc(tradeRef, stripUndefined({
        ...updates,
        updatedAt: new Date().toISOString()
      }))
    } catch (error) {
      console.error('Error updating trade:', error)
      throw error
    }
  }

  // Delete a trade
  async deleteTrade(tradeId: string): Promise<void> {
    try {
      const tradeRef = doc(db, this.collectionName, tradeId)
      await deleteDoc(tradeRef)
    } catch (error) {
      console.error('Error deleting trade:', error)
      throw error
    }
  }

  // Get all trades for a user
  async getUserTrades(userId: string): Promise<Trade[]> {
    try {
      // Note: Removed orderBy to avoid needing a composite index
      // We'll sort client-side instead
      const q = query(
        collection(db, this.collectionName),
        where('userId', '==', userId)
      )

      const querySnapshot = await getDocs(q)
      const trades = this.convertToTrades(querySnapshot)

      // Sort by createdAt descending (newest first) on the client side
      return trades.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime()
        const dateB = new Date(b.createdAt).getTime()
        return dateB - dateA // Descending order
      })
    } catch (error) {
      console.error('Error getting user trades:', error)
      throw error
    }
  }

  // Listen to real-time updates for user trades
  subscribeToUserTrades(userId: string, callback: (trades: Trade[]) => void): () => void {
    // Note: Removed orderBy to avoid needing a composite index
    // We'll sort client-side instead
    const q = query(
      collection(db, this.collectionName),
      where('userId', '==', userId)
    )

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const trades = this.convertToTrades(querySnapshot)
      // Sort by createdAt descending (newest first) on the client side
      const sortedTrades = trades.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime()
        const dateB = new Date(b.createdAt).getTime()
        return dateB - dateA // Descending order
      })
      callback(sortedTrades)
    }, (error) => {
      console.error('Error listening to trades:', error)
    })

    return unsubscribe
  }

  // Helper method to convert Firestore documents to Trade objects
  private convertToTrades(querySnapshot: QuerySnapshot<DocumentData>): Trade[] {
    return querySnapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        ...data
      } as Trade
    })
  }

  // ============= JOURNAL NOTES METHODS =============

  // Add a new journal note
  async addNote(userId: string, note: Omit<JournalNote, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const noteData = {
        ...note,
        userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      const docRef = await addDoc(collection(db, this.notesCollectionName), noteData)
      return docRef.id
    } catch (error) {
      console.error('Error adding note:', error)
      throw error
    }
  }

  // Update an existing note
  async updateNote(noteId: string, updates: Partial<JournalNote>): Promise<void> {
    try {
      const noteRef = doc(db, this.notesCollectionName, noteId)
      await updateDoc(noteRef, {
        ...updates,
        updatedAt: new Date().toISOString()
      })
    } catch (error) {
      console.error('Error updating note:', error)
      throw error
    }
  }

  // Delete a note
  async deleteNote(noteId: string): Promise<void> {
    try {
      const noteRef = doc(db, this.notesCollectionName, noteId)
      await deleteDoc(noteRef)
    } catch (error) {
      console.error('Error deleting note:', error)
      throw error
    }
  }

  // Get all notes for a user
  async getUserNotes(userId: string): Promise<JournalNote[]> {
    try {
      const q = query(
        collection(db, this.notesCollectionName),
        where('userId', '==', userId)
      )

      const querySnapshot = await getDocs(q)
      const notes = this.convertToNotes(querySnapshot)

      // Sort by pinned first, then by updated date (newest first)
      return notes.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        const dateA = new Date(a.updatedAt).getTime()
        const dateB = new Date(b.updatedAt).getTime()
        return dateB - dateA
      })
    } catch (error) {
      console.error('Error getting user notes:', error)
      throw error
    }
  }

  // Listen to real-time updates for user notes
  subscribeToUserNotes(userId: string, callback: (notes: JournalNote[]) => void): () => void {
    const q = query(
      collection(db, this.notesCollectionName),
      where('userId', '==', userId)
    )

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const notes = this.convertToNotes(querySnapshot)
      // Sort by pinned first, then by updated date (newest first)
      const sortedNotes = notes.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        const dateA = new Date(a.updatedAt).getTime()
        const dateB = new Date(b.updatedAt).getTime()
        return dateB - dateA
      })
      callback(sortedNotes)
    }, (error) => {
      console.error('Error listening to notes:', error)
    })

    return unsubscribe
  }

  // Helper method to convert Firestore documents to Note objects
  private convertToNotes(querySnapshot: QuerySnapshot<DocumentData>): JournalNote[] {
    return querySnapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        ...data
      } as JournalNote
    })
  }
}

export const firestoreService = new FirestoreService()
