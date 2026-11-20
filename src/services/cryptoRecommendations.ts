import { CRYPTO_PAIRS, pairToSymbol } from '../config/pairs'

export interface CryptoRecommendation {
  symbol: string
  pair: string
  score: number
  volume24h: number
  priceChange24h: number
  volatility: number
  spread: number
  marketCap: number
  narrative: string
  reason: string
}

export interface MarketData {
  symbol: string
  price: number
  volume24h: number
  priceChange24h: number
  high24h: number
  low24h: number
  bid: number
  ask: number
  marketCap?: number
}

// Sector of each coin Traddii lists (matched on the exact coin, not a substring)
const MARKET_NARRATIVES: { coins: string[]; narrative: string }[] = [
  { coins: ['BTC', 'ETH', 'BNB'], narrative: 'Blue Chip' },
  { coins: ['RENDER', 'TAO', 'WLD'], narrative: 'AI & Machine Learning' },
  { coins: ['ARB', 'OP', 'POL'], narrative: 'Layer 2 Scaling' },
  { coins: ['ONDO', 'LINK'], narrative: 'Real World Assets' },
  { coins: ['FIL'], narrative: 'DePIN' },
  { coins: ['UNI', 'AAVE', 'ENA', 'HYPE'], narrative: 'DeFi' },
  { coins: ['XRP', 'XLM', 'LTC', 'BCH'], narrative: 'Payments' },
  { coins: ['DOGE', 'WIF'], narrative: 'Meme Coins' },
  {
    coins: ['SOL', 'AVAX', 'NEAR', 'SUI', 'APT', 'SEI', 'INJ', 'TIA', 'ADA', 'DOT', 'ATOM', 'HBAR', 'TRX', 'ETC'],
    narrative: 'Alt Layer 1s'
  }
]

// Every crypto pair Traddii lists, so each suggestion can be analysed and practised
const TRADING_PAIRS = CRYPTO_PAIRS.map(pairToSymbol)

// Bybit USDT perpetual ticker (all values are strings)
interface BybitTicker {
  symbol: string
  lastPrice: string
  bid1Price: string
  ask1Price: string
  price24hPcnt: string
  highPrice24h: string
  lowPrice24h: string
  turnover24h: string
}

class CryptoRecommendationService {
  private cache: Map<string, { data: MarketData[], timestamp: number }> = new Map()
  private readonly CACHE_DURATION = 5 * 60 * 1000 // 5 minutes
  // Bybit works for US visitors too; Binance answers them with HTTP 451
  private readonly BYBIT_TICKERS = 'https://api.bybit.com/v5/market/tickers?category=linear'

  async fetchMarketData(symbols: string[] = TRADING_PAIRS): Promise<MarketData[]> {
    const cacheKey = 'market_data'
    const cached = this.cache.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.data
    }

