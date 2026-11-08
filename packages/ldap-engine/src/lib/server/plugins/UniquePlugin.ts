import type {Entry} from '../../client/Entry.js'
import {LDAPNoSuchObjectException} from '../../../exceptions/LDAPResultException.js'
import {LDAPUsageException} from '../../../exceptions/LDAPUsageException.js'
import {DN} from '../../dn/DN.js'
import {escapeFilterValue} from '../../filter/FilterString.js'
import {ResultCode} from '../../protocol/ResultCode.js'
import type {Schema} from '../../schema/Schema.js'
import {fail} from '../EntryTools.js'
import type {LDAPInProcessConnection} from '../InProcessConnection.js'
import type {LDAPInterceptor, OperationContext, ServerOutcome, ServerRequest} from '../Types.js'
import {BaseLDAPPlugin, type BasePluginOptions} from './BaseLDAPPlugin.js'
import {isOfType, valuesIn} from './PluginTools.js'

/**
 * The options of a {@link UniquePlugin}
 */
export interface UniquePluginOptions extends BasePluginOptions {
    /**
     * The attributes whose values no two entries may share
     */
    attributes: string[]
    /**
     * The DN under which the values are unique (the suffix of the backend of the entry by default)
     */
    base?: string
}

/**
 * Values no two entries share, as the unique overlay of OpenLDAP keeps them: an add, a modify or a rename giving an
 * entry a value another entry has, under the suffix of its backend (or `base`), is refused with constraintViolation
 * (19). The writes of one server are checked one
 * after the other; several servers on one store need a backend keeping the values unique itself (the `unique` option
 * of the directory backend of `@lakutata/ldap`, on a unique index).
 * @example
 * ```typescript
 * import {createLDAPServer, MemoryBackend, UniquePlugin} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     plugins: [new UniquePlugin({attributes: ['uid', 'mail', 'uidNumber']})]
 * })
 * ```
 */
export class UniquePlugin extends BaseLDAPPlugin {
    /**
     * The attributes
     */
    protected readonly attributes: string[]

    /**
     * The DN under which the values are unique
     */
    protected readonly base: string | undefined

    /**
     * The writes checked one after the other
     */
    protected queue: Promise<unknown> = Promise.resolve()

    /**
     * The plugin
     * @param options The attributes, the base, the name and the suffixes.
     */
    constructor(options: UniquePluginOptions) {
        super('unique', options)
        this.attributes = options?.attributes
        if (!Array.isArray(this.attributes) || !this.attributes.length || this.attributes.some((attribute: string): boolean => typeof attribute !== 'string' || !attribute)) throw new LDAPUsageException(`The attributes of the plugin ${this.name} must be a list of names`)
        if (options.base !== undefined) DN.parse(options.base)
        this.base = options.base
    }

    /**
     * Its interceptor, at the end of the chain
     */
    public get interceptors(): LDAPInterceptor[] {
        return [{name: this.name, operations: ['add', 'modify', 'modifyDN'], around: (context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> => this.around(context, request, next)}]
    }

    /**
     * Refuse a write giving a value another entry has
     * @param context The context.
     * @param request The request.
     * @param next The rest of the chain.
     */
    protected async around(context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> {
        const values: {attribute: string, value: Buffer}[] = this.given(request, context.schema)
        if (!values.length) return next()
        const run = async (): Promise<ServerOutcome> => {
            const dn: DN = request.type === 'add' ? request.entry.dn : (request as {dn: DN}).dn
            await this.internally(context, (connection: LDAPInProcessConnection): Promise<void> => this.check(context, connection, dn, values))
            return next()
        }
        const turn: Promise<ServerOutcome> = this.queue.then(run, run)
        this.queue = turn.catch((): undefined => undefined)
        return turn
    }

    /**
     * The values of the attributes a write gives
     * @param request The request.
     * @param schema The schema.
     */
    protected given(request: ServerRequest, schema: Schema): {attribute: string, value: Buffer}[] {
        const values: {attribute: string, value: Buffer}[] = []
        for (const attribute of this.attributes) {
            let found: Buffer[] = []
            if (request.type === 'add') found = valuesIn(request.entry.attributes, attribute, schema)
            if (request.type === 'modify') found = request.changes.filter((change): boolean => change.operation !== 'delete' && isOfType(change.attribute.type, attribute, schema)).flatMap((change): Buffer[] => change.attribute.values)
            if (request.type === 'modifyDN') found = request.newRDN.attributes.filter((item): boolean => isOfType(item.type, attribute, schema)).map((item): Buffer => Buffer.from(item.value))
            for (const value of found) values.push({attribute: attribute, value: value})
        }
        return values
    }

    /**
     * Refuse values another entry has
     * @param context The context.
     * @param connection The connection.
     * @param dn The DN of the entry written.
     * @param values The values.
     */
    protected async check(context: OperationContext, connection: LDAPInProcessConnection, dn: DN, values: {attribute: string, value: Buffer}[]): Promise<void> {
        const schema: Schema = context.schema
        const base: string | undefined = this.base ?? context.server.suffixOf(dn)
        if (base === undefined) return
        for (const {attribute, value} of values) {
            let entries: Entry[]
            try {
                entries = (await connection.search(base, {filter: `(${attribute}=${escapeFilterValue(value)})`, attributes: ['1.1'], sizeLimit: 2, paged: false})).entries
            } catch (error) {
                if (error instanceof LDAPNoSuchObjectException) return
                throw error
            }
            if (entries.some((entry: Entry): boolean => !DN.parse(entry.dn).equals(dn, schema))) fail(ResultCode.constraintViolation, `${attribute}: the value ${value.toString()} is used by another entry`)
        }
    }
}
