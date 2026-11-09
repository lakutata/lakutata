import {Schema} from '../Schema.js'
import type {SchemaDocument} from '../SchemaDocument.js'
import {CORE_SCHEMA} from './core.js'
import {COSINE_SCHEMA} from './cosine.js'
import {INETORGPERSON_SCHEMA} from './inetorgperson.js'
import {OPENSSH_LPK_SCHEMA} from './opensshLpk.js'
import {PPOLICY_SCHEMA} from './ppolicy.js'
import {RFC2307BIS_SCHEMA} from './rfc2307bis.js'
import {SYSTEM_SCHEMA} from './system.js'

export {CORE_SCHEMA, COSINE_SCHEMA, INETORGPERSON_SCHEMA, OPENSSH_LPK_SCHEMA, PPOLICY_SCHEMA, RFC2307BIS_SCHEMA, SYSTEM_SCHEMA}

/**
 * The names of the schemas bundled with the engine
 */
export type BundledSchemaName = 'system' | 'core' | 'cosine' | 'inetorgperson' | 'rfc2307bis' | 'openssh-lpk' | 'ppolicy'

/**
 * The bundled schemas besides `system`, in the order they load: core, cosine and inetorgperson are those of the RFCs,
 * which nearly every server has; rfc2307bis (the POSIX accounts and groups of the name services), openssh-lpk (the SSH
 * public keys) and ppolicy (the password policy) are loaded when asked for
 */
export const BUNDLED_SCHEMA_NAMES: readonly Exclude<BundledSchemaName, 'system'>[] = ['core', 'cosine', 'inetorgperson', 'rfc2307bis', 'openssh-lpk', 'ppolicy']

/**
 * The bundled schemas a server loads when its options name none, after `system`: core, cosine, inetorgperson
 */
export const DEFAULT_SCHEMA_NAMES: readonly Exclude<BundledSchemaName, 'system'>[] = ['core', 'cosine', 'inetorgperson']

/**
 * The bundled schemas as documents, by name. `system` (the operational attributes and the object classes of the
 * directory itself, whole by itself) is always loaded first; the others are loaded when asked for.
 */
export const BUNDLED_SCHEMAS: Readonly<Record<BundledSchemaName, SchemaDocument>> = {
    system: SYSTEM_SCHEMA,
    core: CORE_SCHEMA,
    cosine: COSINE_SCHEMA,
    inetorgperson: INETORGPERSON_SCHEMA,
    rfc2307bis: RFC2307BIS_SCHEMA,
    'openssh-lpk': OPENSSH_LPK_SCHEMA,
    ppolicy: PPOLICY_SCHEMA
}

/**
 * The bundled schemas a server loads when its options name none (core, cosine, inetorgperson), to complete in the
 * `schema` of `createLDAPServer()`
 * @example
 * ```typescript
 * import {createLDAPServer, DEFAULT_SCHEMAS, MemoryBackend, RFC2307BIS_SCHEMA} from '@lakutata/ldap-engine'
 *
 * //The POSIX accounts and groups besides the default schemas, for SSSD
 * const server = createLDAPServer({backends: [new MemoryBackend('dc=example,dc=com')], schema: [...DEFAULT_SCHEMAS, RFC2307BIS_SCHEMA]})
 * ```
 */
export const DEFAULT_SCHEMAS: readonly SchemaDocument[] = DEFAULT_SCHEMA_NAMES.map((name: Exclude<BundledSchemaName, 'system'>): SchemaDocument => BUNDLED_SCHEMAS[name])

/**
 * A schema with bundled schemas loaded: `system` always, then those asked for (core, cosine and inetorgperson by
 * default, as a server), in their order
 * @param names The schemas besides `system`.
 * @example
 * ```typescript
 * import {BUNDLED_SCHEMA_NAMES, bundledSchema, type Schema} from '@lakutata/ldap-engine'
 *
 * const schema: Schema = bundledSchema()
 * console.log(schema.attributesOf(['inetOrgPerson']).must)
 * const everything: Schema = bundledSchema(BUNDLED_SCHEMA_NAMES)
 * console.log(everything.objectClass('posixAccount')?.must)
 * ```
 */
export function bundledSchema(names: readonly BundledSchemaName[] = DEFAULT_SCHEMA_NAMES): Schema {
    const schema: Schema = new Schema().load(SYSTEM_SCHEMA, 'the bundled schema system')
    for (const name of BUNDLED_SCHEMA_NAMES.filter((item: BundledSchemaName): boolean => names.includes(item))) schema.load(BUNDLED_SCHEMAS[name], `the bundled schema ${name}`)
    return schema
}
