import {type Filter} from '../filter/Filter.js'
import type {PartialAttribute} from '../protocol/Messages.js'
import {attributeTypeOf, type Schema} from '../schema/Schema.js'
import type {DirectoryEntry, LDAPInterceptor, OperationContext, SearchContext, ServerRequest} from './Types.js'

/**
 * Two group classes a group is shown as, and their member attributes
 */
export interface GroupPresentationOptions {
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
 * An interceptor showing each group of one class as a group of the other too, as lldap does: a groupOfNames entry is
 * read with groupOfUniqueNames and its members in uniqueMember as well, and the reverse, and a filter on either class
 * or either member attribute finds both. For the clients knowing one class only; the entries are not changed. Off by
 * default: give it in the interceptors of the server.
 * @param options The two classes and their member attributes.
 * @example
 * ```typescript
 * import {createLDAPServer, groupPresentationInterceptor, MemoryBackend} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     interceptors: [groupPresentationInterceptor()]
 * })
 * ```
 */
export function groupPresentationInterceptor(options: GroupPresentationOptions = {}): LDAPInterceptor {
    const first: {objectClass: string, member: string} = options.first ?? {objectClass: 'groupOfNames', member: 'member'}
    const second: {objectClass: string, member: string} = options.second ?? {objectClass: 'groupOfUniqueNames', member: 'uniqueMember'}
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
        name: 'group-presentation',
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
            return {dn: entry.dn, attributes: attributes}
        }
    }
}
