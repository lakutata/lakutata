/**
 * The base of the results an action returns to describe its output beyond its data (a status, headers, a file, an
 * event stream): {@link StatusResult}, {@link FileResult}, {@link EventsResult}, built with `Result`. The HTTP and CLI
 * adapters output the results they support, and the `data` of the others; the service adapters (Socket.IO, JSON-RPC,
 * Electron IPC, the HTTP service, gRPC, NATS) send the `data` of a `StatusResult` and answer a `FileResult` or an
 * `EventsResult` with an error.
 * @example
 * ```typescript
 * import {ActionResult} from 'lakutata/com/entrypoint'
 *
 * //A result carrying a page of items, an adapter of its own may output its paging
 * export class PageResult<T> extends ActionResult {
 *     constructor(public readonly items: T[], public readonly next?: string) {
 *         super()
 *     }
 *
 *     public get data(): T[] {
 *         return this.items
 *     }
 * }
 * ```
 */
export abstract class ActionResult {

    /**
     * The result's data: what the adapters not supporting the result output.
     */
    public abstract get data(): unknown
}
