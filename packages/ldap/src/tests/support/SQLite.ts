import {createRequire} from 'node:module'

/**
 * Whether better-sqlite3 loads in this runtime: it is built for the ABI of the Node.js that installed it, so Electron
 * (until it is rebuilt for it) and Bun (which refuses it) skip the tests on SQLite, and run the ones on PostgreSQL and
 * MySQL (test-env/databases/run.sh)
 */
export function sqliteLoads(): boolean {
    try {
        const Database = createRequire(import.meta.url)('better-sqlite3')
        new Database(':memory:').close()
        return true
    } catch {
        return false
    }
}
