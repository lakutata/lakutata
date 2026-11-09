//The client against a hostile server: what Defensics' LDAP client suite covers, built here (there is no open suite
//for LDAP clients; PROTOS c06-ldapv3 is for servers). The client of the engine and the LDAPClient component run in a
//process of their own (client.mjs); the servers here answer their requests with responses that are wrong:
//  - encoding: every BER element of a valid response of each operation mutated in turn, as the encoding set of PROTOS
//    does for requests (its length, its tag, its content, the element removed, doubled, followed by another), then
//    mutations drawn at random from a seed
//  - application: message IDs that are not those asked, responses of another operation, entries after the end, a
//    flood of entries, paging that never ends, SASL that never ends, Notices that are not, StartTLS answered in
//    plain text, a server silent, slow, closing in the middle of a message, a message longer than the client takes
//  - component: the pool of LDAPClient given a hostile server first, then a good one (the engine's server)
//A case fails when the operation does not end within its time, ends with anything but a result or an exception of
//the package, when close() does not end, or the process throws; and the run when sockets or timers stay behind or the
//heap grows. Build the package first.
//
//   node test-env/hostile/run.mjs [--layers encoding,application,component] [--random 2000] [--seed 1]
//                                 [--concurrency 16] [--only <id>] [--out <results.json>] [--kill-after <cases>]
import {fork} from 'node:child_process'
import {writeFileSync} from 'node:fs'
import {connect, createServer} from 'node:net'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createDirectory, createLDAPServer, encodeMessage, ExtendedOperation, MemoryBackend, MessageReader, PagedResultsControl, SortResponseControl, VLVResponseControl} from '../../dist/esm/exports/LDAP.js'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = 'dc=example,dc=com'
const ADMIN = `cn=admin,${BASE}`
//A case must have ended by then: the client's own timeout is 1.5 seconds
const CAP = 10000
const BARRIER = 250
const HEAP_LIMIT = 50 * 1024 * 1024

const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, index, list) => item.startsWith('--') ? [...pairs, [item.slice(2), list[index + 1]]] : pairs, []))
const layers = (options.layers ?? 'encoding,application,component').split(',')
const concurrency = Number(options.concurrency ?? 16)

const result = (type, extra = {}) => ({type: type, resultCode: 0, matchedDN: '', diagnosticMessage: '', ...extra})
const message = (messageId, protocolOp, controls) => encodeMessage({messageId: messageId, protocolOp: protocolOp, ...controls ? {controls: controls} : {}})
const entry = (cn) => ({type: 'searchResultEntry', objectName: `cn=${cn},${BASE}`, attributes: [{type: 'cn', values: [Buffer.from(cn)]}, {type: 'objectClass', values: [Buffer.from('person')]}]})
const sequence = (...parts) => Buffer.concat([Buffer.from([0x30, parts.reduce((sum, part) => sum + part.length, 0)]), ...parts])