    try {
      // One request returns every ticker with its 24h stats and best bid/ask
      const response = await fetch(this.BYBIT_TICKERS)
      if (!response.ok) throw new Error(`Failed to fetch ticker data (HTTP ${response.status})`)
      const body: { retCode: number; retMsg: string; result?: { list?: BybitTicker[] } } = await response.json()
      if (body.retCode !== 0) throw new Error(body.retMsg || 'Bybit ticker error')

      const wanted = new Set(symbols)
      const marketData: MarketData[] = (body.result?.list ?? [])
        .filter(t => wanted.has(t.symbol))
        .map(t => ({
          symbol: t.symbol,
          price: parseFloat(t.lastPrice),
          volume24h: parseFloat(t.turnover24h),
          priceChange24h: parseFloat(t.price24hPcnt) * 100,
          high24h: parseFloat(t.highPrice24h),
          low24h: parseFloat(t.lowPrice24h),
          bid: parseFloat(t.bid1Price),
          ask: parseFloat(t.ask1Price)
        }))
        .filter(d => [d.price, d.volume24h, d.high24h, d.low24h, d.bid, d.ask].every(Number.isFinite) && d.price > 0)

      this.cache.set(cacheKey, { data: marketData, timestamp: Date.now() })
      return marketData
    } catch (error) {
      console.error('Error fetching market data:', error)
      return []
    }
  }

  calculateVolatility(data: MarketData): number {
    // Calculate volatility as percentage range of high-low relative to price
    const range = data.high24h - data.low24h
    return (range / data.price) * 100
  }

  calculateSpreadPercent(data: MarketData): number {
    // Calculate bid-ask spread as percentage
    return ((data.ask - data.bid) / data.price) * 100
  }

  detectNarrative(symbol: string): string {
    const coin = symbol.toUpperCase().replace(/USDT$/, '')
    return MARKET_NARRATIVES.find(n => n.coins.includes(coin))?.narrative ?? 'General Market'
  }

  checkStructure(data: MarketData): boolean {
    // Avoid coins with bad structure:
    // 1. Very low volume (< $1M)
    // 2. Extremely wide spreads (> 0.5%)
    // 3. Extreme volatility without volume (> 20% volatility with < $5M volume)

    if (data.volume24h < 1000000) return false // Low volume

    const spreadPercent = this.calculateSpreadPercent(data)
    if (spreadPercent > 0.5) return false // Wide spread

    const volatility = this.calculateVolatility(data)
    if (volatility > 20 && data.volume24h < 5000000) return false // High vol, low liquidity

    return true
  }

  calculateScore(data: MarketData): number {
    // Scoring system (0-100)
    let score = 0

    // 1. Volume Score (0-30 points): Higher is better
    const volumeScore = Math.min(30, (data.volume24h / 100000000) * 30)
    score += volumeScore

    // 2. Spread Score (0-25 points): Tighter is better
    const spreadPercent = this.calculateSpreadPercent(data)
    const spreadScore = Math.max(0, 25 - (spreadPercent * 100))
    score += spreadScore

    // 3. Volatility Score (0-25 points): Moderate volatility is ideal (3-8%)
    const volatility = this.calculateVolatility(data)
    let volatilityScore = 0
    if (volatility >= 3 && volatility <= 8) {
      volatilityScore = 25 // Ideal range
    } else if (volatility > 8 && volatility <= 15) {
      volatilityScore = 15 // High but tradeable
    } else if (volatility > 1 && volatility < 3) {
      volatilityScore = 10 // Low volatility
    } else {
      volatilityScore = 5 // Too low or too high
    }
    score += volatilityScore

    // 4. Momentum Score (0-20 points): Positive momentum preferred
    const momentumScore = Math.max(-10, Math.min(20, data.priceChange24h))
    score += momentumScore

    return Math.round(score)
  }

  generateReason(data: MarketData): string {
    const volatility = this.calculateVolatility(data)
    const spreadPercent = this.calculateSpreadPercent(data)
    const volumeM = (data.volume24h / 1000000).toFixed(0)

    const reasons = []

    if (data.volume24h > 100000000) {
      reasons.push('High liquidity')
    } else if (data.volume24h > 50000000) {
      reasons.push('Good liquidity')
    }

    if (spreadPercent < 0.05) {
      reasons.push('Tight spread')
    } else if (spreadPercent < 0.1) {
      reasons.push('Decent spread')
    }

    if (volatility >= 3 && volatility <= 8) {
      reasons.push('Ideal volatility')
    } else if (volatility > 8) {
      reasons.push('High volatility')
    }

    if (data.priceChange24h > 5) {
      reasons.push('Strong uptrend')
    } else if (data.priceChange24h > 2) {
      reasons.push('Positive momentum')
    } else if (data.priceChange24h < -5) {
      reasons.push('Strong correction')
    }

    return reasons.length > 0
      ? reasons.join(' • ')
      : `$${volumeM}M volume • ${volatility.toFixed(1)}% volatility`
  }

  async getTopRecommendations(count: number = 4): Promise<CryptoRecommendation[]> {
    try {
      const marketData = await this.fetchMarketData()

      // Filter out coins with bad structure
      const goodStructure = marketData.filter(data => this.checkStructure(data))

      // Calculate scores and create recommendations
      const recommendations: CryptoRecommendation[] = goodStructure.map(data => {
        const score = this.calculateScore(data)
        const narrative = this.detectNarrative(data.symbol)
        const reason = this.generateReason(data)
        const pair = data.symbol.replace('USDT', '/USDT')

        return {
          symbol: data.symbol,
          pair,
          score,
          volume24h: data.volume24h,
          priceChange24h: data.priceChange24h,
          volatility: this.calculateVolatility(data),
          spread: this.calculateSpreadPercent(data),
          marketCap: data.marketCap || 0,
          narrative,
          reason
        }
      })

      // Sort by score and return top N
      return recommendations
        .sort((a, b) => b.score - a.score)
        .slice(0, count)
    } catch (error) {
      console.error('Error generating recommendations:', error)
      return []
    }
  }

  clearCache() {
    this.cache.clear()
  }
}

export const cryptoRecommendationService = new CryptoRecommendationService()
