/*
 * The streams of the Docker Engine API, rewritten from docker-modem (Copyright Pedro Dias, Apache License 2.0, see
 * THIRD_PARTY_NOTICES.md): the multiplexed output of the containers without TTY, and the JSON lines of the progresses
 */
import {Transform, type TransformCallback} from 'node:stream'

/**
 * The stream of a frame of a multiplexed output
 */
export enum DockerStreamType {
    STDIN = 0,
    STDOUT = 1,
    STDERR = 2
}

/**
 * The output of a container without TTY is multiplexed: each frame is a header of 8 bytes (the stream, 3 zeros, the
 * size as a big endian uint32) and its content. The decoder gives the contents, in their order; its "frame" event
 * gives each content with its stream
 */
export class DockerStreamDecoder extends Transform {

    #pending: Buffer = Buffer.alloc(0)

    public _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
        this.#pending = this.#pending.length ? Buffer.concat([this.#pending, chunk]) : chunk
        while (this.#pending.length >= 8) {
            const size: number = this.#pending.readUInt32BE(4)
            if (this.#pending.length < 8 + size) break
            const type: DockerStreamType = this.#pending.readUInt8(0)
            const content: Buffer = this.#pending.subarray(8, 8 + size)
            this.#pending = this.#pending.subarray(8 + size)
            if (content.length) {
                this.emit('frame', type, content)
                this.push(content)
            }
        }
        callback()
    }

    public _flush(callback: TransformCallback): void {
        //A truncated frame is given as it is
        if (this.#pending.length) this.push(this.#pending)
        callback()
    }
}

/**
 * The output of a multiplexed stream (or buffer), and its outputs by stream
 * @param input
 */
export async function readMultiplexed(input: NodeJS.ReadableStream | Buffer): Promise<{ output: string, stdout: string, stderr: string }> {
    const decoder: DockerStreamDecoder = new DockerStreamDecoder()
    const output: Buffer[] = []
    const streams: Record<number, Buffer[]> = {[DockerStreamType.STDOUT]: [], [DockerStreamType.STDERR]: []}
    decoder.on('frame', (type: DockerStreamType, content: Buffer): unknown => (streams[type] ??= []).push(content))
    decoder.on('data', (content: Buffer): unknown => output.push(content))
    await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
        decoder.once('end', resolve).once('error', reject)
        if (Buffer.isBuffer(input)) {
            decoder.end(input)
        } else {
            input.once('error', (error: Error): unknown => decoder.destroy(error))
            input.pipe(decoder)
        }
    })
    return {
        output: Buffer.concat(output).toString(),
        stdout: Buffer.concat(streams[DockerStreamType.STDOUT]).toString(),
        stderr: Buffer.concat(streams[DockerStreamType.STDERR]).toString()
    }
}

/**
 * Read the JSON lines of a progress (a pull, a push, a build, a load): each object is given to the callback, all of them
 * are given back once the stream ends. The lines which are not JSON are skipped
 * @param input
 * @param onProgress
 */
export async function followProgress<T = Record<string, any>>(input: NodeJS.ReadableStream, onProgress?: (progress: T) => void): Promise<T[]> {
    const objects: T[] = []
    let pending: string = ''
    const line = (text: string): void => {
        const trimmed: string = text.trim()
        if (!trimmed) return
        let object: T
        try {
            object = JSON.parse(trimmed)
        } catch {
            return
        }
        objects.push(object)
        onProgress?.(object)
    }
    await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
        input.on('data', (chunk: Buffer | string): void => {
            pending += chunk.toString()
            let position: number
            while ((position = pending.indexOf('\n')) >= 0) {
                line(pending.slice(0, position))
                pending = pending.slice(position + 1)
            }
        })
        input.once('end', (): void => {
            line(pending)
            resolve()
        })
        input.once('close', resolve)
        input.once('error', reject)
    })
    return objects
}
