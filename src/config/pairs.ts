/**
 * Trading pairs offered across Traddii (Calculator, Market, Price, Practice).
 *
 * To add a pair, add its base coin to POPULAR_BASES or OTHER_BASES. It must
 * trade as <BASE>USDT on Bybit USDT perpetuals, which supply the candles
 * (Market, Price), Practice and the AI brief. Coins Bybit only lists in
 * 1000-unit contracts (e.g. 1000PEPEUSDT) are not supported yet.
 */

// Shown first, in this order
const POPULAR_BASES = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'HYPE', 'SUI', 'LINK', 'ADA']

// Everything else, listed A-Z
const OTHER_BASES = [
  'AAVE', 'APT', 'ARB', 'ATOM', 'AVAX', 'BCH', 'DOT', 'ENA', 'ETC', 'FIL',
  'HBAR', 'INJ', 'LTC', 'NEAR', 'ONDO', 'OP', 'POL', 'RENDER', 'SEI', 'TAO',
  'TIA', 'TRX', 'UNI', 'WIF', 'WLD', 'XLM'
]

const toPair = (base: string) => `${base}/USDT`

/** Display pairs, e.g. 'BTC/USDT' */
export const POPULAR_PAIRS = POPULAR_BASES.map(toPair)
export const OTHER_PAIRS = [...OTHER_BASES].sort().map(toPair)
export const ALL_PAIRS = [...POPULAR_PAIRS, ...OTHER_PAIRS]

/** 'BTC/USDT' -> 'BTCUSDT' */
export const pairToSymbol = (pair: string) => pair.replace('/', '').toUpperCase()

/** 'BTCUSDT' -> 'BTC/USDT' */
export const symbolToPair = (symbol: string) => symbol.toUpperCase().replace(/USDT$/, '/USDT')

/**
 * A pair typed by hand that may not be on the list (the Journal accepts any
 * pair): 'pepe' -> 'PEPE/USDT', 'pepeusdt' -> 'PEPE/USDT', 'btc/usd' -> 'BTC/USD'
 */
export const customPair = (text: string): string | null => {
  const m = text.trim().toUpperCase().match(/^([A-Z0-9]{2,14})(?:\s*[/\-_ ]\s*([A-Z0-9]{2,6}))?$/)
  if (!m) return null
  if (m[2]) return `${m[1]}/${m[2]}`
  const joined = m[1].match(/^([A-Z0-9]{2,10})(USDT|USDC|USD)$/)
  return joined ? `${joined[1]}/${joined[2]}` : `${m[1]}/USDT`
}

export const isSupportedPair = (pair: string) => ALL_PAIRS.includes(pair)
export const isSupportedSymbol = (symbol: string) => isSupportedPair(symbolToPair(symbol))

