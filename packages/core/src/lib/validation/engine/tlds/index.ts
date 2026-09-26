/**
 * Derived from @hapi/tlds 1.1.4 src/index.ts (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import { TLDS } from './tlds.js'

export const tlds = new Set(TLDS.map((tld) => tld.toLowerCase()))
