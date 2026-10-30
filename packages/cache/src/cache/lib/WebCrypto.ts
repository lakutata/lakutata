import {webcrypto} from 'node:crypto'

/**
 * Give the driver of MongoDB the global crypto it uses (the random bytes and the hashes of its SCRAM authentication),
 * which comes in Node.js 19: on Node.js 18 it is the webcrypto of node:crypto, the one Node.js 19 and later make global
 * @internal
 */
export function provideWebCrypto(): void {
    //node-compat: crypto (global)
    if (!(globalThis as { crypto?: unknown }).crypto) Object.defineProperty(globalThis, 'crypto', {value: webcrypto, configurable: true, writable: true})
}
