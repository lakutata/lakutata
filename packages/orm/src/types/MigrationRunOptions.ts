/**
 * How {@link Database.runMigrations} and {@link Database.undoLastMigration} run the migrations: in transactions or not,
 * for real or only recorded.
 */
export type MigrationRunOptions = {
    /**
     * The transactions wrapping the migrations: `'all'` runs them all in one transaction (one failure rolls them all
     * back), `'each'` runs each one in its own transaction (the ones before a failure stay applied), `'none'` runs them
     * without a transaction. A migration may override it with its own `transaction` property.
     * @default The `migrationsTransactionMode` of the connection options for `runMigrations()`, else `'all'`
     */
    transaction?: 'all' | 'none' | 'each'
    /**
     * Record the migrations as run (or remove them as reverted) in the migrations table without running their `up()`
     * (or `down()`): for a database whose schema is already up to date.
     * @default false
     */
    fake?: boolean
}
