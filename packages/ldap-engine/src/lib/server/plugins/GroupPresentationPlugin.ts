import {type Filter} from '../../filter/Filter.js'
import type {PartialAttribute} from '../../protocol/Messages.js'
import {attributeTypeOf, type Schema} from '../../schema/Schema.js'
import type {DirectoryEntry, InterceptorPlacement, LDAPInterceptor, OperationContext, SearchContext, ServerRequest} from '../Types.js'
import {keepApproval} from '../Paging.js'
import {BaseLDAPPlugin, type BasePluginOptions} from './BaseLDAPPlugin.js'

/**
 * The options of a {@link GroupPresentationPlugin}: the two group classes a group is shown as, and their member
 * attributes
 */
export interface GroupPresentationOptions extends BasePluginOptions {
    /**
     * The first class and its member attribute (groupOfNames and member by default)
     */
    first?: {objectClass: string, member: string}
    /**
     * The second class and its member attribute (groupOfUniqueNames and uniqueMember by default)
     */
    second?: {objectClass: string, member: string}
}

/**
 * Each group of one class shown as a group of the other too, as lldap shows them: a groupOfNames entry is read with
 * groupOfUniqueNames and its members in uniqueMember as well, and the reverse, and a filter on either class or either
 * member attribute finds both. For the clients knowing one class only; the entries are not changed. It runs before the
 * paging, so a sort or a virtual list view uses the entries as stored, without the class and members it shows.
 * @example
 * ```typescript
 * import {createLDAPServer, GroupPresentationPlugin, MemoryBackend} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     plugins: [new GroupPresentationPlugin()]
 * })
 * ```
 */
export class GroupPresentationPlugin extends BaseLDAPPlugin {
    /**
     * The first class and its member attribute
     */
    protected readonly first: {objectClass: string, member: string}

    /**
     * The second class and its member attribute
     */
    protected readonly second: {objectClass: string, member: string}

    /**
     * The plugin
     * @param options The two classes and their member attributes, the name and the suffixes.
     */
    constructor(options: GroupPresentationOptions = {}) {
        super('group-presentation', options)
        this.first = options.first ?? {objectClass: 'groupOfNames', member: 'member'}
        this.second = options.second ?? {objectClass: 'groupOfUniqueNames', member: 'uniqueMember'}
    }

    /**
     * Its interceptor, before the paging: it changes the entries sent and leaves none out, so the paging, the sort
     * and the window of the backend stay with it
     */
    public get interceptors(): InterceptorPlacement[] {
        return [{interceptor: presentation(this.name, this.first, this.second), before: 'paging'}]
    }
}

/**
 * The interceptor showing the groups of each class as groups of the other
 * @param name Its name.
 * @param first The first class and its member attribute.
 * @param second The second class and its member attribute.
 */
function presentation(name: string, first: {objectClass: string, member: string}, second: {objectClass: string, member: string}): LDAPInterceptor {
    const same = (schema: Schema, left: string, right: string): boolean => schema.primaryName(left).toLowerCase() === schema.primaryName(right).toLowerCase()
    /**
     * The filter with its items on one class or member attribute also matching the other
     */
    const widen = (filter: Filter, schema: Schema): Filter => {
        switch (filter.type) {
            case 'and':
            case 'or':
                return {...filter, filters: filter.filters.map((item: Filter): Filter => widen(item, schema))}
            case 'not':
                return {...filter, filter: widen(filter.filter, schema)}
            case 'equality': {
                const type: string = attributeTypeOf(filter.attribute)
                if (same(schema, type, 'objectClass')) {
                    const value: string = filter.value.toString('utf8')
                    const other: string | undefined = same(schema, value, first.objectClass) ? second.objectClass : same(schema, value, second.objectClass) ? first.objectClass : undefined
                    return other ? {type: 'or', filters: [filter, {type: 'equality', attribute: filter.attribute, value: Buffer.from(other)}]} : filter
                }
                const otherMember: string | undefined = same(schema, type, first.member) ? second.member : same(schema, type, second.member) ? first.member : undefined
                return otherMember ? {type: 'or', filters: [filter, {type: 'equality', attribute: otherMember, value: filter.value}]} : filter
            }
            case 'present': {
                const type: string = attributeTypeOf(filter.attribute)
                const otherMember: string | undefined = same(schema, type, first.member) ? second.member : same(schema, type, second.member) ? first.member : undefined
                return otherMember ? {type: 'or', filters: [filter, {type: 'present', attribute: otherMember}]} : filter
            }
            default:
                return filter
        }
    }
    return {
        name: name,
        operations: ['search'],
        before: (context: OperationContext, request: ServerRequest): void => {
            if (request.type !== 'search') return
            request.filter = widen(request.filter, context.schema)
            Object.assign(context, {filter: request.filter})
        },
        transformEntry: (context: SearchContext, entry: DirectoryEntry): DirectoryEntry => {
            const schema: Schema = context.schema
            const classes: PartialAttribute | undefined = entry.attributes.find((attribute: PartialAttribute): boolean => same(schema, attributeTypeOf(attribute.type), 'objectClass'))
            if (!classes) return entry
            const names: string[] = classes.values.map((value: Buffer): string => value.toString('utf8'))
            const hasFirst: boolean = names.some((name: string): boolean => same(schema, name, first.objectClass))
            const hasSecond: boolean = names.some((name: string): boolean => same(schema, name, second.objectClass))
            if (hasFirst === hasSecond) return entry
            const [from, to] = hasFirst ? [first, second] : [second, first]
            const members: Buffer[] = entry.attributes.filter((attribute: PartialAttribute): boolean => same(schema, attributeTypeOf(attribute.type), from.member)).flatMap((attribute: PartialAttribute): Buffer[] => attribute.values)
            const attributes: PartialAttribute[] = entry.attributes.map((attribute: PartialAttribute): PartialAttribute => attribute === classes ? {type: attribute.type, values: [...attribute.values, Buffer.from(to.objectClass)]} : attribute)
            if (members.length) attributes.push({type: to.member, values: members})
            //The access check saw the group as stored
            const shown: DirectoryEntry = {dn: entry.dn, attributes: attributes}
            keepApproval(context, entry, shown)
            return shown
        }
    }
}
