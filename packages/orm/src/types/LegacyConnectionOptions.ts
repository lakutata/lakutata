//The names of the connection options of TypeORM 0.3, renamed `...DataSourceOptions` by TypeORM 1: kept for the code
//written against them
import {type MysqlDataSourceOptions} from '#typeorm/driver/mysql/MysqlDataSourceOptions.js'
import {type PostgresDataSourceOptions} from '#typeorm/driver/postgres/PostgresDataSourceOptions.js'
import {type CockroachDataSourceOptions} from '#typeorm/driver/cockroachdb/CockroachDataSourceOptions.js'
import {type SqlServerDataSourceOptions} from '#typeorm/driver/sqlserver/SqlServerDataSourceOptions.js'
import {type SapDataSourceOptions} from '#typeorm/driver/sap/SapDataSourceOptions.js'
import {type OracleDataSourceOptions} from '#typeorm/driver/oracle/OracleDataSourceOptions.js'
import {type CordovaDataSourceOptions} from '#typeorm/driver/cordova/CordovaDataSourceOptions.js'
import {type NativescriptDataSourceOptions} from '#typeorm/driver/nativescript/NativescriptDataSourceOptions.js'
import {type ReactNativeDataSourceOptions} from '#typeorm/driver/react-native/ReactNativeDataSourceOptions.js'
import {type SqljsDataSourceOptions} from '#typeorm/driver/sqljs/SqljsDataSourceOptions.js'
import {type MongoDataSourceOptions} from '#typeorm/driver/mongodb/MongoDataSourceOptions.js'
import {type AuroraMysqlDataSourceOptions} from '#typeorm/driver/aurora-mysql/AuroraMysqlDataSourceOptions.js'
import {type AuroraPostgresDataSourceOptions} from '#typeorm/driver/aurora-postgres/AuroraPostgresDataSourceOptions.js'
import {type ExpoDataSourceOptions} from '#typeorm/driver/expo/ExpoDataSourceOptions.js'
import {type BetterSqlite3DataSourceOptions} from '#typeorm/driver/better-sqlite3/BetterSqlite3DataSourceOptions.js'
import {type CapacitorDataSourceOptions} from '#typeorm/driver/capacitor/CapacitorDataSourceOptions.js'
import {type SpannerDataSourceOptions} from '#typeorm/driver/spanner/SpannerDataSourceOptions.js'

/**
 * The connection options of MySQL or MariaDB.
 * @deprecated Renamed {@link MysqlDataSourceOptions} by TypeORM 1.
 */
export type MysqlConnectionOptions = MysqlDataSourceOptions

/**
 * The connection options of PostgreSQL.
 * @deprecated Renamed {@link PostgresDataSourceOptions} by TypeORM 1.
 */
export type PostgresConnectionOptions = PostgresDataSourceOptions

/**
 * The connection options of CockroachDB.
 * @deprecated Renamed {@link CockroachDataSourceOptions} by TypeORM 1.
 */
export type CockroachConnectionOptions = CockroachDataSourceOptions

/**
 * The connection options of Microsoft SQL Server.
 * @deprecated Renamed {@link SqlServerDataSourceOptions} by TypeORM 1.
 */
export type SqlServerConnectionOptions = SqlServerDataSourceOptions

/**
 * The connection options of SAP HANA.
 * @deprecated Renamed {@link SapDataSourceOptions} by TypeORM 1.
 */
export type SapConnectionOptions = SapDataSourceOptions

/**
 * The connection options of Oracle.
 * @deprecated Renamed {@link OracleDataSourceOptions} by TypeORM 1.
 */
export type OracleConnectionOptions = OracleDataSourceOptions

/**
 * The connection options of Cordova SQLite.
 * @deprecated Renamed {@link CordovaDataSourceOptions} by TypeORM 1.
 */
export type CordovaConnectionOptions = CordovaDataSourceOptions

/**
 * The connection options of NativeScript SQLite.
 * @deprecated Renamed {@link NativescriptDataSourceOptions} by TypeORM 1.
 */
export type NativescriptConnectionOptions = NativescriptDataSourceOptions

/**
 * The connection options of React Native SQLite.
 * @deprecated Renamed {@link ReactNativeDataSourceOptions} by TypeORM 1.
 */
export type ReactNativeConnectionOptions = ReactNativeDataSourceOptions

/**
 * The connection options of sql.js.
 * @deprecated Renamed {@link SqljsDataSourceOptions} by TypeORM 1.
 */
export type SqljsConnectionOptions = SqljsDataSourceOptions

/**
 * The connection options of MongoDB.
 * @deprecated Renamed {@link MongoDataSourceOptions} by TypeORM 1.
 */
export type MongoConnectionOptions = MongoDataSourceOptions

/**
 * The connection options of Aurora MySQL (Data API).
 * @deprecated Renamed {@link AuroraMysqlDataSourceOptions} by TypeORM 1.
 */
export type AuroraMysqlConnectionOptions = AuroraMysqlDataSourceOptions

/**
 * The connection options of Aurora PostgreSQL (Data API).
 * @deprecated Renamed {@link AuroraPostgresDataSourceOptions} by TypeORM 1.
 */
export type AuroraPostgresConnectionOptions = AuroraPostgresDataSourceOptions

/**
 * The connection options of Expo SQLite.
 * @deprecated Renamed {@link ExpoDataSourceOptions} by TypeORM 1.
 */
export type ExpoConnectionOptions = ExpoDataSourceOptions

/**
 * The connection options of better-sqlite3.
 * @deprecated Renamed {@link BetterSqlite3DataSourceOptions} by TypeORM 1.
 */
export type BetterSqlite3ConnectionOptions = BetterSqlite3DataSourceOptions

/**
 * The connection options of Capacitor SQLite.
 * @deprecated Renamed {@link CapacitorDataSourceOptions} by TypeORM 1.
 */
export type CapacitorConnectionOptions = CapacitorDataSourceOptions

/**
 * The connection options of Google Cloud Spanner.
 * @deprecated Renamed {@link SpannerDataSourceOptions} by TypeORM 1.
 */
export type SpannerConnectionOptions = SpannerDataSourceOptions
