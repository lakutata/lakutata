import {type DataSourceOptions} from 'typeorm/data-source/DataSourceOptions.js'

/**
 * The connection options with the defaults of the framework: the null and undefined values of the where conditions
 * ignored (the condition on the property left out), as TypeORM 0.3 did, where TypeORM 1 throws by default. Each key of
 * the `invalidWhereValuesBehavior` of the options replaces its default (`{undefined: 'throw'}` throws on the undefined
 * values and still ignores the null values).
 * @param options The connection options.
 * @returns The connection options with the defaults.
 */
export function connectionOptionsOf<Options extends DataSourceOptions>(options: Options): Options {
    return {
        ...options,
        invalidWhereValuesBehavior: {null: 'ignore', undefined: 'ignore', ...options.invalidWhereValuesBehavior}
    }
}
