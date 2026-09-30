/**
 * The progress of the builds of BuildKit: the "aux" of the messages "moby.buildkit.trace" of a build is a StatusResponse
 * of BuildKit (github.com/moby/buildkit, api/services/control/control.proto), encoded by protobuf then base64. Only the
 * fields read are decoded, by their numbers in control.proto:
 *
 *   StatusResponse: 1 vertexes (Vertex), 2 statuses (VertexStatus), 3 logs (VertexLog), 4 warnings (VertexWarning)
 *   Vertex: 1 digest, 3 name, 4 cached, 5 started (Timestamp), 6 completed (Timestamp), 7 error
 *   VertexStatus: 1 ID, 2 vertex, 3 name, 4 current, 5 total, 8 completed (Timestamp)
 *   VertexLog: 1 vertex, 3 stream, 4 msg
 *   VertexWarning: 1 vertex, 2 level, 3 short
 *   Timestamp (google.protobuf): 1 seconds, 2 nanos
 */

export type BuildKitVertex = {
    digest: string
    name: string
    cached: boolean
    /**
     * The start and the end of the step, in milliseconds since the epoch
     */
    started?: number
    completed?: number
    error?: string
}

export type BuildKitVertexStatus = {
    id: string
    vertex: string
    name: string
    current: number
    total: number
    completed?: number
}

export type BuildKitVertexLog = {
    vertex: string
    /**
     * 1 stdout, 2 stderr
     */
    stream: number
    message: Buffer
}

export type BuildKitVertexWarning = {
    vertex: string
    level: number
    short: string
}

export type BuildKitStatus = {
    vertexes: BuildKitVertex[]
    statuses: BuildKitVertexStatus[]
    logs: BuildKitVertexLog[]
    warnings: BuildKitVertexWarning[]
}

/**
 * A field of a protobuf message: its number, and its value (a varint as a bigint, a length-delimited value as bytes)
 */
type ProtobufField = {
    number: number
    value: bigint | Buffer
}

/**
 * The fields of a protobuf message (the wire format: varints, 64 and 32 bits values, length-delimited values)
 * @param buffer
 */
function ProtobufFields(buffer: Buffer): ProtobufField[] {
    const fields: ProtobufField[] = []
    let offset: number = 0
    const varint = (): bigint => {
        let result: bigint = 0n
        let shift: bigint = 0n
        while (offset < buffer.length) {
            const byte: number = buffer[offset++]
            result |= BigInt(byte & 0x7f) << shift
            if (!(byte & 0x80)) return result
            shift += 7n
        }
        throw new Error('Truncated protobuf varint')
    }
    while (offset < buffer.length) {
        const key: number = Number(varint())
        const number: number = key >>> 3
        switch (key & 0x07) {
            case 0:
                fields.push({number: number, value: varint()})
                break
            case 1:
                fields.push({number: number, value: buffer.readBigUInt64LE(offset)})
                offset += 8
                break
            case 2: {
                const length: number = Number(varint())
                if (offset + length > buffer.length) throw new Error('Truncated protobuf value')
                fields.push({number: number, value: buffer.subarray(offset, offset + length)})
                offset += length
                break
            }
            case 5:
                fields.push({number: number, value: BigInt(buffer.readUInt32LE(offset))})
                offset += 4
                break
            default:
                throw new Error(`Unsupported protobuf wire type ${key & 0x07}`)
        }
    }
    return fields
}

const text = (value: bigint | Buffer): string => Buffer.isBuffer(value) ? value.toString() : ''
const bytes = (value: bigint | Buffer): Buffer => Buffer.isBuffer(value) ? value : Buffer.alloc(0)
const integer = (value: bigint | Buffer): number => Buffer.isBuffer(value) ? 0 : Number(BigInt.asIntN(64, value))

/**
 * A google.protobuf.Timestamp, in milliseconds since the epoch
 * @param value
 */
function Timestamp(value: bigint | Buffer): number | undefined {
    if (!Buffer.isBuffer(value)) return undefined
    let seconds: number = 0
    let nanos: number = 0
    for (const field of ProtobufFields(value)) {
        if (field.number === 1) seconds = integer(field.value)
        if (field.number === 2) nanos = integer(field.value)
    }
    //The zero timestamp is not set
    return seconds || nanos ? seconds * 1000 + Math.floor(nanos / 1e6) : undefined
}