//The valid responses to the requests of each operation: messages for the request of a connection, by its number
const TEMPLATES = {
    bind: (request) => [message(request.messageId, result('bindResponse'))],
    referral: (request) => [message(request.messageId, result('bindResponse', {resultCode: 10, referral: ['ldap://elsewhere.example.com/']}))],
    search: (request) => [message(request.messageId, entry('a')), message(request.messageId, entry('b')), message(request.messageId, result('searchResultDone'))],
    reference: (request) => [message(request.messageId, entry('a')), message(request.messageId, {type: 'searchResultReference', uris: ['ldap://elsewhere.example.com/ou=x,dc=example,dc=com']}), message(request.messageId, result('searchResultDone'))],
    intermediate: (request) => [message(request.messageId, {type: 'intermediateResponse', name: '1.3.6.1.4.1.4203.1.9.1.4', value: sequence(Buffer.from([0x04, 0x01, 0x61]))}), message(request.messageId, entry('a')), message(request.messageId, result('searchResultDone'))],
    paged: (request, number) => [message(request.messageId, entry(`p${number}`)), message(request.messageId, result('searchResultDone'), [PagedResultsControl.encode({size: 0, cookie: number === 0 ? Buffer.from('next') : Buffer.alloc(0)})])],
    window: (request) => [message(request.messageId, entry('a')), message(request.messageId, result('searchResultDone'), [SortResponseControl.encode({result: 0}), VLVResponseControl.encode({targetPosition: 1, contentCount: 2, result: 0})])],
    compare: (request) => [message(request.messageId, result('compareResponse', {resultCode: 6}))],
    add: (request) => [message(request.messageId, result('addResponse'))],
    modify: (request) => [message(request.messageId, result('modifyResponse'))],
    delete: (request) => [message(request.messageId, result('deleteResponse'))],
    modifyDN: (request) => [message(request.messageId, result('modifyDNResponse'))],
    whoAmI: (request) => [message(request.messageId, result('extendedResponse', {value: Buffer.from(`dn:${ADMIN}`)}))],
    passwordModify: (request) => [message(request.messageId, result('extendedResponse', {value: sequence(Buffer.from([0x80, 0x06]), Buffer.from('n3wpwd'))}))],
    sasl: (request, number) => [message(request.messageId, number === 0 ? result('bindResponse', {resultCode: 14, serverSaslCredentials: Buffer.from('challenge')}) : result('bindResponse'))],
    startTLS: (request) => [message(request.messageId, result('extendedResponse', {name: ExtendedOperation.startTLS}))],
    notice: () => [message(0, result('extendedResponse', {resultCode: 52, diagnosticMessage: 'going down', name: ExtendedOperation.noticeOfDisconnection}))]
}
//The operation of the client each template answers
const OPERATION_OF = {referral: 'bind', reference: 'search', intermediate: 'search', notice: 'search'}

/**
 * The BER elements of bytes, as a tree: a primitive's content, a constructed element's children; an OCTET STRING whose
 * content is BER itself (a control value, an extended value) read into as well
 */
function parse(bytes, start = 0, end = bytes.length) {
    const nodes = []
    let index = start
    while (index < end) {
        const tag = bytes[index]
        let length = bytes[index + 1]
        let header = 2
        if (length & 0x80) {
            const count = length & 0x7f
            length = bytes.readUIntBE(index + 2, count)
            header = 2 + count
        }
        const content = bytes.subarray(index + header, index + header + length)
        const node = {tag: tag}
        if (tag & 0x20) node.children = parse(bytes, index + header, index + header + length)
        else if (tag === 0x04 && content[0] === 0x30 && wellFormed(content)) node.children = parse(content)
        else node.content = content
        nodes.push(node)
        index += header + length
    }
    return nodes
}

/**
 * Whether bytes are one whole BER element, its children too
 */
function wellFormed(bytes) {
    try {
        const walk = (start, end) => {
            let index = start
            while (index < end) {
                if (index + 2 > end) return false
                let length = bytes[index + 1]
                let header = 2
                if (length === 0x80) return false
                if (length & 0x80) {
                    const count = length & 0x7f
                    if (count > 4 || index + 2 + count > end) return false
                    length = bytes.readUIntBE(index + 2, count)
                    header = 2 + count
                }
                if (index + header + length > end) return false
                if ((bytes[index] & 0x20) && !walk(index + header, index + header + length)) return false
                index += header + length
            }
            return index === end
        }
        return walk(0, bytes.length)
    } catch {
        return false
    }
}

const lengthOf = (length) => length < 0x80 ? Buffer.from([length]) : length < 0x100 ? Buffer.from([0x81, length]) : length < 0x10000 ? Buffer.from([0x82, length >> 8, length & 0xff]) : Buffer.from([0x83, length >> 16, (length >> 8) & 0xff, length & 0xff])

/**
 * The bytes of a tree, the lengths those of the contents but where a mutation says otherwise
 */
function serialize(nodes) {
    return Buffer.concat(nodes.map((node) => {
        const content = node.children ? serialize(node.children) : node.content
        const tag = node.tagBytes ?? Buffer.from([node.tag])
        return Buffer.concat([tag, node.lengthBytes ?? lengthOf(content.length), content])
    }))
}

/**
 * The nodes of a tree in order, with their parents
 */
function walk(nodes, parent = undefined, list = []) {
    for (const node of nodes) {
        list.push({node: node, parent: parent ?? nodes})
        if (node.children) walk(node.children, node.children, list)
    }
    return list
}

