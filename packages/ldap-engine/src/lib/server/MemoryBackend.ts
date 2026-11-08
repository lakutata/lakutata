import type {DN} from '../dn/DN.js'
import type {PartialAttribute} from '../protocol/Messages.js'
import {matchFilter} from '../filter/Evaluate.js'
import type {Schema} from '../schema/Schema.js'
import {cloneEntry, findAttribute} from './EntryTools.js'
import type {BackendSearchResult, DirectoryChange, DirectoryEntry, LDAPBackend, OperationContext, SearchContext, WriteContext} from './Types.js'

/**
 * An entry the memory backend keeps, with the key of its parent
 */
interface Stored {
    entry: DirectoryEntry
    parent: string | undefined
}

/**
 * A backend keeping its entries in memory: for tests, small directories, and as the reference of the backend interface.
 * The entries are in a map by the normalized form of their DNs, with the children of each entry; a search walks the
 * scope and evaluates the filter by the matching rules of the schema (`exact: true`). Nothing is kept when the process ends: `entries()` and
 * `load()` export and import the entries.
 * @example
 * ```typescript
 * import {createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'
 *
 * async function serve(): Promise<void> {
 *     const backend: MemoryBackend = new MemoryBackend('dc=example,dc=com')
 *     const server = createLDAPServer({backends: [backend], access: {admins: ['cn=admin,dc=example,dc=com']}})
 *     const admin = server.connect({as: 'cn=admin,dc=example,dc=com'})
 *     await admin.add('dc=example,dc=com', {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
 *     await server.listen({port: 3389, host: '127.0.0.1'})
 * }
 * ```
 */
export class MemoryBackend implements LDAPBackend {
    /**
     * The entries, by the keys of their DNs
     */
    protected readonly stored: Map<string, Stored> = new Map()

    /**
     * The keys of the children of each entry
     */
    protected readonly children: Map<string, Set<string>> = new Map()

    /**
     * The schema the DNs are normalized by, given by the first operation
     */
    protected schema: Schema | undefined

    /**
     * A memory backend
     * @param suffix The DN of its top entry.
     */
    constructor(public readonly suffix: string) {
    }

    /**
     * The key of a DN
     * @param dn The DN.
     */
    protected key(dn: DN): string {
        return dn.key(this.schema)
    }

    /**
     * Keep the schema of the operation
     * @param context The context.
     */
    protected use(context: OperationContext): void {
        this.schema ??= context.schema
    }

    /**
     * A copy of an entry by its DN
     * @param context The context.
     * @param dn The DN.
     */
    public async get(context: OperationContext, dn: DN): Promise<DirectoryEntry | undefined> {
        this.use(context)
        const stored: Stored | undefined = this.stored.get(this.key(dn))
        return stored ? cloneEntry(stored.entry) : undefined
    }

    /**
     * Copies of the entries in the scope of a search; the engine applies the filter
     * @param context The search.
     */
    public async search(context: SearchContext): Promise<BackendSearchResult> {
        this.use(context)
        const base: string = this.key(context.base)
        const found: DirectoryEntry[] = []
        const visit = (key: string, depth: number): void => {
            const stored: Stored | undefined = this.stored.get(key)
            if (!stored) return
            const inScope: boolean = context.scope === 'base' ? depth === 0 : context.scope === 'one' ? depth === 1 : context.scope === 'children' ? depth > 0 : true
            //Only the matching entries are copied
            if (inScope && matchFilter(context.filter, stored.entry, context.schema) === true) found.push(cloneEntry(stored.entry))
            if (context.scope === 'base' || (context.scope === 'one' && depth === 1)) return
            for (const child of this.children.get(key) ?? []) visit(child, depth + 1)
        }
        visit(base, 0)
        return {entries: found, exact: true}
    }

    /**
     * Keep a copy of an entry
     * @param context The context.
     * @param entry The entry.
     */
    public async add(context: WriteContext, entry: DirectoryEntry): Promise<void> {
        this.use(context)
        const key: string = this.key(entry.dn)
        const parent: DN | undefined = entry.dn.parent()
        const parentKey: string | undefined = parent && this.stored.has(this.key(parent)) ? this.key(parent) : undefined
        this.stored.set(key, {entry: cloneEntry(entry), parent: parentKey})
        if (parentKey) this.childrenOf(parentKey).add(key)
    }

