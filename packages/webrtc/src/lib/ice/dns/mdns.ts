import {createSocket, type RemoteInfo, type Socket} from 'node:dgram'
import {EventEmitter} from 'node:events'

/**
 * A record of an mDNS answer
 */
export interface MdnsAnswer {
    name: string
    type: 'A' | 'AAAA' | number
    ttl: number
    data: string | Buffer
}

const multicastAddress: string = '224.0.0.251'
const multicastPort: number = 5353
const typeCodes: Record<'A' | 'AAAA', number> = {A: 1, AAAA: 28}

//A name as DNS labels: each label prefixed with its length, then a zero
function encodeName(name: string): Buffer {
    const parts: Buffer[] = name.replace(/\.$/, '').split('.').map((label: string): Buffer => {
        const bytes: Buffer = Buffer.from(label, 'utf8')
        return Buffer.concat([Buffer.from([bytes.length]), bytes])
    })
    return Buffer.concat([...parts, Buffer.from([0])])
}

//A name at an offset, following the compression pointers (RFC 1035 section 4.1.4); the offset after it
function decodeName(packet: Buffer, start: number): [string, number] {
    const labels: string[] = []
    let offset: number = start
    let end: number = -1
    for (let jumps: number = 0; jumps < 64; jumps++) {
        const length: number = packet[offset]
        if (length === undefined) throw new Error('truncated name')
        if (length === 0) {
            offset++
            break
        }
        if ((length & 0xc0) === 0xc0) {
            if (end < 0) end = offset + 2
            offset = ((length & 0x3f) << 8) | packet[offset + 1]
            continue
        }
        labels.push(packet.toString('utf8', offset + 1, offset + 1 + length))
        offset += 1 + length
    }
    return [labels.join('.'), end < 0 ? offset : end]
}

function formatAddress(type: number, data: Buffer): string | Buffer {
    if (type === typeCodes.A && data.length === 4) return Array.from(data).join('.')
    if (type === typeCodes.AAAA && data.length === 16) {
        const groups: string[] = []
        for (let i: number = 0; i < 16; i += 2) groups.push(data.readUInt16BE(i).toString(16))
        return groups.join(':')
    }
    return data
}

/**
 * The answers (and additional records) of an mDNS response; undefined when the packet is a query or malformed
 */
export function parseMdnsResponse(packet: Buffer): MdnsAnswer[] | undefined {
    try {
        if (packet.length < 12 || !(packet[2] & 0x80)) return undefined
        const questions: number = packet.readUInt16BE(4)
        const records: number = packet.readUInt16BE(6) + packet.readUInt16BE(8) + packet.readUInt16BE(10)
        let offset: number = 12
        for (let i: number = 0; i < questions; i++) offset = decodeName(packet, offset)[1] + 4
        const answers: MdnsAnswer[] = []
        for (let i: number = 0; i < records; i++) {
            const [name, next] = decodeName(packet, offset)
            const type: number = packet.readUInt16BE(next)
            const ttl: number = packet.readUInt32BE(next + 4)
            const length: number = packet.readUInt16BE(next + 8)
            const data: Buffer = packet.subarray(next + 10, next + 10 + length)
            offset = next + 10 + length
            const known: 'A' | 'AAAA' | undefined = type === typeCodes.A ? 'A' : type === typeCodes.AAAA ? 'AAAA' : undefined
            answers.push({name, type: known ?? type, ttl, data: formatAddress(type, data)})
        }
        return answers
    } catch {
        return undefined
    }
}

/**
 * A query of one name: no id, no flags, one question of class IN
 */
export function encodeMdnsQuery(name: string, type: 'A' | 'AAAA'): Buffer {
    const header: Buffer = Buffer.alloc(12)
    header.writeUInt16BE(1, 4)
    const question: Buffer = Buffer.alloc(4)
    question.writeUInt16BE(typeCodes[type], 0)
    question.writeUInt16BE(1, 2)
    return Buffer.concat([header, encodeName(name), question])
}

/**
 * A client of multicast DNS (RFC 6762) that only queries: it joins the group on port 5353 (shared with the other
 * responders of the host) and emits the answers of every response it hears
 */
export class MulticastDns extends EventEmitter<{response: [MdnsAnswer[], RemoteInfo], error: [Error]}> {
    readonly #socket: Socket
    readonly #ready: Promise<void>

    constructor() {
        super()
        this.#socket = createSocket({type: 'udp4', reuseAddr: true})
        this.#socket.on('error', (error: Error): void => void this.emit('error', error))
        this.#socket.on('message', (message: Buffer, remote: RemoteInfo): void => {
            const answers: MdnsAnswer[] | undefined = parseMdnsResponse(message)
            if (answers?.length) this.emit('response', answers, remote)
        })
        this.#ready = new Promise<void>((resolve: () => void): void => {
            this.#socket.bind(multicastPort, (): void => {
                try {
                    this.#socket.addMembership(multicastAddress)
                    this.#socket.setMulticastTTL(255)
                    this.#socket.setMulticastLoopback(true)
                } catch (error) {
                    this.emit('error', error as Error)
                }
                resolve()
            })
        })
    }

    /**
     * Sends a query of a name to the group
     */
    async query(name: string, type: 'A' | 'AAAA' = 'A'): Promise<void> {
        await this.#ready
        await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
            this.#socket.send(encodeMdnsQuery(name, type), multicastPort, multicastAddress, (error: Error | null): void => error ? reject(error) : resolve())
        })
    }

    /**
     * Leaves the group and closes the socket
     */
    destroy(): void {
        try {
            this.#socket.close()
        } catch {
            //Already closed
        }
    }
}
