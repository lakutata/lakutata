import {randomBytes} from 'node:crypto'
import {LDAPConnectionException} from '../../exceptions/LDAPConnectionException.js'
import {LDAPTimeoutException} from '../../exceptions/LDAPTimeoutException.js'
import type {LDAPConnection} from '../client/Connection.js'
import {type Exchange, type ExchangeOptions, LDAPOperations} from '../client/Operations.js'
import type {Control} from '../controls/Control.js'
import type {Filter} from '../filter/Filter.js'
import type {LDAPRequest, PartialAttribute, SearchResultEntry} from '../protocol/Messages.js'
import type {Pipeline, SessionState} from './Pipeline.js'

/**
 * A copy of the values of an attribute
 * @param attribute The attribute.
 */
function copyAttribute(attribute: PartialAttribute): PartialAttribute {
    return {type: attribute.type, values: attribute.values.map((value: Buffer): Buffer => Buffer.from(value))}
}

/**
 * A copy of a filter, its values copied
 * @param filter The filter.
 */
function copyFilter(filter: Filter): Filter {
    switch (filter.type) {
        case 'and':
        case 'or':
            return {...filter, filters: filter.filters.map(copyFilter)}
        case 'not':
            return {...filter, filter: copyFilter(filter.filter)}
        case 'present':
            return {...filter}
        case 'substrings':
            return {...filter, ...filter.initial ? {initial: Buffer.from(filter.initial)} : {}, any: filter.any.map((value: Buffer): Buffer => Buffer.from(value)), ...filter.final ? {final: Buffer.from(filter.final)} : {}}
        default:
            return {...filter, value: Buffer.from(filter.value)}
    }
}

/**
 * A copy of a request, its values copied: what the application gives is not what the server keeps
 * @param request The request.
 */
function copyRequest(request: LDAPRequest): LDAPRequest {
    switch (request.type) {
        case 'bindRequest':
            return {...request, authentication: request.authentication.type === 'simple' ? {type: 'simple', password: Buffer.from(request.authentication.password)} : request.authentication.type === 'sasl' ? {...request.authentication, ...request.authentication.credentials ? {credentials: Buffer.from(request.authentication.credentials)} : {}} : {...request.authentication, value: Buffer.from(request.authentication.value)}}
        case 'searchRequest':
            return {...request, filter: copyFilter(request.filter), attributes: [...request.attributes]}
        case 'addRequest':
            return {...request, attributes: request.attributes.map(copyAttribute)}
        case 'modifyRequest':
            return {...request, changes: request.changes.map((change) => ({operation: change.operation, modification: copyAttribute(change.modification)}))}
        case 'compareRequest':
            return {...request, value: Buffer.from(request.value)}
        case 'extendedRequest':
            return {...request, ...request.value ? {value: Buffer.from(request.value)} : {}}
        default:
            return {...request}
    }
}

/**
 * A copy of controls
 * @param controls The controls.
 */
function copyControls(controls: Control[] | undefined): Control[] {
    return (controls ?? []).map((control: Control): Control => ({...control, ...control.value ? {value: Buffer.from(control.value)} : {}}))
}

/**
 * A connection to a server in the same process: the operations of the network client (the same methods, results,
 * exceptions and controls), its requests given to the processing of the server without a socket or BER. The schema
 * checks, the password hashing, the access control, the operational attributes and the events are those of the
 * network requests. Made by `LDAPServerEngine.connect()`.
 * @example
 * ```typescript
 * import {createLDAPServer, MemoryBackend, type LDAPInProcessConnection} from '@lakutata/ldap-engine'
 *
 * async function run(): Promise<void> {
 *     const server = createLDAPServer({backends: [new MemoryBackend('dc=example,dc=com')], access: {admins: ['cn=admin,dc=example,dc=com']}})
 *     const admin: LDAPInProcessConnection = server.connect({as: 'cn=admin,dc=example,dc=com'})
 *     await admin.add('dc=example,dc=com', {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
 *     console.log(await admin.whoAmI())
 * }
 * ```
 */
export class LDAPInProcessConnection extends LDAPOperations implements LDAPConnection {
    /**
     * Whether the connection is closed
     */
    protected isClosed: boolean = false

    /**
     * Abort what is running when the connection closes
     */
    protected readonly closing: AbortController = new AbortController()

    /**
     * A connection of a server
     * @param pipeline The processing of the server.
     * @param session The session.
     */
    constructor(protected readonly pipeline: Pipeline, protected readonly session: SessionState) {
        super({schema: pipeline.schema})
    }

    /**
     * The ID of the session, as the events of the server give it
     */
    public get sessionId(): string {
        return this.session.id
    }

    /**
     * Whether the connection is closed
     */
    public get closed(): boolean {
        return this.isClosed
    }

    /**
     * Send a request to the processing of the server
     * @param request The request.
     * @param options The controls, the signal, the timeout, the handlers of the entries.
     */
    protected async exchange(request: LDAPRequest, options: ExchangeOptions): Promise<Exchange> {
        if (this.isClosed) throw new LDAPConnectionException('The in-process connection is closed')
        const controller: AbortController = new AbortController()
        const abort = (): void => controller.abort(this.closing.signal.reason ?? options.signal?.reason)
        this.closing.signal.addEventListener('abort', abort, {once: true})
        options.signal?.addEventListener('abort', abort, {once: true})
        let timer: NodeJS.Timeout | undefined
        const timeout: Promise<never> | undefined = options.timeout ? new Promise((_resolve: unknown, reject: (error: Error) => void): void => {
            timer = setTimeout((): void => {
                const error: LDAPTimeoutException = new LDAPTimeoutException(`The ${request.type} took longer than ${options.timeout} ms`)
                controller.abort(error)
                reject(error)
            }, options.timeout)
        }) : undefined
        const cancelled: Promise<never> = new Promise((_resolve: unknown, reject: (error: unknown) => void): void => {
            controller.signal.addEventListener('abort', (): void => reject(controller.signal.reason), {once: true})
        })
        cancelled.catch((): undefined => undefined)
        try {
            if (options.signal?.aborted) throw options.signal.reason
            const handled: Promise<Exchange> = this.pipeline.handle(this.session, copyRequest(request), copyControls(options.controls), {
                entry: (entry: SearchResultEntry, controls?: Control[]): void => {
                    if (controller.signal.aborted) return
                    options.onEntry?.({type: 'searchResultEntry', objectName: entry.objectName, attributes: entry.attributes.map(copyAttribute)}, copyControls(controls))
                },
                reference: (uris: string[]): void => options.onReference?.([...uris])
            }, controller.signal)
            return await Promise.race([handled, cancelled, ...timeout ? [timeout] : []])
        } finally {
            clearTimeout(timer)
            this.closing.signal.removeEventListener('abort', abort)
            options.signal?.removeEventListener('abort', abort)
        }
    }

    /**
     * Close the connection: what is running is abandoned, and the session forgotten
     */
    public async close(): Promise<void> {
        if (this.isClosed) return
        this.isClosed = true
        this.closing.abort(new LDAPConnectionException('The in-process connection is closed'))
        this.pipeline.closeSession(this.session)
    }
}

/**
 * The ID of a new session
 */
export function sessionId(): string {
    return randomBytes(8).toString('hex')
}
