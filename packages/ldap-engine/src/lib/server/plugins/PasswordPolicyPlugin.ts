import type {Entry} from '../../client/Entry.js'
import {LDAPUsageException} from '../../../exceptions/LDAPUsageException.js'
import {PasswordPolicyRequestControl} from '../../controls/Controls.js'
import {DN} from '../../dn/DN.js'
import {ExtendedOperation} from '../../extended/Extended.js'
import type {LDAPRequest} from '../../protocol/Messages.js'
import {attributeTypeOf, type Schema} from '../../schema/Schema.js'
import {MUST_CHANGE, PasswordPolicy, type PasswordPolicyOptions} from '../PasswordPolicy.js'
import type {DirectoryChange, DirectoryEntry, LDAPPluginHost, OperationContext, PasswordChange, PluginControl, ServerOutcome} from '../Types.js'
import {BaseLDAPPlugin, type BasePluginOptions} from './BaseLDAPPlugin.js'
import {readEntry} from './PluginTools.js'

/**
 * The options of a {@link PasswordPolicyPlugin}: the policy, its name and its suffixes
 */
export interface PasswordPolicyPluginOptions extends PasswordPolicyOptions, BasePluginOptions {
}

/**
 * The password policy of draft-behera-ldap-password-policy, with the attributes OpenLDAP's ppolicy uses: a default
 * policy (the DN of a pwdPolicy entry, or its rules) that a user's pwdPolicySubentry replaces; accounts locked after too
 * many failures, expiration with its warnings and grace binds, the password to change first after a reset, the minimum
 * age, length, quality and history of new passwords. Its state is in the operational attributes of the entries, so every
 * backend keeps it. The `passwordPolicy` option of the server gives the same plugin.
 * @example
 * ```typescript
 * import {createLDAPServer, MemoryBackend, PasswordPolicyPlugin} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     plugins: [new PasswordPolicyPlugin({default: {lockout: true, maxFailure: 5, lockoutDuration: 900, minLength: 10, checkQuality: 2}})]
 * })
 * ```
 */
export class PasswordPolicyPlugin extends BaseLDAPPlugin {
    /**
     * The control of the policy: its warnings and errors in the responses
     */
    public readonly controls: PluginControl[] = [{oid: PasswordPolicyRequestControl.oid}]

    /**
     * The policy
     */
    protected readonly options: PasswordPolicyOptions

    /**
     * The policy of each server, made with its schema and its password schemes
     */
    protected readonly policies: WeakMap<LDAPPluginHost, PasswordPolicy> = new WeakMap()

    /**
     * The plugin
     * @param options The default policy, the check of quality, whether a locked account is told, the name and the
     * suffixes.
     */
    constructor(options: PasswordPolicyPluginOptions = {}) {
        super('password-policy', options)
        if (options.default !== undefined && typeof options.default !== 'string' && (typeof options.default !== 'object' || options.default === null)) throw new LDAPUsageException(`The default policy of the plugin ${this.name} is the DN of a pwdPolicy entry, or its rules`)
        if (typeof options.default === 'string') DN.parse(options.default)
        if (options.quality !== undefined && typeof options.quality !== 'function') throw new LDAPUsageException(`The quality check of the plugin ${this.name} must be a function`)
        this.options = {...options.default !== undefined ? {default: options.default} : {}, ...options.quality ? {quality: options.quality} : {}, ...options.revealLocked ? {revealLocked: true} : {}}
    }

    /**
     * Check that the schema of the password policy is there
     * @param host The server.
     */
    public start(host: LDAPPluginHost): void {
        for (const type of ['pwdChangedTime', 'pwdAccountLockedTime', 'pwdFailureTime', 'pwdPolicySubentry']) {
            if (!host.schema.attributeType(type)) throw new LDAPUsageException(`The plugin ${this.name} needs the bundled schema ppolicy, which defines ${type}`)
        }
    }

    /**
     * Refuse the requests of a session that must change its password first: all but binds, its own password change,
     * Who Am I and the Password Modify
     * @param context The context.
     * @param request The request.
     * @param next The handling of the request.
     */
    public async aroundRequest(context: OperationContext, request: LDAPRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> {
        if (context.session.state.get(MUST_CHANGE)) this.policyOf(context).guard(context, this.allowedBeforeChange(context, request))
        return next()
    }

    /**
     * A bind within the policy: the locked accounts refused, the failures counted, the expiration and the warnings
     * @param context The context of the bind.
     * @param bind The DN and its entry.
     * @param verify The check of the password.
     */
    public async authenticate(context: OperationContext, bind: {dn: DN, entry: DirectoryEntry | undefined}, verify: () => Promise<void>): Promise<void> {
        return this.policyOf(context).authenticate(context, bind.dn, bind.entry, verify)
    }

    /**
     * A password change within the policy: who changes, the old password, the age, the quality, the history; the state
     * it leaves
     * @param context The context of the write.
     * @param change The change.
     */
    public async passwordChange(context: OperationContext, change: PasswordChange): Promise<DirectoryChange[] | void> {
        return this.policyOf(context).check(context, change.dn, change.entry, change.passwords, {self: change.self, oldGiven: change.oldGiven, ...change.attributes ? {entryAttributes: change.attributes} : {}})
    }

    /**
     * Whether a session that must change its password first may run a request
     * @param context The context.
     * @param request The request.
     */
    protected allowedBeforeChange(context: OperationContext, request: LDAPRequest): boolean {
        const schema: Schema = context.schema
        const identity: DN | undefined = context.session.identity
        switch (request.type) {
            case 'bindRequest':
                return true
            case 'extendedRequest':
                return request.name === ExtendedOperation.passwordModify || request.name === ExtendedOperation.whoAmI
            case 'modifyRequest':
                return identity !== undefined && DN.isValid(request.object) && DN.parse(request.object).equals(identity, schema) && request.changes.every((change) => schema.primaryName(attributeTypeOf(change.modification.type)).toLowerCase() === 'userpassword')
            default:
                return false
        }
    }

    /**
     * The policy of the server of an operation
     * @param context The context.
     */
    protected policyOf(context: OperationContext): PasswordPolicy {
        const host: LDAPPluginHost = context.server
        let policy: PasswordPolicy | undefined = this.policies.get(host)
        if (!policy) {
            policy = new PasswordPolicy(this.options, host.schema, host.passwords, async (dn: DN): Promise<DirectoryEntry | undefined> => {
                const connection = host.connect({internal: true})
                try {
                    const entry: Entry | undefined = await readEntry(connection, dn, ['*'])
                    return entry ? {dn: DN.parse(entry.dn), attributes: [...entry.attributes]} : undefined
                } finally {
                    await connection.close()
                }
            }, (dn: DN, changes: DirectoryChange[]): Promise<void> => host.writeOperational(dn, changes))
            this.policies.set(host, policy)
        }
        return policy
    }
}
