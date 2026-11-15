/**
 * Quick tags for reviewing a trade. The Journal's "Your edge" report groups
 * results by these, so the lists are short and fixed (a setup can also be typed).
 */

/** Why the trade was taken. Several match what the Market and Price pages detect. */
export const SETUPS = [
  'Breakout',
  'Pullback',
  'Support bounce',
  'Resistance rejection',
  'Trend continuation',
  'Range trade',
  'Reversal',
  'Engulfing candle',
  'Hammer / pin bar',
  'Inside bar',
  'News / event'
]

/** State of mind when entering */
export const MINDSETS = ['Calm', 'Confident', 'FOMO', 'Revenge', 'Bored', 'Anxious', 'Tired']

/** What went wrong in the execution, whatever the result */
export const MISTAKES = [
  'Moved stop',
  'No stop',
  'Oversized',
  'Early exit',
  'Chased entry',
  'Held too long',
  'Overtraded'
]

export const MAX_SETUP_LENGTH = 40
