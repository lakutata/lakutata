import {webcrypto} from 'node:crypto'

//The MCP SDK uses the global crypto (its session ids), which comes in Node.js 19: on Node.js 18 it is the webcrypto of
//node:crypto, the one Node.js 19 and later make global. Imported first by the exports of the package, before the SDK.
//node-compat: crypto (global)
if (!(globalThis as { crypto?: unknown }).crypto) Object.defineProperty(globalThis, 'crypto', {value: webcrypto, configurable: true, writable: true})
