/**
 * The command of the migrations of the databases given to the application by its environment
 */
export type MigrationCommand = {
    /**
     * generate (MIGRATION_GENERATE, the directory of the migrations), run (MIGRATION_RUN), revert (MIGRATION_REVERT) or
     * show (MIGRATION_SHOW)
     */
    action: 'generate' | 'run' | 'revert' | 'show'
    /**
     * The directory of the migrations generated
     */
    path?: string
    /**
     * The database of the command (MIGRATION_DATABASE, the name of its component or provider), all by default
     */
    database?: string
    /**
     * The transactions of the migrations run or reverted (MIGRATION_TRANSACTION: all, none or each)
     */
    transaction?: 'all' | 'none' | 'each'
    /**
     * The migrations marked as run or reverted without being executed (MIGRATION_FAKE)
     */
    fake: boolean
}

/**
 * The command of the migrations given by the environment, its variables named in any case
 * @param env
 */
export function readMigrationCommand(env: NodeJS.ProcessEnv): MigrationCommand | undefined {
    const variables: Map<string, string> = new Map()
    for (const name in env) if (name.toUpperCase().startsWith('MIGRATION_') && env[name] !== undefined) variables.set(name.toUpperCase(), env[name]!)
    const flag = (name: string): boolean => ['1', 'true', 'yes'].includes((variables.get(name) ?? '').toLowerCase())
    const transaction: string | undefined = variables.get('MIGRATION_TRANSACTION') || undefined
    if (transaction !== undefined && transaction !== 'all' && transaction !== 'none' && transaction !== 'each') throw new Error(`MIGRATION_TRANSACTION is all, none or each, not "${transaction}"`)
    const common = {
        database: variables.get('MIGRATION_DATABASE') || undefined,
        transaction: transaction as MigrationCommand['transaction'],
        fake: flag('MIGRATION_FAKE')
    }
    if (variables.get('MIGRATION_GENERATE')) return {action: 'generate', path: variables.get('MIGRATION_GENERATE'), ...common}
    if (flag('MIGRATION_RUN')) return {action: 'run', ...common}
    if (flag('MIGRATION_REVERT')) return {action: 'revert', ...common}
    if (flag('MIGRATION_SHOW')) return {action: 'show', ...common}
    return undefined
}
