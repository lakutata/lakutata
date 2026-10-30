// The APIs the published packages must not use unguarded: the ones Node.js 18.10 (NW.js 0.70) or Node.js 19.3 (NW.js
// 0.72) lacks. `added` holds the versions adding an API as the documentation of Node.js lists them (all.json, the
// backports to the older release lines included): an API is in a version when one of its line adds it at or before the
// version, or when every listed line is older than the version. The methods of fetch come from undici (not in the
// documentation of Node.js) and the methods of ECMAScript from V8: their `added` is the first release line shipping them.
// refresh.mjs compares the entries from the documentation with a newer one of it.
//
// An entry: api (its name), pattern (what uses it in a line of code), added, source (node, undici or ecmascript),
// binding (a global also importable under that name: a file declaring the name is not checked), allow (the files using
// it knowingly, with the reason), change (`added` holds the versions of a change of the API, not of its addition: refresh.mjs
// does not compare it).

/**
 * The versions the published packages run on at least
 */
export const TARGETS = ['18.10.0', '19.3.0']

const version = text => text.replace(/^v/, '').split('.').map(Number)

function compare(a, b) {
    for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
    return 0
}

/**
 * Whether a version of Node.js has an API added in the versions given: one of its release line at or before it, else
 * every listed line older than its own (a backport to an older line does not reach the lines released before it)
 * @param added The versions adding the API, as the documentation of Node.js lists them.
 * @param target The version of Node.js.
 */
export function available(added, target) {
    const versions = added.map(version)
    const wanted = version(target)
    if (versions.some(v => v[0] === wanted[0] && compare(v, wanted) <= 0)) return true
    return Math.max(...versions.map(v => v[0])) < wanted[0]
}

const TURN_WORKERS_REASON = 'the TURN workers bind with reusePort once portsShareable() saw two sockets share a port; where the option is ignored the server relays in the main thread'

const ASYNC_DISPOSE_REASON = 'a method keyed by Symbol.asyncDispose: on Node.js 18.10 the key is "undefined", nothing fails, `await using` is not available'

