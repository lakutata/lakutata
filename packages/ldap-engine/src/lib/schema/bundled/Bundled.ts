import {Schema} from '../Schema.js'
import type {SchemaDocument} from '../SchemaDocument.js'
import {CORE} from './core.js'
import {COSINE} from './cosine.js'
import {INETORGPERSON} from './inetorgperson.js'
import {OPENSSH_LPK} from './opensshLpk.js'
import {PPOLICY} from './ppolicy.js'
import {RFC2307BIS} from './rfc2307bis.js'
import {SYSTEM} from './system.js'

export {CORE, COSINE, INETORGPERSON, OPENSSH_LPK, PPOLICY, RFC2307BIS, SYSTEM}

/**
 * The names of the schemas bundled with the engine
 */
export type BundledSchemaName = 'system' | 'core' | 'cosine' | 'inetorgperson' | 'rfc2307bis' | 'openssh-lpk' | 'ppolicy'

/**
 * The bundled schemas besides `system`, in the order they load: core, cosine and inetorgperson are those of the RFCs,
 * which nearly every server has; rfc2307bis (the POSIX accounts and groups of the name services), openssh-lpk (the SSH
 * public keys) and ppolicy (the password policy) are loaded when asked for
 */
export const BUNDLED_NAMES: readonly Exclude<BundledSchemaName, 'system'>[] = ['core', 'cosine', 'inetorgperson', 'rfc2307bis', 'openssh-lpk', 'ppolicy']

/**
 * The bundled schemas a server loads when its options name none, after `system`: core, cosine, inetorgperson
 */
export const DEFAULT_NAMES: readonly Exclude<BundledSchemaName, 'system'>[] = ['core', 'cosine', 'inetorgperson']

/**
 * The bundled schemas as documents, by name. `system` (the operational attributes and the object classes of the
 * directory itself, whole by itself) is always loaded first; the others are loaded when asked for.
 */
export const BUNDLED: Readonly<Record<BundledSchemaName, SchemaDocument>> = {
    system: SYSTEM,
    core: CORE,
    cosine: COSINE,
    inetorgperson: INETORGPERSON,
    rfc2307bis: RFC2307BIS,
    'openssh-lpk': OPENSSH_LPK,
    ppolicy: PPOLICY
}

/**
 * The bundled schemas a server loads when its options name none (core, cosine, inetorgperson), to complete in the
 * `schema` of `createLDAPServer()`
 * @example
 * ```typescript
 * import {createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'
 * import {DEFAULTS, RFC2307BIS} from '@lakutata/ldap-engine/schemas'
 *
 * //The POSIX accounts and groups besides the default schemas, for SSSD
 * const server = createLDAPServer({backends: [new MemoryBackend('dc=example,dc=com')], schema: [...DEFAULTS, RFC2307BIS]})
 * ```
 */
export const DEFAULTS: readonly SchemaDocument[] = DEFAULT_NAMES.map((name: Exclude<BundledSchemaName, 'system'>): SchemaDocument => BUNDLED[name])

/**
 * A schema with bundled schemas loaded: `system` always, then those asked for (core, cosine and inetorgperson by
 * default, as a server), in their order
 * @param names The schemas besides `system`.
 * @example
 * ```typescript
 * import {type Schema} from '@lakutata/ldap-engine'
 * import {BUNDLED_NAMES, bundledSchema} from '@lakutata/ldap-engine/schemas'
 *
 * const schema: Schema = bundledSchema()
 * console.log(schema.attributesOf(['inetOrgPerson']).must)
 * const everything: Schema = bundledSchema(BUNDLED_NAMES)
 * console.log(everything.objectClass('posixAccount')?.must)
 * ```
 */
export function bundledSchema(names: readonly BundledSchemaName[] = DEFAULT_NAMES): Schema {
    const schema: Schema = new Schema().load(SYSTEM, 'the bundled schema system')
    for (const name of BUNDLED_NAMES.filter((item: BundledSchemaName): boolean => names.includes(item))) schema.load(BUNDLED[name], `the bundled schema ${name}`)
    return schema
}