//The mutations of an element, as PROTOS mutates those of requests
const MUTATIONS = {
    'length 0': (node) => (node.lengthBytes = Buffer.from([0x00])),
    'length - 1': (node, size) => size > 0 && (node.lengthBytes = lengthOf(size - 1)),
    'length + 1': (node, size) => (node.lengthBytes = lengthOf(size + 1)),
    'length 0x7f': (node) => (node.lengthBytes = Buffer.from([0x7f])),
    'length 0x81 0xff': (node) => (node.lengthBytes = Buffer.from([0x81, 0xff])),
    'indefinite length': (node) => (node.lengthBytes = Buffer.from([0x80])),
    'length 0xffffffff': (node) => (node.lengthBytes = Buffer.from([0x84, 0xff, 0xff, 0xff, 0xff])),
    'length of 5 bytes': (node) => (node.lengthBytes = Buffer.from([0x85, 0x00, 0x00, 0x00, 0x00, 0x01])),
    'tag form': (node) => (node.tagBytes = Buffer.from([node.tag ^ 0x20])),
    'tag class': (node) => (node.tagBytes = Buffer.from([node.tag ^ 0x80])),
    'tag application': (node) => (node.tagBytes = Buffer.from([node.tag ^ 0x40])),
    'tag above 30': (node) => (node.tagBytes = Buffer.from([node.tag | 0x1f, 0x7f])),
    'tag 0': (node) => (node.tagBytes = Buffer.from([0x00])),
    'empty': (node) => node.content ? (node.content = Buffer.alloc(0)) : (node.children = []),
    'integer padded to 7 bytes': (node) => node.content ? (node.content = Buffer.from([0, 0, 0, 0, 0, 0, node.content.at(-1) ?? 1])) : false,
    'integer of 7 bytes': (node) => node.content ? (node.content = Buffer.from([1, 0, 0, 0, 0, 0, 0])) : false,
    'integer of 127 bytes': (node) => node.content ? (node.content = Buffer.alloc(127, 0x7f)) : false,
    'not UTF-8': (node) => node.content ? (node.content = Buffer.from([0x61, 0xff, 0xfe, 0xc0, 0x80])) : false,
    '64 KB': (node) => node.content ? (node.content = Buffer.alloc(65536, 0x41)) : false,
    'NUL inside': (node) => node.content ? (node.content = Buffer.from('a\u0000b')) : false,
    'removed': (node, size, parent) => parent.splice(parent.indexOf(node), 1),
    'doubled': (node, size, parent) => parent.splice(parent.indexOf(node), 0, structuredClone(node)),
    'followed by an OCTET STRING': (node, size, parent) => parent.splice(parent.indexOf(node) + 1, 0, {tag: 0x04, content: Buffer.from('x')}),
    'followed by a byte': (node, size, parent) => parent.splice(parent.indexOf(node) + 1, 0, {tag: 0xff, content: Buffer.alloc(0)})
}

/**
 * A response with one element mutated: the message of the template, the element by its order, the mutation; undefined
 * when the mutation does not apply to that element
 */
function mutated(bytes, element, name) {
    const tree = parse(bytes)
    const target = walk(tree)[element]
    if (!target) return undefined
    const size = target.node.children ? serialize(target.node.children).length : target.node.content.length
    if (MUTATIONS[name](target.node, size, target.parent) === false) return undefined
    return serialize(tree)
}

/**
 * A pseudo-random generator with a seed (mulberry32)
 */