export const APIS = [
    //node:zlib, node:os, node:util, node:events
    {api: 'zlib.crc32', pattern: /\bzlib\.crc32\(|\{[^}]*\bcrc32\b[^}]*\}\s*from\s*['"](node:)?zlib['"]/, added: ['v22.2.0', 'v20.15.0'], source: 'node'},
    {api: 'os.availableParallelism', pattern: /\bavailableParallelism\b/, added: ['v19.4.0', 'v18.14.0'], source: 'node'},
    {api: 'util.styleText', pattern: /\bstyleText\b/, added: ['v21.7.0', 'v20.12.0'], source: 'node'},
    {api: 'util.parseEnv', pattern: /\butil\.parseEnv\(|\{[^}]*\bparseEnv\b[^}]*\}\s*from\s*['"](node:)?util['"]/, added: ['v21.7.0', 'v20.12.0'], source: 'node'},
    {api: 'util.aborted', pattern: /\butil\.aborted\(|\{[^}]*\baborted\b[^}]*\}\s*from\s*['"](node:)?util['"]/, added: ['v19.7.0', 'v18.16.0'], source: 'node'},
    {api: 'util.MIMEType', pattern: /\bMIMEType\b|\bMIMEParams\b/, added: ['v19.1.0', 'v18.13.0'], source: 'node'},
    {api: 'util.transferableAbortSignal', pattern: /\btransferableAbort(Signal|Controller)\b/, added: ['v18.11.0'], source: 'node'},
    {api: 'events.addAbortListener', pattern: /\baddAbortListener\b/, added: ['v20.5.0', 'v18.18.0'], source: 'node'},
    {api: 'events.getMaxListeners', pattern: /\bevents\.getMaxListeners\(|\{[^}]*\bgetMaxListeners\b[^}]*\}\s*from\s*['"](node:)?events['"]/, added: ['v19.9.0', 'v18.17.0'], source: 'node'},
    //node:process, node:module, import.meta
    {api: 'process.loadEnvFile', pattern: /\bloadEnvFile\b/, added: ['v21.7.0', 'v20.12.0'], source: 'node'},
    {api: 'process.getBuiltinModule', pattern: /\bgetBuiltinModule\b/, added: ['v22.3.0', 'v20.16.0'], source: 'node'},
    {api: 'process.finalization', pattern: /\bprocess\.finalization\b/, added: ['v22.5.0'], source: 'node'},
    {api: 'process.features.typescript', pattern: /\bfeatures\.typescript\b/, added: ['v23.0.0', 'v22.10.0'], source: 'node'},
    {api: 'process.availableMemory', pattern: /\bprocess\.availableMemory\b/, added: ['v22.0.0', 'v20.13.0'], source: 'node'},
    {api: 'process.constrainedMemory', pattern: /\bprocess\.constrainedMemory\b/, added: ['v19.6.0', 'v18.15.0'], source: 'node'},
    {api: 'module.register', pattern: /\bmodule\.register\(|\{[^}]*\bregister\b[^}]*\}\s*from\s*['"](node:)?module['"]/, added: ['v20.6.0', 'v18.19.0'], source: 'node'},
    {api: 'module.enableCompileCache', pattern: /\benableCompileCache\b/, added: ['v22.8.0'], source: 'node'},
    {api: 'module.findPackageJSON', pattern: /\bfindPackageJSON\b/, added: ['v23.2.0', 'v22.14.0'], source: 'node'},
    {api: 'import.meta.dirname', pattern: /\bimport\.meta\.(dirname|filename)\b/, added: ['v21.2.0', 'v20.11.0'], source: 'node'},
    {api: 'import.meta.resolve', pattern: /\bimport\.meta\.resolve\b/, added: ['v20.6.0', 'v18.19.0'], source: 'node', change: 'without its flag and synchronous'},
    //node:fs, node:buffer, node:crypto
    {api: 'fs.glob', pattern: /\bfs\.(glob|globSync)\(|\bpromises\.glob\(|\{[^}]*\b(glob|globSync)\b[^}]*\}\s*from\s*['"](node:)?fs(\/promises)?['"]/, added: ['v22.0.0'], source: 'node'},
    {api: 'fs.statfs', pattern: /\bstatfs(Sync)?\(/, added: ['v19.6.0', 'v18.15.0'], source: 'node'},
    {api: 'fs.openAsBlob', pattern: /\bopenAsBlob\b/, added: ['v19.8.0'], source: 'node'},
    {api: 'Buffer.copyBytesFrom', pattern: /\bcopyBytesFrom\b/, added: ['v19.8.0', 'v18.16.0'], source: 'node'},
    {api: 'buffer.isUtf8', pattern: /\bisUtf8\(|\bisAscii\(/, added: ['v19.4.0', 'v18.14.0'], source: 'node'},
    {api: 'File', pattern: /\bnew File\(|\binstanceof File\b|\bglobalThis\.File\b|\{[^}]*\bFile\b[^}]*\}\s*from\s*['"](node:)?buffer['"]/, added: ['v20.0.0'], source: 'node'},
    {api: 'blob.bytes', pattern: /\.bytes\(\)/, added: ['v22.3.0', 'v20.16.0'], source: 'node'},
    {api: 'crypto.hash', pattern: /\bcrypto\.hash\(|\{[^}]*\bhash\b[^}]*\}\s*from\s*['"](node:)?crypto['"]/, added: ['v21.7.0', 'v20.12.0'], source: 'node'},
    {
        api: 'crypto (global)', change: 'without its flag', pattern: /(?<![\w.$])crypto\.(getRandomValues|randomUUID|subtle)\b|\bglobalThis\.crypto\b/, added: ['v19.0.0'], source: 'node', binding: 'crypto', allow: [
            {file: 'packages/orm/vendor/typeorm/util/RandomGenerator.ts', reason: 'checks for globalThis.crypto and its methods, else falls back'}
        ]
    },
    //The globals of the web
    {api: 'WebSocket (global)', change: 'without its flag', pattern: /\bnew WebSocket\(|\bglobalThis\.WebSocket\b|\btypeof WebSocket\b/, added: ['v22.0.0'], source: 'node', binding: 'WebSocket'},
    {api: 'navigator', pattern: /(?<![\w.$])navigator\./, added: ['v21.0.0'], source: 'node', binding: 'navigator'},
    {api: 'localStorage', pattern: /(?<![\w.$])(localStorage|sessionStorage)\./, added: ['v22.4.0'], source: 'node'},
    {api: 'CustomEvent (global)', pattern: /\bnew CustomEvent\(/, added: ['v19.0.0'], source: 'node', binding: 'CustomEvent'},
    {api: 'AbortSignal.any', pattern: /\bAbortSignal\.any\(/, added: ['v20.3.0', 'v18.17.0'], source: 'node'},
    {api: 'ReadableStream.from', pattern: /\bReadableStream\.from\(/, added: ['v20.6.0'], source: 'node'},
    {api: 'URL.canParse', pattern: /\bURL\.canParse\(/, added: ['v19.9.0', 'v18.17.0'], source: 'node'},
    {api: 'URL.parse', pattern: /\bURL\.parse\(/, added: ['v22.1.0'], source: 'node'},
    {api: 'URLSearchParams.size', pattern: /\bsearchParams\.size\b/, added: ['v19.8.0', 'v18.16.0'], source: 'node'},
    {api: 'Headers.getSetCookie', pattern: /\bgetSetCookie\(/, added: ['v19.7.0', 'v18.16.0'], source: 'undici'},
    //node:stream, node:diagnostics_channel, node:net, node:dgram, node:http, node:worker_threads, node:dns
    {api: 'stream.isDestroyed', pattern: /\bisDestroyed\(|\b(get|set)DefaultHighWaterMark\b/, added: ['v19.9.0', 'v18.17.0'], source: 'node'},
    {api: 'stream.duplexPair', pattern: /\bduplexPair\b/, added: ['v22.6.0', 'v20.17.0'], source: 'node'},
    {api: 'diagnostics_channel.tracingChannel', pattern: /\btracingChannel\b/, added: ['v19.9.0', 'v18.19.0'], source: 'node'},
    {api: 'net.SocketAddress.parse', pattern: /\bSocketAddress\.parse\(/, added: ['v23.4.0', 'v22.13.0'], source: 'node'},
    {
        api: 'reusePort', pattern: /\breusePort\s*:/, added: ['v23.1.0', 'v22.12.0'], source: 'node', allow: [
            {file: 'packages/webrtc/src/turn/TURNWorkers.ts', reason: TURN_WORKERS_REASON},
            {file: 'packages/webrtc/src/turn/TURNWorker.ts', reason: TURN_WORKERS_REASON},
            {file: 'packages/webrtc/src/lib/turn/node/turnServer.ts', reason: TURN_WORKERS_REASON}
        ]
    },
    {api: 'net.setDefaultAutoSelectFamily', pattern: /\b(get|set)DefaultAutoSelectFamily\b/, added: ['v19.4.0'], source: 'node'},
    {api: 'response.writeEarlyHints', pattern: /\bwriteEarlyHints\(/, added: ['v18.11.0'], source: 'node'},
    {api: 'outgoingMessage.setHeaders', pattern: /\.setHeaders\(/, added: ['v19.6.0', 'v18.15.0'], source: 'node'},
    {api: 'worker_threads.postMessageToThread', pattern: /\bpostMessageToThread\b/, added: ['v22.5.0', 'v20.19.0'], source: 'node'},
    {api: 'worker_threads.markAsUncloneable', pattern: /\bmarkAsUncloneable\b|\bisMarkedAsUntransferable\b/, added: ['v23.0.0', 'v22.10.0'], source: 'node'},
    {api: 'dns.getDefaultResultOrder', pattern: /\bgetDefaultResultOrder\b/, added: ['v20.1.0', 'v18.17.0'], source: 'node'},
    //The modules of Node.js added later
    {api: 'node:sqlite', pattern: /['"]node:sqlite['"]/, added: ['v22.5.0'], source: 'node'},
    {api: 'node:sea', pattern: /['"]node:sea['"]/, added: ['v21.7.0', 'v20.12.0'], source: 'node'},
    //Explicit resource management: TypeScript compiles `using` to helpers needing Symbol.dispose and Symbol.asyncDispose
    {api: 'using', pattern: /^\s*(await\s+)?using\s+[\w$]+\s*=/, added: ['v20.4.0', 'v18.18.0'], source: 'node'},
    {
        api: 'Symbol.asyncDispose', pattern: /\bSymbol\.(async)?[dD]ispose\b/, added: ['v20.4.0', 'v18.18.0'], source: 'node', allow: [
            {file: 'packages/core/src/lib/base/BaseObject.ts', reason: ASYNC_DISPOSE_REASON},
            {file: 'packages/mutex/src/mutex/MutexLock.ts', reason: ASYNC_DISPOSE_REASON},
            {file: 'packages/orm/vendor/typeorm/query-runner/BaseQueryRunner.ts', reason: ASYNC_DISPOSE_REASON},
            {file: 'packages/orm/vendor/typeorm/query-runner/QueryRunner.ts', reason: 'a type: the method of the interface of BaseQueryRunner'},
            {file: 'packages/orm/vendor/typeorm/driver/mongodb/MongoQueryRunner.ts', reason: ASYNC_DISPOSE_REASON},
            {file: 'packages/orm/vendor/typeorm/driver/mongodb/typings.ts', reason: 'types only: the typings of the mongodb package'}
        ]
    },
    //ECMAScript, the version of V8 of Node.js 18 (10.2) and 19.3 (10.8) lacking them
    {api: 'Array.prototype.toSorted', pattern: /\.(toSorted|toReversed|toSpliced)\(/, added: ['v20.0.0'], source: 'ecmascript'},
    {api: 'Object.groupBy', pattern: /\b(Object|Map)\.groupBy\(/, added: ['v21.0.0'], source: 'ecmascript'},
    {api: 'Promise.withResolvers', pattern: /\bPromise\.withResolvers\(/, added: ['v22.0.0'], source: 'ecmascript'},
    {api: 'Promise.try', pattern: /\bPromise\.try\(/, added: ['v23.0.0'], source: 'ecmascript'},
    {api: 'Array.fromAsync', pattern: /\bArray\.fromAsync\(/, added: ['v22.0.0'], source: 'ecmascript'},
    {api: 'Set.prototype.isSubsetOf', pattern: /\.(symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/, added: ['v22.0.0'], source: 'ecmascript'},
    {api: 'Iterator helpers', pattern: /\bIterator\.from\(|\.(values|keys|entries)\(\)\.(map|filter|take|drop|flatMap|reduce|toArray|some|every|find)\(/, added: ['v22.0.0'], source: 'ecmascript'},
    {api: 'String.prototype.isWellFormed', pattern: /\.(isWellFormed|toWellFormed)\(/, added: ['v20.0.0'], source: 'ecmascript'},
    {api: 'ArrayBuffer.prototype.transfer', pattern: /\.transfer(ToFixedLength)?\(\)|\bmaxByteLength\b/, added: ['v20.0.0'], source: 'ecmascript'},
    {
        api: 'RegExp.escape', pattern: /\bRegExp\.escape\(|\bError\.isError\(|\bFloat16Array\b|\bMath\.sumPrecise\(|\bUint8Array\.from(Base64|Hex)\(|\.to(Base64|Hex)\(\)/, added: ['v24.0.0'], source: 'ecmascript', allow: [
            {file: 'packages/orm/vendor/typeorm/util/Uint8ArrayUtils.ts', reason: 'checks for Uint8Array.prototype.toHex, else falls back'}
        ]
    }
]
