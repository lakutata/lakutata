import {Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn} from '@lakutata/orm/decorator/orm'

/**
 * An entry of the directory backend: its ID (its entryUUID), its parent, the path of the IDs from the top of its suffix
 * to it (for the searches of a subtree), its DN as written and normalized, and its RDN; its attributes are values of
 * {@link LDAPValueRecord}
 * @example
 * ```typescript
 * import type {Database} from 'lakutata/com/database'
 * import {LDAPEntryRecord} from '@lakutata/ldap'
 *
 * async function countEntries(database: Database): Promise<number> {
 *     return database.getRepository(LDAPEntryRecord).count()
 * }
 * ```
 */
@Entity('ldap_entry')
@Index('ldap_entry_dn', ['suffix', 'dnHash'], {unique: true})
export class LDAPEntryRecord {
    /**
     * The ID, the entryUUID of the entry
     */
    @PrimaryColumn({name: 'id', type: 'varchar', length: 36})
    public id: string

    /**
     * The normalized suffix of the backend the entry belongs to
     */
    @Column({name: 'suffix', type: 'varchar', length: 255})
    public suffix: string

    /**
     * The ID of the parent; empty for the entry of the suffix
     */
    @Index('ldap_entry_parent')
    @Column({name: 'parent_id', type: 'varchar', length: 36, default: ''})
    public parentId: string

    /**
     * The IDs from the entry of the suffix to this one, without their hyphens, one after the other: hexadecimal only, so
     * that a subtree is a range of paths (`path >= P AND path < P || 'g'`) in the order of every collation, which an
     * index serves where `LIKE 'P%'` would read the whole table (PostgreSQL outside the C collation)
     */
    @Index('ldap_entry_path')
    @Column({name: 'path', type: 'varchar', length: 760})
    public path: string

    /**
     * The DN as written
     */
    @Column({name: 'dn', type: 'text'})
    public dn: string

    /**
     * The DN normalized by the schema
     */
    @Column({name: 'dn_key', type: 'text'})
    public dnKey: string

    /**
     * The SHA-256 of the normalized DN, in hex
     */
    @Column({name: 'dn_hash', type: 'varchar', length: 64})
    public dnHash: string
}

/**
 * The columns of the values of the directory backend, but the value itself (TEXT, or LONGTEXT on MySQL): its bytes (as text when they are UTF-8, else in base64), the hash of its form
 * for equality, its form for substrings, its form for ordering when it is a number or a time, and the ID of the entry
 * a DN value names in the same backend
 */
export abstract class LDAPValueColumns {
    /**
     * The ID of the value
     */
    @PrimaryGeneratedColumn('increment', {name: 'id'})
    public id: number

    /**
     * The ID of the entry
     */
    @Column({name: 'entry_id', type: 'varchar', length: 36})
    public entryId: string

    /**
     * The primary name of the attribute type, in lower case
     */
    @Column({name: 'attribute_type', type: 'varchar', length: 128})
    public attributeType: string

    /**
     * The attribute description as the entry has it (`cn;lang-en`)
     */
    @Column({name: 'description', type: 'varchar', length: 255})
    public description: string

    /**
     * The order of the value among those of its attribute
     */
    @Column({name: 'position', type: 'int'})
    public position: number


    /**
     * Whether the value is in base64
     */
    @Column({name: 'is_binary', type: 'boolean', default: false})
    public binary: boolean

    /**
     * The SHA-256, in hex, of the form the equality rule compares by
     */
    @Column({name: 'value_hash', type: 'varchar', length: 64})
    public valueHash: string

    /**
     * The form the substrings rule compares by, when it is not too long; for a name and optional UID, which has no
     * substrings rule, the DN it names, found by an approximate match
     */
    @Column({name: 'value_key', type: 'varchar', length: 1000, nullable: true})
    public valueKey: string | null

    /**
     * The form the value orders by in a sort: an integer or a time in digits of fixed width, a string as the
     * hexadecimal of its prepared form (see `sortForm()`)
     */
    @Column({name: 'sort_key', type: 'varchar', length: 512, nullable: true})
    public sortKey: string | null

    /**
     * The ID of the entry a DN value names, in the same backend
     */
    @Column({name: 'target', type: 'varchar', length: 36, nullable: true})
    public target: string | null
}

/**
 * A value of an attribute of an entry: its bytes (as text when they are UTF-8, else in base64), the hash of its form
 * for equality, its form for substrings, its form for ordering when it is a number or a time, and the ID of the entry
 * a DN value names in the same backend
 * @example
 * ```typescript
 * import type {Database} from 'lakutata/com/database'
 * import {LDAPValueRecord} from '@lakutata/ldap'
 *
 * async function countValues(database: Database, attributeType: string): Promise<number> {
 *     return database.getRepository(LDAPValueRecord).countBy({attributeType: attributeType.toLowerCase()})
 * }
 * ```
 */
