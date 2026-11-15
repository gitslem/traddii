/** Rounding order sizes and prices to an exchange's steps. Pure functions. */

const decimals = (step: number) => {
  const text = step.toString()
  if (text.includes('e-')) return Number(text.split('e-')[1])
  return text.includes('.') ? text.split('.')[1].length : 0
}

/** Size rounded down to the exchange's step, as the string Bybit expects */
export const roundQty = (qty: number, step: number): string => {
  const n = Math.floor(qty / step + 1e-9) * step
  return n.toFixed(decimals(step))
}

/** Price rounded to the exchange's tick, as the string Bybit expects */
export const roundPrice = (price: number, tick: number): string => (Math.round(price / tick) * tick).toFixed(decimals(tick))
