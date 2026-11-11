import {type DirectoryEntry, type DN, MemoryBackend, type WriteContext} from '../../exports/LDAPEngine.js'

/**
 * A backend in memory with transaction() and lock(), as the backends of databases have them: the engine makes a modify
 * and a rename again from the entry lock() gives, in the transaction, once the interceptors' beforeCommit() has run
 */
export class LockingBackend extends MemoryBackend {
    /**
     * The entries lock() gave, in order (what the engine read again)
     */
    public readonly locked: string[] = []

    public async transaction(context: WriteContext, run: () => Promise<void>): Promise<void> {
        await run()
    }

    public async lock(context: WriteContext, dn: DN): Promise<DirectoryEntry | undefined> {
        this.locked.push(dn.toString())
        return this.get(context, dn)
    }
}
