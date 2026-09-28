import type {Readable} from 'node:stream'
import {ActionResult} from './ActionResult.js'

/**
 * A result with a status and headers
 */
export class StatusResult extends ActionResult {
    constructor(public readonly status: number, protected readonly payload?: unknown, public readonly headers: Record<string, string> = {}) {
        super()
    }

    public get data(): unknown {
        return this.payload
    }
}

export type FileResultOptions = {
    /**
     * The content type, inferred from the file name when omitted
     */
    contentType?: string
    /**
     * Send the file as an attachment with this name
     */
    filename?: string
    /**
     * The entity tag of the content: a request with a matching If-None-Match gets a 304 response
     */
    etag?: string
    /**
     * Other headers
     */
    headers?: Record<string, string>
}

/**
 * A file: a path, a buffer or a stream
 */
export class FileResult extends ActionResult {
    constructor(public readonly source: string | Buffer | Readable, public readonly options: FileResultOptions = {}) {
        super()
    }

    public get data(): unknown {
        return this.source
    }
}

/**
 * Send an event of a stream: an optional event name, the data (serialized to JSON unless it is a string) and an optional id
 */
export type SendEvent = (data: unknown, event?: string, id?: string) => void

/**
 * The producer of the events of a stream, the stream ends when it resolves or when the client leaves (the signal aborts)
 */
export type EventsProducer = (send: SendEvent, signal: AbortSignal) => Promise<void> | void

/**
 * A stream of events (server-sent events for HTTP)
 * The producer runs after the action returned, when its request container is destroyed:
 * it must use the objects living longer than the request (components)
 */
export class EventsResult extends ActionResult {
    constructor(public readonly producer: EventsProducer) {
        super()
    }

    public get data(): unknown {
        return undefined
    }
}

/**
 * The results of the actions
 */
export const Result = {
    /**
     * A result with a status and headers
     * @param status
     * @param data
     * @param headers
     */
    status: (status: number, data?: unknown, headers?: Record<string, string>): StatusResult => new StatusResult(status, data, headers),
    /**
     * A file: a path, a buffer or a stream
     * @param source
     * @param options
     */
    file: (source: string | Buffer | Readable, options?: FileResultOptions): FileResult => new FileResult(source, options),
    /**
     * A stream of events
     * @param producer
     */
    events: (producer: EventsProducer): EventsResult => new EventsResult(producer)
}