function random(seed) {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let value = state
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * Bytes mutated at random: bits flipped, bytes changed, cut, inserted, a part doubled
 */
function scramble(bytes, next) {
    let result = Buffer.from(bytes)
    for (let count = 1 + Math.floor(next() * 4); count > 0; count--) {
        const at = Math.floor(next() * result.length)
        switch (Math.floor(next() * 5)) {
            case 0:
                result[at] ^= 1 << Math.floor(next() * 8)
                break
            case 1:
                result[at] = Math.floor(next() * 256)
                break
            case 2:
                result = result.subarray(0, Math.max(1, at))
                break
            case 3:
                result = Buffer.concat([result.subarray(0, at), Buffer.from([Math.floor(next() * 256)]), result.subarray(at)])
                break
            default:
                result = Buffer.concat([result.subarray(0, at), result.subarray(at, at + 1 + Math.floor(next() * 8)), result.subarray(at)])
        }
    }
    return result
}

/**
 * A script that answers each request with the template, the first response mutated by a function of its bytes
 */
function templated(template, change, which = 0) {
    return {
        request: (request, context) => {
            if (request.protocolOp.type === 'unbindRequest' || request.protocolOp.type === 'abandonRequest') return
            const messages = TEMPLATES[template](request, context.count++)
            const index = template === 'notice' ? 0 : Math.min(which, messages.length - 1)
            if (context.count === 1) messages[index] = change(messages[index])
            for (const bytes of messages) context.socket.write(bytes)
        }
    }
}

/**
 * The cases of the encoding layer: each element of each response of each template, each mutation; then random ones
 */
function encodingCases() {
    const cases = []
    const sample = {messageId: 1, protocolOp: {type: 'searchRequest'}}
    for (const template of Object.keys(TEMPLATES)) {
        const messages = TEMPLATES[template](sample, 0)
        messages.forEach((bytes, which) => {
            const elements = walk(parse(bytes)).length
            for (let element = 0; element < elements; element++) {
                for (const name of Object.keys(MUTATIONS)) {
                    if (!mutated(bytes, element, name)) continue
                    cases.push({id: `encoding ${template} #${which}.${element} ${name}`, operation: OPERATION_OF[template] ?? template, script: templated(template, (original) => mutated(original, element, name) ?? original, which)})
                }
            }
        })
    }
    const next = random(Number(options.seed ?? 1))
    const names = Object.keys(TEMPLATES)
    for (let index = 0; index < Number(options.random ?? 2000); index++) {
        const template = names[Math.floor(next() * names.length)]
        const which = Math.floor(next() * 3)
        const seed = Math.floor(next() * 2 ** 31)
        cases.push({id: `random ${template} #${which} seed ${seed}`, operation: OPERATION_OF[template] ?? template, script: templated(template, (original) => scramble(original, random(seed)), which)})
    }
    return cases
}

/**
 * The cases of the application layer, by hand
 */
function applicationCases() {
    const answer = (build) => ({request: (request, context) => {
        if (request.protocolOp.type === 'unbindRequest' || request.protocolOp.type === 'abandonRequest') return
        build(request, context, context.count++)
    }})
    const write = (context, ...buffers) => {
        for (const bytes of buffers) context.socket.write(bytes)
    }
    const done = (id, extra) => message(id, result('searchResultDone'), extra)
    const slowly = async (socket, bytes, milliseconds) => {
        for (const byte of bytes) {
            if (socket.destroyed) return
            socket.write(Buffer.from([byte]))
            await new Promise((resolve) => setTimeout(resolve, milliseconds))
        }
    }
    return [
        {id: 'silent', operation: 'search', script: answer(() => undefined)},
        {id: 'closed on connection', operation: 'search', script: {connect: (context) => context.socket.destroy(), request: () => undefined}},
        {id: 'closed after the request', operation: 'search', script: answer((request, context) => context.socket.destroy())},
        {id: 'closed in the middle of a message', operation: 'search', script: answer((request, context) => {
            const bytes = done(request.messageId)
            context.socket.end(bytes.subarray(0, 5))
        })},
        {id: 'reset in the middle of the entries', operation: 'search', script: answer((request, context) => {
            write(context, message(request.messageId, entry('a')))
            context.socket.resetAndDestroy()
        })},
        {id: 'one byte at a time', operation: 'bind', script: answer((request, context) => void slowly(context.socket, message(request.messageId, result('bindResponse')), 20))},
        {id: 'slower than the timeout', operation: 'bind', script: answer((request, context) => void slowly(context.socket, message(request.messageId, result('bindResponse')), 200))},
        {id: 'a message ID not asked', operation: 'search', script: answer((request, context) => write(context, done(request.messageId + 100)))},
        {id: 'a message ID not asked, then the right one', operation: 'search', script: answer((request, context) => write(context, message(request.messageId + 100, entry('x')), done(request.messageId + 100), done(request.messageId)))},
        {id: 'message ID 0, not a Notice', operation: 'bind', script: answer((request, context) => write(context, message(0, result('bindResponse')), message(request.messageId, result('bindResponse'))))},
        {id: 'the response of another operation', operation: 'search', script: answer((request, context) => write(context, message(request.messageId, result('compareResponse', {resultCode: 6}))))},
        {id: 'an entry to a bind', operation: 'bind', script: answer((request, context) => write(context, message(request.messageId, entry('a')), message(request.messageId, result('bindResponse'))))},
        {id: 'entries after the end', operation: 'search', script: answer((request, context) => write(context, done(request.messageId), message(request.messageId, entry('late')), done(request.messageId)))},
        {id: 'two ends', operation: 'search', script: answer((request, context) => write(context, message(request.messageId, entry('a')), done(request.messageId), done(request.messageId)))},
        {id: 'more entries than the size limit asked', operation: 'search', script: answer((request, context) => {
            for (let index = 0; index < 100; index++) write(context, message(request.messageId, entry(`e${index}`)))
            write(context, done(request.messageId))
        })},
        {id: 'a flood of entries, no end', operation: 'search', script: answer((request, context) => {
            const bytes = message(request.messageId, entry('flood'))
            const flood = Buffer.concat(Array.from({length: 2000}, () => bytes))
            const pump = () => {
                while (!context.socket.destroyed && context.socket.write(flood)) {
                    if (Date.now() - context.started > 4000) return context.socket.destroy()
                }
                if (!context.socket.destroyed) context.socket.once('drain', pump)
            }
            context.started = Date.now()
            pump()
        })},
        {id: 'paging that gives the same cookie, no entries', operation: 'paged', script: answer((request, context) => write(context, done(request.messageId, [PagedResultsControl.encode({size: 0, cookie: Buffer.from('same')})])))},
        {id: 'paging that gives a new cookie, no entries', operation: 'paged', script: answer((request, context, number) => write(context, done(request.messageId, [PagedResultsControl.encode({size: 0, cookie: Buffer.from(`c${number}`)})])))},
        {id: 'paging that gives a new cookie and an entry each page', operation: 'paged', script: answer((request, context, number) => write(context, message(request.messageId, entry(`p${number}`)), done(request.messageId, [PagedResultsControl.encode({size: 0, cookie: Buffer.from(`c${number}`)})])))},
        {id: 'iterating pages that never end', operation: 'iterate', script: answer((request, context, number) => write(context, message(request.messageId, entry(`p${number}`)), done(request.messageId, [PagedResultsControl.encode({size: 0, cookie: Buffer.from(`c${number}`)})])))},
        {id: 'paging without the control in the answer', operation: 'paged', script: answer((request, context) => write(context, message(request.messageId, entry('a')), done(request.messageId)))},
        {id: 'SASL that never ends', operation: 'sasl', script: answer((request, context) => write(context, message(request.messageId, result('bindResponse', {resultCode: 14, serverSaslCredentials: Buffer.from('more')}))))},
        {id: 'a Notice of Disconnection of another name', operation: 'search', script: answer((request, context) => write(context, message(0, result('extendedResponse', {resultCode: 2, name: '1.2.3.4'})), done(request.messageId)))},
        {id: 'a Notice without a name', operation: 'search', script: answer((request, context) => write(context, message(0, result('extendedResponse', {resultCode: 2})), done(request.messageId)))},
        {id: 'a Notice, the connection left open', operation: 'search', script: answer((request, context) => write(context, message(0, result('extendedResponse', {resultCode: 52, name: ExtendedOperation.noticeOfDisconnection}))))},
        {id: 'StartTLS agreed, then plain text', operation: 'startTLS', script: answer((request, context) => write(context, message(request.messageId, result('extendedResponse', {name: ExtendedOperation.startTLS})), message(request.messageId, result('extendedResponse'))))},
        {id: 'StartTLS agreed, then nothing', operation: 'startTLS', script: answer((request, context) => write(context, message(request.messageId, result('extendedResponse', {name: ExtendedOperation.startTLS}))))},
        {id: 'StartTLS refused', operation: 'startTLS', script: answer((request, context) => write(context, message(request.messageId, result('extendedResponse', {resultCode: 2, name: ExtendedOperation.startTLS}))))},
        {id: 'a message longer than the client takes, only its header', operation: 'search', script: answer((request, context) => write(context, Buffer.from([0x30, 0x84, 0x00, 0x20, 0x00, 0x00])))},
        {id: 'a message just under what the client takes', operation: 'search', script: answer((request, context) => write(context, message(request.messageId, {type: 'searchResultEntry', objectName: `cn=big,${BASE}`, attributes: [{type: 'description', values: [Buffer.alloc(1000000, 0x61)]}]}), done(request.messageId)))},
        {id: 'bytes before any request', operation: 'whoAmI', script: {connect: (context) => context.socket.write(Buffer.from('HTTP/1.1 400 Bad Request\r\n\r\n')), request: () => undefined}},
        {id: 'a thousand responses to nothing asked', operation: 'whoAmI', script: answer((request, context) => {
            for (let index = 0; index < 1000; index++) write(context, done(request.messageId + 1 + index))
            write(context, message(request.messageId, result('extendedResponse', {value: Buffer.from('dn:')})))
        })},
        {id: 'a referral to a bind', operation: 'bind', script: answer((request, context) => write(context, message(request.messageId, result('bindResponse', {resultCode: 10, referral: ['ldap://127.0.0.1:1/']}))))},
        {id: 'references that point back here', operation: 'search', script: answer((request, context) => write(context, message(request.messageId, {type: 'searchResultReference', uris: Array.from({length: 1000}, () => `ldap://127.0.0.1:${context.socket.localPort}/${BASE}`)}), done(request.messageId)))},
        {id: 'a VLV answer far past the window', operation: 'window', script: answer((request, context) => write(context, done(request.messageId, [SortResponseControl.encode({result: 0}), VLVResponseControl.encode({targetPosition: 2 ** 31 - 1, contentCount: 2 ** 31 - 1, result: 0})])))},
        {id: 'a generated password that is not a string', operation: 'passwordModify', script: answer((request, context) => write(context, message(request.messageId, result('extendedResponse', {value: sequence(Buffer.from([0x80, 0x03, 0xff, 0xfe, 0x00]))}))))}
    ]
}

/**
 * The cases of the component: its pool given a hostile server first, then the good one; a server list whose first is
 * hostile
 */
function componentCases(good) {
    //The first connection hostile as the script says, the others passed to the good server
    const first = (script) => ({...script, pass: (context) => context.connection > 1})
    const garbage = {request: (request, context) => context.socket.write(Buffer.from([0x30, 0x03, 0x02, 0x01]))}
    return [
        {id: 'component: a broken first connection, then the good server', component: {steps: ['whoAmI', 'whoAmI']}, script: first(garbage)},
        {id: 'component: a first connection closed, then the good server', component: {steps: ['whoAmI', 'whoAmI']}, script: first({connect: (context) => context.socket.destroy(), request: () => undefined})},
        {id: 'component: a first connection silent, then the good server', component: {steps: ['whoAmI', 'whoAmI']}, script: first({request: () => undefined})},
        {id: 'component: its bind answered with garbage, then the good server', component: {steps: ['whoAmI', 'whoAmI'], options: {bindDN: ADMIN, password: 'secret'}}, script: first(garbage)},
        {id: 'component: authenticate against garbage, then the good server', component: {steps: ['authenticate', 'authenticate'], options: {bindDN: ADMIN, password: 'secret'}}, script: first(garbage)},
        {id: 'component: the first server of the list hostile', component: {steps: ['whoAmI', 'whoAmI'], second: true}, script: {connect: (context) => context.socket.destroy(), request: () => undefined}}
    ].map((test) => ({...test, good: good}))
}

/**
 * The servers of the slots: each runs the case it is given on the connections it takes
 */
function slotServer(slot, good) {
    const server = createServer((socket) => {
        const test = slot.test
        socket.on('error', () => undefined)
        //Each message as it is written, not held for the one after it
        socket.setNoDelay(true)
        if (!test) return socket.destroy()
        test.connections = (test.connections ?? 0) + 1
        const context = {socket: socket, count: 0, connection: test.connections}
        if (test.script.pass?.(context)) {
            const upstream = connect({host: '127.0.0.1', port: good})
            upstream.on('error', () => socket.destroy())
            socket.pipe(upstream).pipe(socket)
            return
        }
        const reader = new MessageReader({maxMessageSize: 16 * 1024 * 1024})
        test.script.connect?.(context)
        socket.on('data', (chunk) => {
            let messages
            try {
                messages = reader.push(chunk)
            } catch {
                return
            }
            for (const item of messages) if (item.message && !socket.destroyed) test.script.request(item.message, context)
        })
    })
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

/**
 * The client process
 */
async function startClient() {
    const child = fork(join(here, 'client.mjs'), [], {execArgv: ['--expose-gc'], stdio: ['ignore', 'ignore', 'pipe', 'ipc']})
    const client = {child: child, stderr: [], waiting: new Map(), stats: [], exit: undefined}
    child.stderr.on('data', (chunk) => client.stderr.push(...chunk.toString().split('\n').filter(Boolean)))
    child.on('message', (message) => {
        if (message.type === 'result') client.waiting.get(message.id)?.(message.result)
        else if (message.type === 'stats') client.stats.shift()?.(message)
        else if (message.type === 'crash') client.crash = message
    })
    child.on('exit', (code, signal) => {
        client.exit = signal ?? `code ${code}`
        for (const resolve of client.waiting.values()) resolve({kind: 'crash'})
        client.waiting.clear()
    })
    await new Promise((resolve) => child.once('message', resolve))
    client.run = (test, port) => new Promise((resolve) => {
        if (client.exit) return resolve({kind: 'crash'})
        let timer
        client.waiting.set(test.id, (value) => {
            clearTimeout(timer)
            client.waiting.delete(test.id)
            resolve(value)
        })
        timer = setTimeout(() => {
            client.waiting.delete(test.id)
            resolve({kind: 'hung'})
        }, CAP)
        const urls = test.component ? [...test.component.second ? [`ldap://127.0.0.1:${port}`, `ldap://127.0.0.1:${test.good}`] : [`ldap://127.0.0.1:${port}`]] : undefined
        child.send({type: 'case', test: {id: test.id, port: port, operation: test.operation, ...test.component ? {urls: urls, steps: test.component.steps, options: test.component.options ?? {}} : {}}})
    })
    client.measure = () => new Promise((resolve) => {
        client.stats.push(resolve)
        child.send({type: 'stats'})
    })
    return client
}

/**
 * What is wrong with how a case ended
 */
function wrong(ending) {
    if (ending.kind === 'hung') return 'did not end within 10 seconds'
    if (ending.kind === 'crash') return 'the client process ended'
    if (ending.kind === 'foreign') return `ended with ${ending.name}: ${ending.message}`
    if (!ending.closed) return 'close() did not end'
    if (ending.kind === 'steps') return ending.steps.map((step) => step.kind === 'foreign' ? `${step.step} ended with ${step.name}: ${step.message}` : undefined).filter(Boolean).join('; ') || undefined
    return undefined
}

//The good server: the engine with a few users
const good = createLDAPServer({backends: [new MemoryBackend(BASE)], access: {admins: [ADMIN]}, passwords: {iterations: 1000}})
const directory = createDirectory(good.connect({as: ADMIN}))
await directory.add(BASE, {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
await directory.add(ADMIN, {objectClass: ['person'], cn: 'admin', sn: 'admin', userPassword: 'secret'})
const people = await directory.createOrganizationalUnit(BASE, {ou: 'people'})
await directory.createUser(people, {uid: 'alice', cn: 'alice', sn: 'Example'}, 'alice-password')
const goodPort = await good.listen({host: '127.0.0.1', port: 0})

let all = [
    ...layers.includes('encoding') ? encodingCases() : [],
    ...layers.includes('application') ? applicationCases() : [],
    ...layers.includes('component') ? componentCases(goodPort) : []
]
if (options.only) all = all.filter((test) => test.id === options.only)
const slots = await Promise.all(Array.from({length: concurrency}, async () => {
    const slot = {test: undefined}
    slot.server = await slotServer(slot, goodPort)
    slot.port = slot.server.address().port
    return slot
}))
let client = await startClient()
const baseline = await client.measure()
const results = []
const failures = []
const heaps = [baseline.heapUsed]
let next = 0
let completed = 0
let restarts = 0
const started = performance.now()
while (next < all.length) {
    //A batch, then the client measured once its cases have all ended
    const batch = all.slice(next, next + BARRIER)
    next += batch.length
    let index = 0
    await Promise.all(slots.map(async (slot) => {
        while (index < batch.length) {
            const test = batch[index++]
            slot.test = test
            const caseStarted = performance.now()
            const ending = await client.run(test, slot.port)
            slot.test = undefined
            ending.time ??= performance.now() - caseStarted
            results.push({id: test.id, ...ending})
            const problem = wrong(ending)
            if (problem) failures.push({id: test.id, problem: problem})
            completed++
            if (options['kill-after'] && completed === Number(options['kill-after'])) client.child.kill('SIGKILL')
        }
    }))
    if (client.exit) {
        failures.push({id: client.crash?.inFlight?.join(', ') ?? '?', problem: `the client process ended (${client.exit}): ${client.crash?.error ?? client.stderr.join('\n')}`})
        restarts++
        client = await startClient()
        continue
    }
    if (client.stderr.length) failures.push({id: 'stderr', problem: client.stderr.splice(0).join('\n')})
    //The sockets and timers of the cases closed by now
    let stats = await client.measure()
    for (let tries = 0; tries < 20 && ((stats.resources.TCPSocketWrap ?? 0) > (baseline.resources.TCPSocketWrap ?? 0) || (stats.resources.Timeout ?? 0) > (baseline.resources.Timeout ?? 0)); tries++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        stats = await client.measure()
    }
    for (const name of ['TCPSocketWrap', 'TCPWRAP', 'Timeout', 'TLSWrap']) {
        if ((stats.resources[name] ?? 0) > (baseline.resources[name] ?? 0)) failures.push({id: `after case ${completed}`, problem: `${(stats.resources[name] ?? 0) - (baseline.resources[name] ?? 0)} ${name} left behind`})
    }
    heaps.push(stats.heapUsed)
}
const heap = heaps.at(-1) - heaps[0]
if (heap > HEAP_LIMIT) failures.push({id: 'heap', problem: `the heap grew by ${Math.round(heap / 1048576)} MB`})

const classes = {}
for (const item of results) {
    const key = item.kind === 'steps' ? `steps: ${item.steps.map((step) => `${step.step} ${step.kind === 'resolved' ? 'resolved' : step.name ?? step.kind}`).join(', ')}` : item.kind === 'rejected' ? `rejected: ${item.name}` : item.kind
    classes[key] = (classes[key] ?? 0) + 1
}
const times = results.map((item) => item.time).sort((a, b) => a - b)
console.log(`${results.length} cases (${layers.join(', ')}) in ${Math.round((performance.now() - started) / 1000)} s; the client restarted ${restarts} times`)
for (const [kind, count] of Object.entries(classes).sort(([, a], [, b]) => b - a)) console.log(`  ${String(count).padStart(5)}  ${kind}`)
console.log(`  time: median ${times[times.length >> 1]?.toFixed(1)} ms, 99% ${times[Math.floor(times.length * 0.99)]?.toFixed(1)} ms, max ${times.at(-1)?.toFixed(1)} ms`)
console.log(`  heap ${(heaps[0] / 1048576).toFixed(1)} MB at the start, ${(heaps.at(-1) / 1048576).toFixed(1)} MB at the end, at most ${(Math.max(...heaps) / 1048576).toFixed(1)} MB`)
const application = results.filter((item) => !item.id.startsWith('encoding') && !item.id.startsWith('random'))
if (application.length && application.length <= 100) for (const item of application) console.log(`    ${item.id}: ${item.kind === 'steps' ? item.steps.map((step) => `${step.step} ${step.kind === 'resolved' ? 'resolved' : step.name ?? step.kind}`).join(', ') : item.kind === 'rejected' ? `${item.name} (${item.message})` : item.kind} in ${Math.round(item.time)} ms`)
console.log(failures.length ? `FAILED: ${failures.length}` : 'passed')
for (const failure of failures.slice(0, 40)) console.log(`    ${failure.id}: ${failure.problem}`)
if (options.out) writeFileSync(options.out, JSON.stringify({results: results, failures: failures, heaps: heaps}, null, 1))
client.child.kill()
for (const slot of slots) slot.server.close()
await good.close()
process.exit(failures.length ? 1 : 0)
