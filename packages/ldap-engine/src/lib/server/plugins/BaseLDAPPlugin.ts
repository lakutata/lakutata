import {LDAPUsageException} from '../../../exceptions/LDAPUsageException.js'
import {DN} from '../../dn/DN.js'
import type {LDAPInProcessConnection} from '../InProcessConnection.js'
import type {LDAPPlugin, OperationContext} from '../Types.js'

/**
 * The options every plugin of the engine takes
 */
export interface BasePluginOptions {
    /**
     * Its name, to have the plugin twice in a server (its own name by default)
     */
    name?: string
    /**
     * The suffixes of the backends it runs for; all of them by default
     */
    suffixes?: string[]
}

/**
 * The base of the plugins of the engine: their name, which the options may change, and the suffixes they run for. A
 * plugin may extend it, or be any object of the `LDAPPlugin` shape.
 * @example
 * ```typescript
 * import {BaseLDAPPlugin, type BasePluginOptions, createLDAPServer, type LDAPInterceptor, MemoryBackend} from '@lakutata/ldap-engine'
 *
 * class StampPlugin extends BaseLDAPPlugin {
 *     public readonly interceptors: LDAPInterceptor[] = [{
 *         name: 'stamp',
 *         operations: ['add'],
 *         before: (context, request) => {
 *             if (request.type === 'add') request.entry.attributes.push({type: 'description', values: [Buffer.from('added by the server')]})
 *         }
 *     }]
 *
 *     constructor(options: BasePluginOptions = {}) {
 *         super('stamp', options)
 *     }
 * }
 *
 * const server = createLDAPServer({backends: [new MemoryBackend('dc=example,dc=com')], plugins: [new StampPlugin()]})
 * ```
 */
export abstract class BaseLDAPPlugin implements LDAPPlugin {
    /**
     * Its name
     */
    public readonly name: string

    /**
     * The suffixes of the backends it runs for; all of them when undefined
     */
    public readonly suffixes?: readonly string[]

    /**
     * A plugin
     * @param defaultName Its name when the options give none.
     * @param options Its name and its suffixes.
     */
    protected constructor(defaultName: string, options: BasePluginOptions = {}) {
        if (options.name !== undefined && (typeof options.name !== 'string' || !options.name)) throw new LDAPUsageException(`The name of the plugin ${defaultName} must be a text`)
        this.name = options.name ?? defaultName
        if (options.suffixes !== undefined) {
            if (!Array.isArray(options.suffixes) || !options.suffixes.length) throw new LDAPUsageException(`The suffixes of the plugin ${this.name} must be a list of DNs`)
            for (const suffix of options.suffixes) DN.parse(suffix)
            this.suffixes = [...options.suffixes]
        }
    }

    /**
     * Run reads and writes of the plugin on an internal connection, closed after
     * @param context The context of the operation that needs them.
     * @param run What runs on the connection.
     */
    protected async internally<T>(context: OperationContext, run: (connection: LDAPInProcessConnection) => Promise<T>): Promise<T> {
        const connection: LDAPInProcessConnection = context.server.connect({internal: true})
        try {
            return await run(connection)
        } finally {
            await connection.close()
        }
    }

    /**
     * Run what the plugin does after a write: a failure is an `error` event of the server, the write being done
     * @param context The context of the write.
     * @param work The work.
     */
    protected async afterwards(context: OperationContext, work: () => Promise<void>): Promise<void> {
        try {
            await work()
        } catch (error) {
            context.server.events.emit('error', error)
        }
    }
}