/**
 * Decode the progress of a build: the "aux" of a message "moby.buildkit.trace"
 * @param aux the base64 of a StatusResponse
 */
export function DecodeBuildKitStatus(aux: string): BuildKitStatus {
    const status: BuildKitStatus = {vertexes: [], statuses: [], logs: [], warnings: []}
    for (const field of ProtobufFields(Buffer.from(aux, 'base64'))) {
        const message: ProtobufField[] = ProtobufFields(bytes(field.value))
        const get = (number: number): bigint | Buffer | undefined => message.find((candidate: ProtobufField): boolean => candidate.number === number)?.value
        switch (field.number) {
            case 1:
                status.vertexes.push({
                    digest: text(get(1) ?? 0n),
                    name: text(get(3) ?? 0n),
                    cached: integer(get(4) ?? 0n) === 1,
                    started: Timestamp(get(5) ?? 0n),
                    completed: Timestamp(get(6) ?? 0n),
                    error: text(get(7) ?? 0n) || undefined
                })
                break
            case 2:
                status.statuses.push({
                    id: text(get(1) ?? 0n),
                    vertex: text(get(2) ?? 0n),
                    name: text(get(3) ?? 0n),
                    current: integer(get(4) ?? 0n),
                    total: integer(get(5) ?? 0n),
                    completed: Timestamp(get(8) ?? 0n)
                })
                break
            case 3:
                status.logs.push({vertex: text(get(1) ?? 0n), stream: integer(get(3) ?? 0n), message: bytes(get(4) ?? 0n)})
                break
            case 4:
                status.warnings.push({vertex: text(get(1) ?? 0n), level: integer(get(2) ?? 0n), short: text(get(3) ?? 0n)})
                break
        }
    }
    return status
}

/**
 * The lines of the progress of a build, as "docker build --progress=plain" shows them: the steps are numbered in their
 * order ("#3 [2/2] RUN npm ci"), with their output, and whether they are cached, done ("#3 DONE 1.2s") or failed
 */
export class BuildKitProgress {

    readonly #steps: Map<string, { number: number, started: boolean, ended: boolean }> = new Map()

    /**
     * The incomplete last line of the output of each step
     */
    readonly #pending: Map<string, string> = new Map()

    /**
     * The number of a step, given when it is first seen
     * @param digest
     */
    protected step(digest: string): { number: number, started: boolean, ended: boolean } {
        let step = this.#steps.get(digest)
        if (!step) this.#steps.set(digest, step = {number: this.#steps.size + 1, started: false, ended: false})
        return step
    }

    /**
     * The lines of a status of the build
     * @param status
     */
    public lines(status: BuildKitStatus): string[] {
        const lines: string[] = []
        for (const vertex of status.vertexes) {
            const step = this.step(vertex.digest)
            if (!step.started && (vertex.started || vertex.cached)) {
                step.started = true
                lines.push(`#${step.number} ${vertex.name}`)
            }
            if (step.ended) continue
            if (vertex.cached) {
                step.ended = true
                lines.push(`#${step.number} CACHED`)
            } else if (vertex.error) {
                step.ended = true
                lines.push(...this.flush(vertex.digest), `#${step.number} ERROR: ${vertex.error}`)
            } else if (vertex.completed) {
                step.ended = true
                const seconds: string = vertex.started ? ` ${((vertex.completed - vertex.started) / 1000).toFixed(1)}s` : ''
                lines.push(...this.flush(vertex.digest), `#${step.number} DONE${seconds}`)
            }
        }
        for (const log of status.logs) {
            const output: string = (this.#pending.get(log.vertex) ?? '') + log.message.toString()
            const parts: string[] = output.split(/\r?\n/)
            this.#pending.set(log.vertex, parts.pop()!)
            const number: number = this.step(log.vertex).number
            parts.forEach((part: string): unknown => lines.push(`#${number} ${part}`))
        }
        for (const warning of status.warnings) lines.push(`#${this.step(warning.vertex).number} WARN: ${warning.short}`)
        return lines
    }

    /**
     * The incomplete last line of the output of a step
     * @param digest
     */
    protected flush(digest: string): string[] {
        const pending: string | undefined = this.#pending.get(digest)
        this.#pending.delete(digest)
        return pending ? [`#${this.step(digest).number} ${pending}`] : []
    }
}
