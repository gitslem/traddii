/**
 * Price formatting that stays readable for both BTC (60000) and DOGE (0.1234)
 */
export const formatPrice = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1000) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (abs >= 1) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  if (abs === 0) return '0'
  return value.toPrecision(4).replace(/0+$/, '').replace(/\.$/, '')
}

/** Unsigned dollars: $1,234.50 */
export const formatUsd = (value: number): string =>
  Number.isFinite(value)
    ? `$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—'

/** A profit or loss with its sign: +$12.30, -$4.00, $0.00 */
export const formatPnL = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 100) / 100
  return `${rounded > 0 ? '+' : rounded < 0 ? '-' : ''}${formatUsd(rounded)}`
}

/** An R-multiple with its sign: +1.4R, -1R */
export const formatR = (r: number): string => {
  if (!Number.isFinite(r)) return '—'
  const rounded = Math.round(r * 100) / 100
  return `${rounded > 0 ? '+' : ''}${rounded}R`
}

/** A length of time in the largest sensible unit: 35m, 4.2h, 3.1d */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const minutes = ms / 60_000
  if (minutes < 1) return 'under 1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = minutes / 60
  if (hours < 48) return `${Number(hours.toFixed(1))}h`
  return `${Number((hours / 24).toFixed(1))}d`
}
