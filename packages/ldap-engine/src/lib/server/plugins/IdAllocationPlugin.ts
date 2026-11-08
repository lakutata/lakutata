import type {Entry} from '../../client/Entry.js'
import {LDAPNoSuchObjectException} from '../../../exceptions/LDAPResultException.js'
import {LDAPUsageException} from '../../../exceptions/LDAPUsageException.js'
import {DN} from '../../dn/DN.js'
import type {Schema} from '../../schema/Schema.js'
import {atOrBelow} from '../EntryTools.js'
import type {LDAPInProcessConnection} from '../InProcessConnection.js'
import type {LDAPInterceptor, OperationContext, PluginCapability, ServerOutcome, ServerRequest} from '../Types.js'
import {BaseLDAPPlugin, type BasePluginOptions} from './BaseLDAPPlugin.js'
import {classesOf, namingContextsOf, valuesIn} from './PluginTools.js'

/**
 * The options of an {@link IdAllocationPlugin}
 */
export interface IdAllocationPluginOptions extends BasePluginOptions {
    /**
     * The first uidNumber given (10000 by default)
     */
    uidNumber?: number
    /**
     * The first gidNumber given (10000 by default)
     */
    gidNumber?: number
}

/**
 * uidNumber and gidNumber given to the POSIX entries added without them, as the DNA plugin of 389 Directory Server
 * gives them: a posixAccount gets a uidNumber, a posixAccount or a posixGroup a gidNumber, one more than the greatest
 * under the suffix of the entry, not below the first. The numbers of one server are given one after the other; with
 * several servers on one store, keep the numbers unique (a `UniquePlugin` on uidNumber refuses a number given twice),
 * or use a backend giving them itself (the directory backend of `@lakutata/ldap` does, and the plugin leaves its
 * chain).
 * @example
 * ```typescript
 * import {createLDAPServer, IdAllocationPlugin, MemoryBackend} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     plugins: [new IdAllocationPlugin({uidNumber: 20000, gidNumber: 20000})]
 * })
 * ```
 */
export class IdAllocationPlugin extends BaseLDAPPlugin {
    /**
     * The capability of the backends doing its work themselves
     */
    public readonly capability: PluginCapability = 'idAllocation'

    /**
     * The first numbers
     */
    protected readonly first: {uidNumber: number, gidNumber: number}

    /**
     * The next number of each attribute under each suffix, once found
     */
    protected readonly next: Map<string, number> = new Map()

    /**
     * The adds given numbers one after the other
     */
    protected queue: Promise<unknown> = Promise.resolve()

    /**
     * The plugin
     * @param options The first numbers, the name and the suffixes.
     */
    constructor(options: IdAllocationPluginOptions = {}) {
        super('id-allocation', options)
        this.first = {uidNumber: options.uidNumber ?? 10000, gidNumber: options.gidNumber ?? 10000}
        for (const [type, value] of Object.entries(this.first)) {
            if (!Number.isSafeInteger(value) || value < 0) throw new LDAPUsageException(`The first ${type} of the plugin ${this.name} must be a positive integer`)
        }
    }

    /**
     * Its interceptor, before the schema checks (the numbers being required by the POSIX classes)
     */
    public get interceptors(): {interceptor: LDAPInterceptor, before: string}[] {
        return [{interceptor: {name: this.name, operations: ['add'], around: (context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> => this.around(context, request, next)}, before: 'schema'}]
    }

    /**
     * Give the numbers an added POSIX entry lacks
     * @param context The context.
     * @param request The request.
     * @param next The rest of the chain.
     */
    protected async around(context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> {
        if (request.type !== 'add') return next()
        const schema: Schema = context.schema
        const classes: Set<string> = classesOf(valuesIn(request.entry.attributes, 'objectClass', schema), schema)
        const wanted: ('uidNumber' | 'gidNumber')[] = []
        if (classes.has('posixaccount') && !valuesIn(request.entry.attributes, 'uidNumber', schema).length) wanted.push('uidNumber')
        if ((classes.has('posixaccount') || classes.has('posixgroup')) && !valuesIn(request.entry.attributes, 'gidNumber', schema).length) wanted.push('gidNumber')
        if (!wanted.length) return next()
        const run = async (): Promise<ServerOutcome> => {
            await this.internally(context, async (connection: LDAPInProcessConnection): Promise<void> => {
                const base: string | undefined = (await namingContextsOf(connection)).filter((suffix: string): boolean => atOrBelow(request.entry.dn, suffix, schema)).sort((left: string, right: string): number => DN.parse(right).length - DN.parse(left).length)[0]
                for (const type of wanted) request.entry.attributes.push({type: type, values: [Buffer.from(String(await this.allocate(connection, base ?? '', type, schema)))]})
            })
            return next()
        }
        const turn: Promise<ServerOutcome> = this.queue.then(run, run)
        this.queue = turn.catch((): undefined => undefined)
        return turn
    }

    /**
     * The next free number of an attribute under a suffix
     * @param connection The connection.
     * @param base The suffix.
     * @param type The attribute.
     * @param schema The schema.
     */
    protected async allocate(connection: LDAPInProcessConnection, base: string, type: 'uidNumber' | 'gidNumber', schema: Schema): Promise<number> {
        const key: string = `${type}:${DN.parse(base).key(schema)}`
        let candidate: number | undefined = this.next.get(key)
        if (candidate === undefined) {
            //The greatest number under the suffix, read once
            let greatest: number = this.first[type] - 1
            for (const entry of await this.search(connection, base, `(${type}>=${this.first[type]})`, type)) {
                for (const value of entry.get(type)) if (/^\d+$/.test(value)) greatest = Math.max(greatest, Number(value))
            }
            candidate = greatest + 1
        }
        //A number written by hand since is passed over
        while ((await this.search(connection, base, `(${type}=${candidate})`, '1.1')).length) candidate++
        this.next.set(key, candidate + 1)
        return candidate
    }

    /**
     * The entries of a search under a suffix
     * @param connection The connection.
     * @param base The suffix.
     * @param filter The filter.
     * @param attribute The attribute to read.
     */
    protected async search(connection: LDAPInProcessConnection, base: string, filter: string, attribute: string): Promise<Entry[]> {
        try {
            return (await connection.search(base, {filter: filter, attributes: [attribute]})).entries
        } catch (error) {
            if (error instanceof LDAPNoSuchObjectException) return []
            throw error
        }
    }
}
