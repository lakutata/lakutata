import {LDAPResultException} from '../../../exceptions/LDAPResultException.js'
import {LDAPUsageException} from '../../../exceptions/LDAPUsageException.js'
import {isUTF8} from '../../ber/Ber.js'
import {ExtendedOperation, PasswordModifyRequest} from '../../extended/Extended.js'
import {stringifyFilter} from '../../filter/FilterString.js'
import type {LDAPRequest, PartialAttribute} from '../../protocol/Messages.js'
import {ResultCode} from '../../protocol/ResultCode.js'
import type {Schema} from '../../schema/Schema.js'
import type {OperationContext, OperationType, ServerOutcome} from '../Types.js'
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
    /**
     * The OID of an extended operation
     */
    name?: string
    /**
     * The SASL mechanism of a bind
     */
    mechanism?: string
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
     * The operations recorded (add, modify, delete, modifyDN and extended, the Password Modify among them, by default;
     * bind, search and compare as well when given)
     */
    operations?: OperationType[]
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
 * around every request, before it goes to a backend, so the refused operations are recorded too, and the binds and the
 * extended operations; the passwords are not.
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
    protected readonly operations: OperationType[]

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
        this.operations = options.operations ?? ['add', 'modify', 'delete', 'modifyDN', 'extended']
        const known: string[] = ['bind', 'search', 'compare', 'add', 'modify', 'delete', 'modifyDN', 'extended']
        if (!Array.isArray(this.operations) || this.operations.some((operation: string): boolean => !known.includes(operation))) throw new LDAPUsageException(`The operations of the plugin ${this.name} are among ${known.join(', ')}`)
        this.internal = options.internal === true
        this.hidden = options.hidden ?? ['userPassword', 'sambaNTPassword', 'sambaLMPassword']
    }

    /**
     * Record an operation and its outcome
     * @param context The context.
     * @param request The request.
     * @param next The handling of the request.
     */
    public async aroundRequest(context: OperationContext, request: LDAPRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> {
        if (!this.operations.includes(context.operation) || (context.session.internal && !this.internal)) return next()
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
    protected recordOf(context: OperationContext, request: LDAPRequest, schema: Schema): AuditRecord {
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
            case 'bindRequest':
                record.dn = request.name
                if (request.authentication.type === 'sasl') record.mechanism = request.authentication.mechanism
                break
            case 'searchRequest':
                record.dn = request.baseObject
                record.filter = stringifyFilter(request.filter)
                break
            case 'addRequest':
                record.dn = request.entry
                record.attributes = request.attributes.map((attribute: PartialAttribute): {type: string, values: string[]} => ({type: attribute.type, values: this.valuesOf(attribute, schema)}))
                break
            case 'modifyRequest':
                record.dn = request.object
                record.changes = request.changes.map((change): {operation: string, attribute: string, values: string[]} => ({operation: change.operation, attribute: change.modification.type, values: this.valuesOf(change.modification, schema)}))
                break
            case 'modifyDNRequest':
                record.dn = request.entry
                record.newRDN = request.newRDN
                record.deleteOldRDN = request.deleteOldRDN
                if (request.newSuperior) record.newSuperior = request.newSuperior
                break
            case 'compareRequest':
            case 'deleteRequest':
                record.dn = request.entry
                break
            case 'extendedRequest':
                record.name = request.name
                //A Password Modify: the entry whose password it changes, without the passwords
                if (request.name === ExtendedOperation.passwordModify) {
                    try {
                        record.dn = PasswordModifyRequest.decode(request.value ?? Buffer.alloc(0)).userIdentity?.replace(/^dn:/, '') ?? record.identity ?? ''
                    } catch {
                        record.dn = record.identity ?? ''
                    }
                }
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