@Entity('ldap_value')
@Index('ldap_value_entry', ['entryId'])
@Index('ldap_value_key', ['attributeType', 'valueHash'])
@Index('ldap_value_sort', ['attributeType', 'sortKey'])
@Index('ldap_value_target', ['target'])
export class LDAPValueRecord extends LDAPValueColumns {
    /**
     * The value: its text, or its bytes in base64 when `binary`
     */
    @Column({name: 'value', type: 'text'})
    public value: string
}

/**
 * A value of an attribute that must be unique in a suffix
 * @example
 * ```typescript
 * import type {Database} from 'lakutata/com/database'
 * import {LDAPUniqueRecord} from '@lakutata/ldap'
 *
 * async function uniqueValues(database: Database): Promise<number> {
 *     return database.getRepository(LDAPUniqueRecord).count()
 * }
 * ```
 */
@Entity('ldap_unique')
export class LDAPUniqueRecord {
    /**
     * The normalized suffix
     */
    @PrimaryColumn({name: 'suffix', type: 'varchar', length: 255})
    public suffix: string

    /**
     * The primary name of the attribute type, in lower case
     */
    @PrimaryColumn({name: 'attribute_type', type: 'varchar', length: 128})
    public attributeType: string

    /**
     * The hash of the form of the value
     */
    @PrimaryColumn({name: 'value_hash', type: 'varchar', length: 64})
    public valueHash: string

    /**
     * The ID of the entry holding it
     */
    @Index('ldap_unique_entry')
    @Column({name: 'entry_id', type: 'varchar', length: 36})
    public entryId: string
}

/**
 * The failed binds of a DN or an address, shared by the instances of a server
 * @example
 * ```typescript
 * import type {Database} from 'lakutata/com/database'
 * import {LDAPBindStateRecord} from '@lakutata/ldap'
 *
 * async function forgetFailures(database: Database): Promise<void> {
 *     await database.getRepository(LDAPBindStateRecord).clear()
 * }
 * ```
 */
@Entity('ldap_bind_state')
export class LDAPBindStateRecord {
    /**
     * The key: `dn:` and a normalized DN, or `ip:` and an address
     */
    @PrimaryColumn({name: 'key', type: 'varchar', length: 255})
    public key: string

    /**
     * The times of the failures, in milliseconds, as JSON
     */
    @Column({name: 'failures', type: 'text'})
    public failures: string

    /**
     * Until when the binds are refused, in milliseconds
     */
    @Column({name: 'locked_until', type: 'varchar', length: 20, nullable: true})
    public lockedUntil: string | null
}

/**
 * A value of an attribute of an entry, on MySQL and MariaDB: its column holds up to 4 GB (LONGTEXT) rather than the
 * 64 KB of TEXT, for the photos and the certificates
 * @example
 * ```typescript
 * import type {Database} from 'lakutata/com/database'
 * import {LDAPMySQLValueRecord} from '@lakutata/ldap'
 *
 * async function countValues(database: Database): Promise<number> {
 *     return database.getRepository(LDAPMySQLValueRecord).count()
 * }
 * ```
 */
@Entity('ldap_value')
@Index('ldap_value_entry', ['entryId'])
@Index('ldap_value_key', ['attributeType', 'valueHash'])
@Index('ldap_value_sort', ['attributeType', 'sortKey'])
@Index('ldap_value_target', ['target'])
export class LDAPMySQLValueRecord extends LDAPValueColumns {
    /**
     * The value: its text, or its bytes in base64 when `binary`
     */
    @Column({name: 'value', type: 'longtext'})
    public value: string
}

//The database types of the MySQL family
const MYSQL_TYPES: string[] = ['mysql', 'mariadb', 'aurora-mysql']

/**
 * The entities of the directory backend, for the `entities` of the application's database: its type tells them apart
 * (on MySQL and MariaDB the values are in a LONGTEXT column)
 * @param type The type of the database (`postgres`, `mysql`, `better-sqlite3`…).
 * @example
 * ```typescript
 * import {buildDatabaseOptions} from 'lakutata/com/database'
 * import {directoryEntities} from '@lakutata/ldap'
 *
 * const database = buildDatabaseOptions({type: 'mysql', url: process.env.DATABASE_URL, entities: [...directoryEntities('mysql')]})
 * ```
 */
export function directoryEntities(type: string): Function[] {
    return [LDAPEntryRecord, MYSQL_TYPES.includes(type) ? LDAPMySQLValueRecord : LDAPValueRecord, LDAPUniqueRecord, LDAPBindStateRecord]
}

/**
 * Whether a database type is of the MySQL family
 * @param type The type.
 */
export function isMySQL(type: string): boolean {
    return MYSQL_TYPES.includes(type)
}
