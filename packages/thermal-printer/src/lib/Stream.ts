import type {Duplex, Writable} from 'node:stream'
import {setTimeout as sleep} from 'node:timers/promises'

/**
 * An open connection to a printer: the commands written to it, the wait for the printer to take them, its closing
 */
export interface Channel {
    write(data: Buffer, bytesPerSecond?: number, stallTimeout?: number): Promise<void>

    /**
     * Wait for the data written to be taken (a connection held between the prints)
     */
    settle(stallTimeout?: number): Promise<void>

    close(stallTimeout?: number): Promise<void>

    /**
     * Whether the connection failed or was closed by the other side: a held connection is opened again
     */
    readonly broken: boolean
}

/**
 * The size of the chunks written
 */
const CHUNK: number = 4096

/**
 * The message of an error
 */
export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/**
 * The failure of a printer that takes no data (out of paper, its cover open, offline)
 */
export function stalled(stallTimeout: number): Error {
    return new Error(`the printer took no data for ${stallTimeout} ms`)
}

/**
 * Write data to a stream in chunks, waiting for it to drain (for stallTimeout milliseconds at most, 0: no limit), at
 * most a number of bytes a second
 * @param stream
 * @param data
 * @param bytesPerSecond
 * @param stallTimeout
 */
async function writeStream(stream: Writable, data: Buffer, bytesPerSecond?: number, stallTimeout: number = 0): Promise<void> {
    let failure: Error | undefined
    const fail = (error: Error): void => {
        failure = error
    }
    stream.on('error', fail)
    try {
        const size: number = bytesPerSecond ? Math.max(1, Math.min(CHUNK, Math.floor(bytesPerSecond / 10))) : CHUNK
        for (let offset = 0; offset < data.length; offset += size) {
            if (failure) throw failure
            if (stream.destroyed) throw new Error('the connection is closed')
            const started: number = Date.now()
            const chunk: Buffer = data.subarray(offset, offset + size)
            if (!stream.write(chunk)) {
                //Drained, failed, or closed (an error emitted before this wait would never come again)
                await new Promise<void>((resolve, reject): void => {
                    const timer: NodeJS.Timeout | undefined = stallTimeout > 0 ? setTimeout((): void => settle(stalled(stallTimeout)), stallTimeout) : undefined
                    const settle = (error?: Error): void => {
                        clearTimeout(timer)
                        stream.off('drain', drained)
                        stream.off('error', failed)
                        stream.off('close', closed)
                        if (error) reject(error)
                        else resolve()
                    }
                    const drained = (): void => settle()
                    const failed = (error: Error): void => settle(error)
                    const closed = (): void => settle(failure ?? new Error('the connection is closed'))
                    stream.once('drain', drained)
                    stream.once('error', failed)
                    stream.once('close', closed)
                    if (stream.destroyed) closed()
                })
            }
            if (bytesPerSecond) {
                const wait: number = chunk.length / bytesPerSecond * 1000 - (Date.now() - started)
                if (wait > 0) await sleep(wait)
            }
        }
        if (failure) throw failure
    } finally {
        stream.off('error', fail)
    }
}

/**
 * Wait for a stream to take what was written: the writes queued in it done (a serial port: sent on the line)
 * @param stream
 * @param stallTimeout
 */
async function settleStream(stream: Writable, stallTimeout: number = 0): Promise<void> {
    const port = stream as Writable & {drain?: (options: {stallTimeout?: number}) => Promise<void>}
    if (typeof port.drain === 'function') return await port.drain({stallTimeout})
    await new Promise<void>((resolve, reject): void => {
        const timer: NodeJS.Timeout | undefined = stallTimeout > 0 ? setTimeout((): void => reject(stalled(stallTimeout)), stallTimeout) : undefined
        stream.write(Buffer.alloc(0), (error?: Error | null): void => {
            clearTimeout(timer)
            if (error) reject(error)
            else resolve()
        })
    })
}

/**
 * Close a stream after its data are written: ended, then finished (or failed, or no longer taking data for
 * stallTimeout milliseconds)
 * @param stream
 * @param stallTimeout
 */
function endStream(stream: Writable, stallTimeout: number = 0): Promise<void> {
    return new Promise<void>((resolve, reject): void => {
        //A stream closed already (by the other side): nothing more to send
        if (stream.destroyed) return resolve()
        let timer: NodeJS.Timeout | undefined
        const settle = (error?: Error | null): void => {
            clearTimeout(timer)
            stream.off('error', settle)
            stream.off('close', closed)
            if (error) reject(error)
            else resolve()
        }
        const closed = (): void => settle()
        if (stallTimeout > 0) timer = setTimeout((): void => settle(stalled(stallTimeout)), stallTimeout)
        stream.once('error', settle)
        stream.once('close', closed)
        stream.end((error?: Error | null): void => settle(error))
    })
}

/**
 * A channel of a stream (a socket, a port, a device)
 * @param stream
 * @param close how the stream is closed once its data are written
 */
export function streamChannel(stream: Duplex | Writable, close?: () => Promise<void>): Channel {
    let broken: boolean = false
    const breaks = (): void => {
        broken = true
    }
    stream.on('error', breaks)
    stream.once('close', breaks)
    return {
        write: (data: Buffer, bytesPerSecond?: number, stallTimeout?: number): Promise<void> => writeStream(stream, data, bytesPerSecond, stallTimeout),
        settle: (stallTimeout?: number): Promise<void> => settleStream(stream, stallTimeout),
        close: async (stallTimeout?: number): Promise<void> => {
            try {
                await endStream(stream, stallTimeout)
            } finally {
                await close?.()
            }
        },
        get broken(): boolean {
            return broken || stream.destroyed
        }
    }
}
