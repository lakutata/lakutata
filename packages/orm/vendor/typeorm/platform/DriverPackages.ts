/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * lakutata: requires a package of a driver by its name written out, which the bundlers follow: the bundle of an
 * application holds this source, with no typeorm package beside it to require the drivers from. The packages of the
 * drivers of Node.js are the optional peer dependencies of @lakutata/orm, left out of the bundles when they are not
 * installed. The other packages are required by their name given.
 *
 * @param name name of the package
 * @returns the package
 */
export function requireDriverPackage(name: string): any {
    switch (name) {
        case "typeorm-aurora-data-api-driver":
            return require("typeorm-aurora-data-api-driver")
        case "better-sqlite3":
            return require("better-sqlite3")
        case "@google-cloud/spanner":
            return require("@google-cloud/spanner")
        case "mssql":
            return require("mssql")
        case "mongodb":
            return require("mongodb")
        case "mingo":
            return require("mingo")
        case "bson":
            return require("bson")
        case "mysql2":
            return require("mysql2")
        case "oracledb":
            return require("oracledb")
        case "pg":
            return require("pg")
        case "pg-native":
            return require("pg-native")
        case "pg-query-stream":
            return require("pg-query-stream")
        case "@sap/hana-client":
            return require("@sap/hana-client")
        case "@sap/hana-client/extension/Stream":
            return require("@sap/hana-client/extension/Stream")
        case "sql.js":
            return require("sql.js")
        case "redis":
            return require("redis")
        case "ioredis":
            return require("ioredis")
        default:
            return require(name)
    }
}
