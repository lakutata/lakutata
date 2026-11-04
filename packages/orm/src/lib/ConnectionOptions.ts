import path from 'node:path'
import {type DataSourceOptions} from '#typeorm/data-source/DataSourceOptions.js'

/**
 * The option of the file (or the directory) of each driver keeping its database in the file system
 */
const FILE_OPTIONS: Record<string, string> = {
    'better-sqlite3': 'database',
    'mongo-embedded': 'database',
    'sqljs': 'location'
}

/**
 * A path given with an alias of the application (`@data/app.sqlite`) resolved as `path.resolve()` resolves it once the
 * application declared its aliases; any other value as it is
 * @param value
 */
function resolveAlias<Value>(value: Value): Value {
    return (typeof value === 'string' && value.startsWith('@') ? path.resolve(value) : value) as Value
}

/**
 * The paths of a list of the options (the globs of the entities, the migrations, the subscribers) resolved
 * @param list
 */
function resolveAliases<List>(list: List): List {
    if (Array.isArray(list)) return list.map(resolveAlias) as List
    if (list && typeof list === 'object') return Object.fromEntries(Object.entries(list).map(([name, value]: [string, unknown]): [string, unknown] => [name, resolveAlias(value)])) as List
    return list
}

/**
 * The connection options with the defaults of the framework: the null and undefined values of the where conditions
 * ignored (the condition on the property left out), as TypeORM 0.3 did, where TypeORM 1 throws by default. Each key of
 * the `invalidWhereValuesBehavior` of the options replaces its default (`{undefined: 'throw'}` throws on the undefined
 * values and still ignores the null values). The paths given with an alias of the application (`@data/app.sqlite`) are
 * resolved: the file of the database (`database`, `location` of sql.js) and the globs of the entities, the migrations
 * and the subscribers.
 * @param options The connection options.
 * @returns The connection options with the defaults.
 */
export function connectionOptionsOf<Options extends DataSourceOptions>(options: Options): Options {
    const given: Record<string, unknown> = options as unknown as Record<string, unknown>
    //The options given only: an option left out stays out
    const paths: Record<string, unknown> = {}
    const file: string | undefined = FILE_OPTIONS[options.type]
    if (file && given[file] !== undefined) paths[file] = resolveAlias(given[file])
    for (const list of ['entities', 'migrations', 'subscribers']) if (given[list] !== undefined) paths[list] = resolveAliases(given[list])
    return {
        ...options,
        ...paths,
        invalidWhereValuesBehavior: {null: 'ignore', undefined: 'ignore', ...options.invalidWhereValuesBehavior}
    }
}
