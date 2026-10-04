import type {Readable} from 'node:stream'
import {ActionResult} from './ActionResult.js'

/**
 * A result with a status and headers: the HTTP adapters set them on the response and send the data with their
 * responder; the CLI adapter outputs the data. Build it with `Result.status()`.
 * @example
 * ```typescript
 * import {Controller, Result, type StatusResult} from 'lakutata/com/entrypoint'
 * import {POST} from 'lakutata/decorator/ctrl'
 *
 * class OrderController extends Controller {
 *     //201 Created, with the location of the order
 *     @POST('/orders')
 *     public async create(): Promise<StatusResult> {
 *         return Result.status(201, {id: 42}, {Location: '/orders/42'})
 *     }
 * }
 * ```
 */
export class StatusResult extends ActionResult {
    /**
     * Create a result with a status and headers.
     * @param status The HTTP status.
     * @param payload The data sent.
     * @param headers The response headers.
     */
    constructor(public readonly status: number, protected readonly payload?: unknown, public readonly headers: Record<string, string> = {}) {
        super()
    }

    /**
     * The data sent with the status.
     */
    public get data(): unknown {
        return this.payload
    }
}

/**
 * How a {@link FileResult} is sent.
 */
export type FileResultOptions = {
    /**
     * The content type, inferred from the file's or the attachment's name when omitted.
     */
    contentType?: string
    /**
     * The name to send the file under, as an attachment (`Content-Disposition: attachment`); it is displayed inline
     * when omitted.
     */
    filename?: string
    /**
     * The content's entity tag, sent quoted in `ETag`: a request whose `If-None-Match` matches it gets a 304 response
     * without content.
     */
    etag?: string
    /**
     * Other response headers.
     */
    headers?: Record<string, string>
}

/**
 * A file: a path, a buffer or a stream. The HTTP adapters send it with its options; the CLI adapter writes its
 * content to stdout. Build it with `Result.file()`.
 * @example
 * ```typescript
 * import {Readable} from 'node:stream'
 * import {Controller, Result, type FileResult} from 'lakutata/com/entrypoint'
 * import {GET} from 'lakutata/decorator/ctrl'
 *
 * class ReportController extends Controller {
 *     //A file on disk, downloaded as report.pdf
 *     @GET('/report')
 *     public async report(): Promise<FileResult> {
 *         return Result.file('./reports/latest.pdf', {filename: 'report.pdf', etag: 'v1'})
 *     }
 *
 *     //A stream, with its content type
 *     @GET('/export')
 *     public async export(): Promise<FileResult> {
 *         return Result.file(Readable.from(['id,name\n', '1,Ada\n']), {contentType: 'text/csv'})
 *     }
 * }
 * ```
 */
export class FileResult extends ActionResult {
    /**
     * Create a file result.
     * @param source The file's path (resolved from the working directory), its content, or a stream of its content.
     * @param options How the file is sent.
     */
    constructor(public readonly source: string | Buffer | Readable, public readonly options: FileResultOptions = {}) {
        super()
    }

    /**
     * The file's source.
     */
    public get data(): unknown {
        return this.source
    }
}

/**
 * Send an event of a stream; nothing is sent once the client has left.
 * @param data The event's data, serialized to JSON unless it is a string.
 * @param event The event's name; the clients' default event (`message`) when omitted.
 * @param id The event's id, which the client sends back as `Last-Event-ID` when it reconnects.
 */
export type SendEvent = (data: unknown, event?: string, id?: string) => void

/**
 * Produce the events of a stream. The stream ends when the producer settles (an error ends it too, without other
 * notice); when the client leaves, the signal aborts and the producer should return.
 * @param send Sends an event.
 * @param signal Aborts when the client leaves or the adapter stops.
 */
export type EventsProducer = (send: SendEvent, signal: AbortSignal) => Promise<void> | void

/**
 * A stream of events: Server-Sent Events for the HTTP adapters, each event's data written as a line by the CLI
 * adapter. Build it with `Result.events()`.
 *
 * The producer runs after the action returned, once the request's container is destroyed: it must only use objects
 * living longer than the request (the components), not the controller's request-scoped dependencies.
 * @example
 * ```typescript
 * import {Controller, Result, type EventsResult} from 'lakutata/com/entrypoint'
 * import {GET} from 'lakutata/decorator/ctrl'
 *
 * class ClockController extends Controller {
 *     //The time every second until the client leaves
 *     @GET('/clock')
 *     public async clock(): Promise<EventsResult> {
 *         return Result.events(async (send, signal): Promise<void> => {
 *             while (!signal.aborted) {
 *                 send({now: new Date().toISOString()}, 'tick')
 *                 await new Promise((resolve): unknown => setTimeout(resolve, 1000))
 *             }
 *         })
 *     }
 * }
 * ```
 */
export class EventsResult extends ActionResult {
    /**
     * Create an event stream result.
     * @param producer Produces the events.
     */
    constructor(public readonly producer: EventsProducer) {
        super()
    }

    /**
     * Always `undefined`: an event stream has no data of its own.
     */
    public get data(): unknown {
        return undefined
    }
}

/**
 * Build the results an action returns to describe its output beyond its data.
 */
export const Result = {
    /**
     * Build a result with a status and headers.
     * @param status The HTTP status.
     * @param data The data sent.
     * @param headers The response headers.
     * @returns The {@link StatusResult}.
     */
    status: (status: number, data?: unknown, headers?: Record<string, string>): StatusResult => new StatusResult(status, data, headers),
    /**
     * Build a file result.
     * @param source The file's path (resolved from the working directory), its content, or a stream of its content.
     * @param options How the file is sent.
     * @returns The {@link FileResult}.
     */
    file: (source: string | Buffer | Readable, options?: FileResultOptions): FileResult => new FileResult(source, options),
    /**
     * Build an event stream result (Server-Sent Events for HTTP).
     * @param producer Produces the events, after the action returned.
     * @returns The {@link EventsResult}.
     */
    events: (producer: EventsProducer): EventsResult => new EventsResult(producer)
}
