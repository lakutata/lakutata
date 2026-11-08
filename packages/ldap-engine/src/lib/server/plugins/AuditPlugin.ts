import {LDAPResultException} from '../../../exceptions/LDAPResultException.js'
import {LDAPUsageException} from '../../../exceptions/LDAPUsageException.js'
import {isUTF8} from '../../ber/Ber.js'
import {stringifyFilter} from '../../filter/FilterString.js'
import type {PartialAttribute} from '../../protocol/Messages.js'
import {ResultCode} from '../../protocol/ResultCode.js'
import type {Schema} from '../../schema/Schema.js'
import type {LDAPInterceptor, OperationContext, OperationType, ServerOutcome, ServerRequest} from '../Types.js'
import {BaseLDAPPlugin, type BasePluginOptions} from './BaseLDAPPlugin.js'
import {isOfType} from './PluginTools.js'

/**
 * An operation as the {@link AuditPlugin} records it. The values are text, or `base64:` and their bytes in base64 when
 * they are not UTF-8; the values of the hidden attributes are `***`.
 */
export interface AuditRecord {
    /**
     * When the operation ended
     */
    time: Date
    /**
     * The operation
     */
    operation: OperationType
    /**
     * The DN it was on (the base of a search, the name of a bind)
     */
    dn: string
    /**
     * The session
     */
    session: string
    /**
     * The identity the session was bound as, when it was
     */
    identity?: string
    /**
     * The address of the client, for a network connection
     */
    remoteAddress?: string
    /**
     * Whether it was an operation of the internal connection of a plugin
     */
    internal: boolean
    /**
     * Its result code
     */
    resultCode: number
    /**
     * The message of a failure
     */
    diagnosticMessage?: string
    /**
     * The attributes of an add
     */
    attributes?: {type: string, values: string[]}[]
    /**
     * The changes of a modify
     */
    changes?: {operation: string, attribute: string, values: string[]}[]
    /**
     * The new RDN of a modify DN
     */
    newRDN?: string
    /**
     * Whether a modify DN deleted the values of the old RDN
     */
    deleteOldRDN?: boolean
    /**
     * The new parent of a modify DN that moved the entry
     */
    newSuperior?: string
    /**
     * The filter of a search
     */
    filter?: string
}

/**
 * The options of an {@link AuditPlugin}
 */
export interface AuditPluginOptions extends BasePluginOptions {
    /**
     * Where a record goes (a file, a log, a table of a database), awaited before the operation answers; a failure is
     * an `error` event of the server
     * @param record The record.
     */
    write: (record: AuditRecord) => Promise<void> | void
    /**
     * The operations recorded (add, modify, delete and modifyDN by default; bind, search and compare as well when given)
     */
    operations?: Exclude<OperationType, 'extended'>[]
    /**
     * Record the operations of the plugins' own connections too (the memberOf a plugin writes; false by default)
     */
    internal?: boolean
    /**
     * The attributes whose values are not recorded (userPassword, sambaNTPassword and sambaLMPassword by default)
     */
    hidden?: string[]
}

/**
 * A record of each operation, its outcome included, as the accesslog and auditlog overlays of OpenLDAP keep them: the
 * plugin gives each record to `write`, which keeps it where the application wants (a file, a log, a table). It runs
 * first in the chain, so the refused operations are recorded too; the passwords are not. A Password Modify is recorded
 * as the modify it makes. What never reaches the chain of a backend is not recorded: anonymous binds, SASL binds,
 * binds to a DN under no backend, the other extended operations.
 * @example
 * ```typescript
 * import {AuditPlugin, createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     plugins: [new AuditPlugin({write: (record) => console.log(JSON.stringify(record))})]
 * })
 * ```
 */
export class AuditPlugin extends BaseLDAPPlugin {
    /**
     * Where the records go
     */
    protected readonly write: (record: AuditRecord) => Promise<void> | void

    /**
     * The operations recorded
     */
    protected readonly operations: Exclude<OperationType, 'extended'>[]

    /**
     * Whether the internal operations are recorded
     */
    protected readonly internal: boolean

    /**
     * The attributes whose values are hidden
     */
    protected readonly hidden: string[]