    /**
     * Apply the changes of a modify to a copy of an entry, then keep the copy
     * @param context The context.
     * @param dn The DN.
     * @param changes The changes.
     */
    public async modify(context: WriteContext, dn: DN, changes: DirectoryChange[]): Promise<void> {
        this.use(context)
        const stored: Stored | undefined = this.stored.get(this.key(dn))
        if (!stored) return
        //All the changes on a copy, then the copy kept: all or nothing
        const entry: DirectoryEntry = cloneEntry(stored.entry)
        for (const change of changes) {
            const current: PartialAttribute | undefined = findAttribute(entry, change.attribute.type, context.schema)
            const values: Buffer[] = change.attribute.values.map((value: Buffer): Buffer => Buffer.from(value))
            if (change.operation === 'add') {
                if (current) current.values.push(...values)
                else entry.attributes.push({type: change.attribute.type, values: values})
            } else if (change.operation === 'replace') {
                if (current) entry.attributes.splice(entry.attributes.indexOf(current), 1)
                if (values.length) entry.attributes.push({type: change.attribute.type, values: values})
            } else if (current) {
                current.values = values.length ? current.values.filter((value: Buffer): boolean => !values.some((item: Buffer): boolean => item.equals(value))) : []
                if (!current.values.length) entry.attributes.splice(entry.attributes.indexOf(current), 1)
            }
        }
        stored.entry = entry
    }

    /**
     * Forget an entry, with the entries below it when asked
     * @param context The context.
     * @param dn The DN.
     * @param options Whether the entries below go too.
     */
    public async delete(context: WriteContext, dn: DN, options: {subtree: boolean}): Promise<void> {
        this.use(context)
        const key: string = this.key(dn)
        const stored: Stored | undefined = this.stored.get(key)
        if (!stored) return
        const remove = (current: string): void => {
            for (const child of this.children.get(current) ?? []) remove(child)
            this.children.delete(current)
            this.stored.delete(current)
        }
        if (options.subtree) remove(key)
        else {
            this.stored.delete(key)
            this.children.delete(key)
        }
        if (stored.parent) this.children.get(stored.parent)?.delete(key)
    }

    /**
     * Keep an entry under its new DN, with the entries below it
     * @param context The context.
     * @param dn The old DN.
     * @param entry The entry as it becomes.
     */
    public async modifyDN(context: WriteContext, dn: DN, entry: DirectoryEntry): Promise<void> {
        this.use(context)
        const oldKey: string = this.key(dn)
        const stored: Stored | undefined = this.stored.get(oldKey)
        if (!stored) return
        //The entry and the entries below it, under their new DNs
        const moved: {key: string, entry: DirectoryEntry}[] = []
        const collect = (key: string, newDN: DN): void => {
            const item: Stored = this.stored.get(key)!
            moved.push({key: key, entry: key === oldKey ? cloneEntry({...entry, dn: newDN}) : {dn: newDN, attributes: item.entry.attributes}})
            for (const child of this.children.get(key) ?? []) {
                const childEntry: Stored = this.stored.get(child)!
                collect(child, newDN.child(childEntry.entry.dn.rdn()!))
            }
        }
        collect(oldKey, entry.dn)
        if (stored.parent) this.children.get(stored.parent)?.delete(oldKey)
        for (const item of moved) {
            this.stored.delete(item.key)
            this.children.delete(item.key)
        }
        for (const item of moved) {
            const key: string = this.key(item.entry.dn)
            const parent: DN | undefined = item.entry.dn.parent()
            const parentKey: string | undefined = parent && (this.stored.has(this.key(parent)) || moved.some((other): boolean => this.key(other.entry.dn) === this.key(parent))) ? this.key(parent) : undefined
            this.stored.set(key, {entry: item.entry, parent: parentKey})
            if (parentKey) this.childrenOf(parentKey).add(key)
        }
    }

    /**
     * The set of the children of an entry
     * @param key The key of the entry.
     */
    protected childrenOf(key: string): Set<string> {
        let set: Set<string> | undefined = this.children.get(key)
        if (!set) {
            set = new Set()
            this.children.set(key, set)
        }
        return set
    }

    /**
     * The count of the entries
     */
    public get size(): number {
        return this.stored.size
    }

    /**
     * Copies of all the entries, each after its parent
     */
    public entries(): DirectoryEntry[] {
        const ordered: DirectoryEntry[] = [...this.stored.values()].map((stored: Stored): DirectoryEntry => cloneEntry(stored.entry))
        return ordered.sort((left: DirectoryEntry, right: DirectoryEntry): number => left.dn.length - right.dn.length)
    }

    /**
     * Put entries in the backend as they are, without the checks of the engine (for entries exported by `entries()`),
     * each after its parent
     * @param entries The entries.
     * @param schema The schema the DNs are normalized by.
     */
    public load(entries: DirectoryEntry[], schema?: Schema): void {
        this.schema ??= schema
        for (const entry of [...entries].sort((left: DirectoryEntry, right: DirectoryEntry): number => left.dn.length - right.dn.length)) {
            const parent: DN | undefined = entry.dn.parent()
            const parentKey: string | undefined = parent && this.stored.has(this.key(parent)) ? this.key(parent) : undefined
            this.stored.set(this.key(entry.dn), {entry: cloneEntry(entry), parent: parentKey})
            if (parentKey) this.childrenOf(parentKey).add(this.key(entry.dn))
        }
    }
}
