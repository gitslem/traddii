/**
 * Public key for Web Push (VAPID). Public by design: browsers use it to check
 * that pushes come from Traddii's server runner, which holds the matching
 * private key. Both are created by scripts/setup-strategy-runner.sh and stored
 * as GitHub secrets; without it, alerts only work while a tab is open.
 */
export const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''
