import {createHash, randomUUID, getRandomValues} from 'node:crypto'

//Self-implemented UUID on node:crypto (replaces the `uuid` package dependency).
//RFC 4122 + RFC 9562. v4 uses crypto.randomUUID(); v3/v5 use createHash; v1/v6 use timestamp + random.

const GREGORIAN_EPOCH_MS = -12219292800000n //1582-10-15 in JS epoch ms (negative)

const parseUUID = (uuid: string): Buffer => {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}

const formatUUID = (bytes: Uint8Array): string => {
    const h = Buffer.from(bytes).toString('hex')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

const namespaceUUID = (name: string | Uint8Array, namespace: string, version: 3 | 5): string => {
    const nsBytes = parseUUID(namespace)
    const nameBytes = typeof name === 'string' ? Buffer.from(name) : Buffer.from(name)
    const hash = createHash(version === 3 ? 'md5' : 'sha1').update(nsBytes).update(nameBytes).digest()
    hash[6] = (hash[6] & 0x0f) | (version << 4)
    hash[8] = (hash[8] & 0x3f) | 0x80
    return formatUUID(hash.subarray(0, 16))
}

let v1ClockSeq = 0
let v1LastMS = 0n

const uuidV1 = (): string => {
    const now = BigInt(Date.now()) - GREGORIAN_EPOCH_MS
    const ts100ns = now * 10000n + BigInt((performance.now() % 1) * 10000 | 0)
    if (ts100ns <= v1LastMS) v1ClockSeq = (v1ClockSeq + 1) & 0x3fff
    v1LastMS = ts100ns
    const ts = ts100ns.toString(16).padStart(16, '0')
    const timeLow = ts.slice(8, 16)
    const timeMid = ts.slice(4, 8)
    const timeHi = (parseInt(ts.slice(0, 4), 16) & 0x0fff | 0x1000).toString(16).padStart(4, '0')
    const clockSeq = ((v1ClockSeq & 0x3fff) | 0x8000).toString(16).padStart(4, '0')
    const nodeBytes = new Uint8Array(6)
    getRandomValues(nodeBytes)
    nodeBytes[0] |= 0x01
    return `${timeLow}-${timeMid}-${timeHi}-${clockSeq}-${Buffer.from(nodeBytes).toString('hex')}`
}

const uuidV6 = (): string => {
    const now = BigInt(Date.now()) - GREGORIAN_EPOCH_MS
    const ts100ns = now * 10000n + BigInt((performance.now() % 1) * 10000 | 0)
    if (ts100ns <= v1LastMS) v1ClockSeq = (v1ClockSeq + 1) & 0x3fff
    v1LastMS = ts100ns
    const ts = ts100ns.toString(16).padStart(16, '0')
    const timeHigh = ts.slice(0, 8)
    const timeMid = ts.slice(8, 12)
    const timeLow = (parseInt(ts.slice(12, 16), 16) & 0x0fff | 0x6000).toString(16).padStart(4, '0')
    const clockSeq = ((v1ClockSeq & 0x3fff) | 0x8000).toString(16).padStart(4, '0')
    const nodeBytes = new Uint8Array(6)
    getRandomValues(nodeBytes)
    nodeBytes[0] |= 0x01
    return `${timeHigh}-${timeMid}-${timeLow}-${clockSeq}-${Buffer.from(nodeBytes).toString('hex')}`
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-6][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class UUID {

    public static readonly NIL: string = '00000000-0000-0000-0000-000000000000'
    public static readonly MAX: string = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

    public static parse(uuid: string): Uint8Array {
        return parseUUID(uuid)
    }

    public static stringify(arr: Uint8Array, offset: number = 0): string {
        return formatUUID(arr.subarray(offset, offset + 16))
    }

    public static v1(): string {
        return uuidV1()
    }

    public static v3(value: string | Uint8Array, namespace: string): string {
        return namespaceUUID(value, namespace, 3)
    }

    public static v4(): string {
        return randomUUID()
    }

    public static v5(value: string | Uint8Array, namespace: string): string {
        return namespaceUUID(value, namespace, 5)
    }

    public static v6(): string {
        return uuidV6()
    }

    public static validate(uuid: string): boolean {
        return UUID_REGEX.test(uuid)
    }

    public static version(uuid: string): number {
        return parseInt(uuid.charAt(14), 16)
    }
}
