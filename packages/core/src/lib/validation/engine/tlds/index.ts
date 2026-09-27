/**
 * Derived from the upstream src/index.ts (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import { TLDS } from './tlds.js'

export const tlds = new Set(TLDS.map((tld) => tld.toLowerCase()))