    /**
     * The plugin
     * @param options Where the records go, the operations, the internal operations, the hidden attributes, the name
     * and the suffixes.
     */
    constructor(options: AuditPluginOptions) {
        super('audit', options)
        if (typeof options?.write !== 'function') throw new LDAPUsageException(`The plugin ${this.name} needs a write function for its records`)
        this.write = options.write
        this.operations = options.operations ?? ['add', 'modify', 'delete', 'modifyDN']
        const known: string[] = ['bind', 'search', 'compare', 'add', 'modify', 'delete', 'modifyDN']
        if (!Array.isArray(this.operations) || this.operations.some((operation: string): boolean => !known.includes(operation))) throw new LDAPUsageException(`The operations of the plugin ${this.name} are among ${known.join(', ')}`)
        this.internal = options.internal === true
        this.hidden = options.hidden ?? ['userPassword', 'sambaNTPassword', 'sambaLMPassword']
    }

    /**
     * Its interceptor, first in the chain
     */
    public get interceptors(): {interceptor: LDAPInterceptor, before: string}[] {
        return [{interceptor: {name: this.name, operations: this.operations, around: (context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> => this.around(context, request, next)}, before: 'access'}]
    }

    /**
     * Record an operation and its outcome
     * @param context The context.
     * @param request The request.
     * @param next The rest of the chain.
     */
    protected async around(context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> {
        if (context.session.internal && !this.internal) return next()
        //What the request was before the chain changes it (a password hashed)
        const record: AuditRecord = this.recordOf(context, request, context.schema)
        try {
            const outcome: ServerOutcome = await next()
            await this.keep({...record, time: new Date(), resultCode: outcome.resultCode, ...outcome.diagnosticMessage ? {diagnosticMessage: outcome.diagnosticMessage} : {}}, context)
            return outcome
        } catch (error) {
            const code: number = error instanceof LDAPResultException ? error.code : ResultCode.other
            const message: string = error instanceof LDAPResultException ? error.diagnosticMessage || error.message : 'An internal error of the server'
            await this.keep({...record, time: new Date(), resultCode: code, diagnosticMessage: message}, context)
            throw error
        }
    }

    /**
     * Give a record to `write`; a failure is an event
     * @param record The record.
     * @param context The context.
     */
    protected async keep(record: AuditRecord, context: OperationContext): Promise<void> {
        try {
            await this.write(record)
        } catch (error) {
            context.server.events.emit('error', error)
        }
    }

    /**
     * The record of a request, before its outcome
     * @param context The context.
     * @param request The request.
     * @param schema The schema.
     */
    protected recordOf(context: OperationContext, request: ServerRequest, schema: Schema): AuditRecord {
        const record: AuditRecord = {
            time: new Date(),
            operation: context.operation,
            dn: '',
            session: context.session.id,
            ...context.session.identity ? {identity: context.session.identity.toString()} : {},
            ...context.session.remoteAddress ? {remoteAddress: context.session.remoteAddress} : {},
            internal: context.session.internal === true,
            resultCode: ResultCode.success
        }
        switch (request.type) {
            case 'bind':
                record.dn = request.name
                break
            case 'search':
                record.dn = request.base.toString()
                record.filter = stringifyFilter(request.filter)
                break
            case 'add':
                record.dn = request.entry.dn.toString()
                record.attributes = request.entry.attributes.map((attribute: PartialAttribute): {type: string, values: string[]} => ({type: attribute.type, values: this.valuesOf(attribute, schema)}))
                break
            case 'modify':
                record.dn = request.dn.toString()
                record.changes = request.changes.map((change): {operation: string, attribute: string, values: string[]} => ({operation: change.operation, attribute: change.attribute.type, values: this.valuesOf(change.attribute, schema)}))
                break
            case 'modifyDN':
                record.dn = request.dn.toString()
                record.newRDN = request.newRDN.toString()
                record.deleteOldRDN = request.deleteOldRDN
                if (request.newSuperior) record.newSuperior = request.newSuperior.toString()
                break
            case 'compare':
            case 'delete':
                record.dn = request.dn.toString()
                break
        }
        return record
    }

    /**
     * The values of an attribute as the record gives them
     * @param attribute The attribute.
     * @param schema The schema.
     */
    protected valuesOf(attribute: PartialAttribute, schema: Schema): string[] {
        if (this.hidden.some((type: string): boolean => isOfType(attribute.type, type, schema))) return attribute.values.map((): string => '***')
        return attribute.values.map((value: Buffer): string => isUTF8(value) ? value.toString('utf8') : `base64:${value.toString('base64')}`)
    }
}
