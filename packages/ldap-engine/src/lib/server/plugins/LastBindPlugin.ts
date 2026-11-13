import {LDAPUsageException} from '../../../exceptions/LDAPUsageException.js'
import {formatGeneralizedTime, parseGeneralizedTime} from '../../schema/MatchingRules.js'
import {ResultCode} from '../../protocol/ResultCode.js'
import type {LDAPInProcessConnection} from '../InProcessConnection.js'
import {afterBind} from '../OnceBound.js'
import type {LDAPInterceptor, OperationContext, PluginCapability, ServerOutcome, ServerRequest} from '../Types.js'
import {BaseLDAPPlugin, type BasePluginOptions} from './BaseLDAPPlugin.js'
import {readEntry} from './PluginTools.js'

/**
 * The options of a {@link LastBindPlugin}
 */
export interface LastBindPluginOptions extends BasePluginOptions {
    /**
     * The seconds within which a bind does not write the time again (0 by default: every bind writes it)
     */
    precision?: number
}

/**
 * The time of the last successful bind of an entry kept in its authTimestamp, as the lastbind overlay of OpenLDAP keeps
 * it, for finding the accounts nobody uses; with `precision`, a bind within that many seconds of the time kept does not
 * write it again. For the backends that do not keep it themselves (the directory backend of `@lakutata/ldap` does, and
 * the plugin leaves its chain). It records the binds that verify a password: simple binds and SASL PLAIN.
 * @example
 * ```typescript
 * import {createLDAPServer, LastBindPlugin, MemoryBackend} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     plugins: [new LastBindPlugin({precision: 3600})]
 * })
 * ```
 */
export class LastBindPlugin extends BaseLDAPPlugin {
    /**
     * The capability of the backends doing its work themselves
     */
    public readonly capability: PluginCapability = 'lastBind'

    /**
     * The seconds within which the time is not written again
     */
    protected readonly precision: number

    /**
     * The plugin
     * @param options The precision, the name and the suffixes.
     */
    constructor(options: LastBindPluginOptions = {}) {
        super('last-bind', options)
        this.precision = options.precision ?? 0
        if (!Number.isFinite(this.precision) || this.precision < 0) throw new LDAPUsageException(`The precision of the plugin ${this.name} must be a number of seconds`)
    }

    /**
     * The definition of authTimestamp
     */
    public get schemaFiles(): {name: string, text: string}[] {
        return [{name: this.name, text: ['dn: cn=lastbind,cn=schema', 'objectClass: subschema', 'attributeTypes: ( 1.3.6.1.4.1.453.16.2.188 NAME \'authTimestamp\' DESC \'The last successful bind\' EQUALITY generalizedTimeMatch ORDERING generalizedTimeOrderingMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.24 SINGLE-VALUE NO-USER-MODIFICATION USAGE dSAOperation )'].join('\n') + '\n'}]
    }

    /**
     * Its interceptor, at the end of the chain
     */
    public get interceptors(): LDAPInterceptor[] {
        return [{name: this.name, operations: ['bind'], around: (context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> => this.around(context, request, next)}]
    }

    /**
     * Write the time of a successful bind
     * @param context The context.
     * @param request The request.
     * @param next The rest of the chain.
     */
    protected async around(context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> {
        const outcome: ServerOutcome = await next()
        //A bind an interceptor inside answered otherwise than success: no password was checked, no time kept
        if (request.type !== 'bind' || !request.dn || outcome.resultCode !== ResultCode.success) return outcome
        const dn = request.dn
        //Once the bind succeeds, at the time it does: a bind refused after (by a plugin around it, an interceptor
        //outside this one) keeps no time; a write failing is an error event, the bind done
        await afterBind(context, (finishing: OperationContext): Promise<void> => this.afterwards(finishing, (): Promise<void> => this.internally(finishing, async (connection: LDAPInProcessConnection): Promise<void> => {
            const now: Date = new Date()
            if (this.precision > 0) {
                const kept: number | undefined = parseGeneralizedTime((await readEntry(connection, dn, ['authTimestamp']))?.first('authTimestamp') ?? '')
                if (kept !== undefined && now.getTime() - kept < this.precision * 1000) return
            }
            await connection.modify(dn, {operation: 'replace', attribute: 'authTimestamp', values: formatGeneralizedTime(now).replace(/\.\d+Z$/, 'Z')})
        })))
        return outcome
    }
}
