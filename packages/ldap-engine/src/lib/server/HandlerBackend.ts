import type {AttributeValue} from '../client/Connection.js'
import {valuesBytes} from '../client/Values.js'
import {DN} from '../dn/DN.js'
import type {PartialAttribute} from '../protocol/Messages.js'
import type {BackendCapabilities, BackendSearchResult, BindOutcome, DirectoryChange, DirectoryEntry, LDAPBackend, OperationContext, SearchContext, WriteContext} from './Types.js'

/**
 * An entry as a handler gives it: its DN as text or a DN, its attributes by name (text, numbers, booleans or bytes)
 * or as the messages carry them
 */
export interface HandlerEntry {
    /**
     * The DN
     */
    dn: string | DN
    /**
     * The attributes
     */
    attributes: Record<string, AttributeValue | AttributeValue[] | undefined> | PartialAttribute[]
}

/**
 * The handlers of a backend written operation by operation, as ldapjs servers are: only `search` is required
 */
export interface HandlerBackendOptions {
    /**
     * The DN of the entry the backend holds and everything below it
     */
    suffix: string
    /**
     * What the backend does itself
     */
    capabilities?: BackendCapabilities
    /**
     * An entry by its DN; without it, a search of the base entry
     * @param context The context.
     * @param dn The DN.
     */
    get?(context: OperationContext, dn: DN): Promise<HandlerEntry | undefined> | HandlerEntry | undefined
    /**
     * The entries of a search: a superset of the matching ones, which the engine filters, or the result of a backend
     * @param context The search.
     */
    search(context: SearchContext): Promise<Iterable<HandlerEntry> | AsyncIterable<HandlerEntry> | (Omit<BackendSearchResult, 'entries'> & {entries: Iterable<HandlerEntry> | AsyncIterable<HandlerEntry>})> | Iterable<HandlerEntry> | AsyncIterable<HandlerEntry>
    /**
     * Check a password; without it, the engine checks the userPassword of the entry
     * @param context The context.
     * @param dn The DN.
     * @param password The password.
     */
    bind?(context: OperationContext, dn: DN, password: Buffer): Promise<boolean> | boolean
    /**
     * Add an entry
     * @param context The context.
     * @param entry The entry.
     */
    add?(context: WriteContext, entry: DirectoryEntry): Promise<void> | void
    /**
     * Change an entry
     * @param context The context.
     * @param dn The DN.
     * @param changes The changes.
     */
    modify?(context: WriteContext, dn: DN, changes: DirectoryChange[]): Promise<void> | void
    /**
     * Delete an entry
     * @param context The context.
     * @param dn The DN.
     * @param options Whether the entries below go too.
     */
    delete?(context: WriteContext, dn: DN, options: {subtree: boolean}): Promise<void> | void
    /**
     * Rename or move an entry
     * @param context The context.
     * @param dn The DN.
     * @param entry The entry as it becomes.
     */
    modifyDN?(context: WriteContext, dn: DN, entry: DirectoryEntry): Promise<void> | void
}

/**
 * An entry of a handler as the engine handles it
 * @param entry The entry.
 */
function directoryEntry(entry: HandlerEntry): DirectoryEntry {
    const attributes: PartialAttribute[] = Array.isArray(entry.attributes) ? entry.attributes : Object.entries(entry.attributes)
        .filter(([, values]): boolean => values !== undefined && values !== null)
        .map(([type, values]): PartialAttribute => ({type: type, values: valuesBytes(values as AttributeValue | AttributeValue[])}))
    return {dn: DN.from(entry.dn), attributes: attributes}
}

/**
 * The entries of a handler as the engine handles them
 * @param entries The entries.
 */
async function* directoryEntries(entries: Iterable<HandlerEntry> | AsyncIterable<HandlerEntry>): AsyncGenerator<DirectoryEntry> {
    for await (const entry of entries) yield directoryEntry(entry)
}

/**
 * A backend from handlers written operation by operation, as ldapjs servers are: the entries given as plain objects,
 * a search returning a list or an iterable (filtered by the engine), an entry found by a search of its DN when there
 * is no `get`
 * @param options The suffix and the handlers.
 * @example
 * ```typescript
 * import {createHandlerBackend, createLDAPServer, type LDAPBackend} from '@lakutata/ldap-engine'
 *
 * const devices = [{name: 'printer1', ip: '10.0.0.5'}, {name: 'printer2', ip: '10.0.0.6'}]
 * const backend: LDAPBackend = createHandlerBackend({
 *     suffix: 'ou=devices,dc=example,dc=com',
 *     search: () => [
 *         {dn: 'ou=devices,dc=example,dc=com', attributes: {objectClass: 'organizationalUnit', ou: 'devices'}},
 *         ...devices.map((device) => ({dn: `cn=${device.name},ou=devices,dc=example,dc=com`, attributes: {objectClass: 'device', cn: device.name, description: device.ip}}))
 *     ]
 * })
 * const server = createLDAPServer({backends: [backend], access: {anonymousRead: true}})
 * ```
 */
export function createHandlerBackend(options: HandlerBackendOptions): LDAPBackend {
    const search = async (context: SearchContext): Promise<BackendSearchResult> => {
        const result = await options.search(context)
        if (Symbol.iterator in result || Symbol.asyncIterator in result) return {entries: directoryEntries(result as Iterable<HandlerEntry>), exact: false}
        const backendResult = result as Omit<BackendSearchResult, 'entries'> & {entries: Iterable<HandlerEntry> | AsyncIterable<HandlerEntry>}
        return {...backendResult, entries: directoryEntries(backendResult.entries)}
    }
    const backend: LDAPBackend = {
        suffix: options.suffix,
        capabilities: options.capabilities,
        get: async (context: OperationContext, dn: DN): Promise<DirectoryEntry | undefined> => {
            if (options.get) {
                const found: HandlerEntry | undefined = await options.get(context, dn)
                return found ? directoryEntry(found) : undefined
            }
            const result: BackendSearchResult = await search({
                ...context,
                base: dn,
                scope: 'base',
                filter: {type: 'present', attribute: 'objectClass'},
                attributes: {allUser: true, allOperational: true, names: new Set()},
                typesOnly: false,
                sizeLimit: 0,
                deadline: 0
            })
            for await (const entry of result.entries) if (entry.dn.equals(dn, context.schema)) return entry
            return undefined
        },
        search: search
    }
    if (options.bind) backend.bind = async (context: OperationContext, dn: DN, password: Buffer): Promise<BindOutcome> => ({ok: await options.bind!(context, dn, password)})
    if (options.add) backend.add = async (context: WriteContext, entry: DirectoryEntry): Promise<void> => options.add!(context, entry)
    if (options.modify) backend.modify = async (context: WriteContext, dn: DN, changes: DirectoryChange[]): Promise<void> => options.modify!(context, dn, changes)
    if (options.delete) backend.delete = async (context: WriteContext, dn: DN, subtree: {subtree: boolean}): Promise<void> => options.delete!(context, dn, subtree)
    if (options.modifyDN) backend.modifyDN = async (context: WriteContext, dn: DN, entry: DirectoryEntry): Promise<void> => options.modifyDN!(context, dn, entry)
    return backend
}
