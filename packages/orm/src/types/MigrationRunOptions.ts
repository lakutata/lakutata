/**
 * The options of running or reverting the migrations
 */
export type MigrationRunOptions = {
    /**
     * Run all the migrations in a transaction, each one in its own transaction, or none in a transaction
     */
    transaction?: 'all' | 'none' | 'each'
    /**
     * Record the migrations as run (or reverted) without running them
     */
    fake?: boolean
}
