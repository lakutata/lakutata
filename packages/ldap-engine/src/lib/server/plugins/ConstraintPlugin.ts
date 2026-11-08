import {LDAPUsageException} from '../../../exceptions/LDAPUsageException.js'
import {ResultCode} from '../../protocol/ResultCode.js'
import type {Schema} from '../../schema/Schema.js'
import {fail} from '../EntryTools.js'
import type {LDAPInProcessConnection} from '../InProcessConnection.js'
import type {LDAPInterceptor, OperationContext, ServerRequest} from '../Types.js'
import {BaseLDAPPlugin, type BasePluginOptions} from './BaseLDAPPlugin.js'
import {isOfType, readEntry, valuesIn} from './PluginTools.js'

/**
 * A rule on the values of an attribute
 */
export interface ConstraintRule {
    /**
     * The attribute
     */
    attribute: string
    /**
     * A pattern every value matches
     */
    pattern?: RegExp | string
    /**
     * The most bytes a value has
     */
    size?: number
    /**
     * The most values the attribute has
     */
    count?: number
    /**
     * A check of one's own (a DTO, a lookup): false, or a message, refuses the value
     * @param value The value, as text.
     * @param target The DN of the entry and the attribute.
     */
    check?: (value: string, target: {dn: string, attribute: string}) => boolean | string | undefined
}

/**
 * The options of a {@link ConstraintPlugin}
 */
export interface ConstraintPluginOptions extends BasePluginOptions {
    /**
     * The rules
     */
    rules: ConstraintRule[]
}

/**
 * Rules on the values of attributes, as the constraint overlay of OpenLDAP applies them: a pattern, a size, a count of
 * values, or a check of one's own; an add, a modify or a rename breaking one is refused with constraintViolation (19).
 * The internal writes of the engine and the plugins are not checked.
 * @example
 * ```typescript
 * import {ConstraintPlugin, createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     plugins: [new ConstraintPlugin({rules: [
 *         {attribute: 'mail', pattern: /^[^@\s]+@example\.com$/, count: 3},
 *         {attribute: 'telephoneNumber', check: (value) => /^\+\d[\d ]+$/.test(value) || 'An international number'}
 *     ]})]
 * })
 * ```
 */
export class ConstraintPlugin extends BaseLDAPPlugin {
    /**
     * The rules, their patterns made
     */
    protected readonly rules: (ConstraintRule & {regexp?: RegExp})[]

    /**
     * The plugin
     * @param options The rules, the name and the suffixes.
     */
    constructor(options: ConstraintPluginOptions) {
        super('constraint', options)
        if (!Array.isArray(options?.rules) || !options.rules.length) throw new LDAPUsageException(`The plugin ${this.name} needs rules`)
        this.rules = options.rules.map((rule: ConstraintRule): ConstraintRule & {regexp?: RegExp} => {
            if (typeof rule?.attribute !== 'string' || !rule.attribute) throw new LDAPUsageException(`A rule of the plugin ${this.name} needs its attribute`)
            for (const limit of ['size', 'count'] as const) {
                if (rule[limit] !== undefined && (!Number.isSafeInteger(rule[limit]) || rule[limit]! < 0)) throw new LDAPUsageException(`The ${limit} of the rule of ${rule.attribute} must be a positive integer`)
            }
            if (rule.check !== undefined && typeof rule.check !== 'function') throw new LDAPUsageException(`The check of the rule of ${rule.attribute} must be a function`)
            return {...rule, ...rule.pattern !== undefined ? {regexp: rule.pattern instanceof RegExp ? rule.pattern : new RegExp(rule.pattern)} : {}}
        })
    }

    /**
     * Its interceptor, at the end of the chain
     */
    public get interceptors(): LDAPInterceptor[] {
        return [{name: this.name, operations: ['add', 'modify', 'modifyDN'], before: (context: OperationContext, request: ServerRequest): Promise<void> => this.before(context, request)}]
    }

    /**
     * Refuse a write breaking a rule
     * @param context The context.
     * @param request The request.
     */
    protected async before(context: OperationContext, request: ServerRequest): Promise<void> {
        if (context.internal) return
        const schema: Schema = context.schema
        for (const rule of this.rules) {
            let values: Buffer[] = []
            let count: number | undefined
            if (request.type === 'add') {
                values = valuesIn(request.entry.attributes, rule.attribute, schema)
                count = values.length
            } else if (request.type === 'modify') {
                const changes = request.changes.filter((change): boolean => isOfType(change.attribute.type, rule.attribute, schema))
                if (!changes.length) continue
                values = changes.filter((change): boolean => change.operation !== 'delete').flatMap((change): Buffer[] => change.attribute.values)
                if (rule.count !== undefined) count = await this.countAfter(context, request.dn.toString(), rule.attribute, changes)
            } else if (request.type === 'modifyDN') {
                values = request.newRDN.attributes.filter((item): boolean => isOfType(item.type, rule.attribute, schema)).map((item): Buffer => Buffer.from(item.value))
            }
            const dn: string = request.type === 'add' ? request.entry.dn.toString() : (request as {dn: {toString(): string}}).dn.toString()
            if (rule.count !== undefined && count !== undefined && count > rule.count) fail(ResultCode.constraintViolation, `${rule.attribute}: at most ${rule.count} values`)
            for (const value of values) {
                const text: string = value.toString('utf8')
                if (rule.size !== undefined && value.length > rule.size) fail(ResultCode.constraintViolation, `${rule.attribute}: a value has at most ${rule.size} bytes`)
                if (rule.regexp && !rule.regexp.test(text)) fail(ResultCode.constraintViolation, `${rule.attribute}: the value ${text} does not match ${rule.regexp.source}`)
                if (rule.check) {
                    const verdict: boolean | string | undefined = rule.check(text, {dn: dn, attribute: rule.attribute})
                    if (verdict === false || typeof verdict === 'string') fail(ResultCode.constraintViolation, `${rule.attribute}: ${typeof verdict === 'string' ? verdict : `the value ${text} is refused`}`)
                }
            }
        }
    }

    /**
     * The count of values of an attribute after the changes of a modify
     * @param context The context.
     * @param dn The DN.
     * @param attribute The attribute.
     * @param changes Its changes.
     */
    protected async countAfter(context: OperationContext, dn: string, attribute: string, changes: {operation: string, attribute: {values: Buffer[]}}[]): Promise<number> {
        let count: number = await this.internally(context, async (connection: LDAPInProcessConnection): Promise<number> => (await readEntry(connection, dn, [attribute]))?.getBuffers(attribute).length ?? 0)
        for (const change of changes) {
            if (change.operation === 'replace') count = change.attribute.values.length
            else if (change.operation === 'add') count += change.attribute.values.length
            else if (change.operation === 'delete') count = change.attribute.values.length ? Math.max(0, count - change.attribute.values.length) : 0
        }
        return count
    }
}
