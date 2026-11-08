import {Schema} from '../Schema.js'
import {CORE_SCHEMA} from './core.js'
import {COSINE_SCHEMA} from './cosine.js'
import {EXTENSIONS_SCHEMA} from './extensions.js'
import {INETORGPERSON_SCHEMA} from './inetorgperson.js'
import {OPENSSH_LPK_SCHEMA} from './opensshLpk.js'
import {PPOLICY_SCHEMA} from './ppolicy.js'
import {RFC2307BIS_SCHEMA} from './rfc2307bis.js'
import {SYSTEM_SCHEMA} from './system.js'

/**
 * The names of the schema files bundled with the engine, in the order they load
 */
export type BundledSchemaName = 'system' | 'core' | 'cosine' | 'inetorgperson' | 'rfc2307bis' | 'openssh-lpk' | 'ppolicy'

/**
 * The bundled schema files besides `system`, in the order they load
 */
export const BUNDLED_SCHEMA_NAMES: readonly Exclude<BundledSchemaName, 'system'>[] = ['core', 'cosine', 'inetorgperson', 'rfc2307bis', 'openssh-lpk', 'ppolicy']

/**
 * The texts of the bundled schema files, as subschema entries in LDIF, by name; `system` includes the operational
 * attributes the engine gives. core, cosine and inetorgperson are those of the RFCs, rfc2307bis the POSIX accounts and
 * groups of the name services, openssh-lpk the SSH public keys, ppolicy the password policy.
 */
export const BUNDLED_SCHEMAS: Readonly<Record<BundledSchemaName, string>> = {
    system: SYSTEM_SCHEMA + '\n' + EXTENSIONS_SCHEMA,
    core: CORE_SCHEMA,
    cosine: COSINE_SCHEMA,
    inetorgperson: INETORGPERSON_SCHEMA,
    rfc2307bis: RFC2307BIS_SCHEMA,
    'openssh-lpk': OPENSSH_LPK_SCHEMA,
    ppolicy: PPOLICY_SCHEMA
}

/**
 * A schema with the bundled files loaded: the system schema always, then the others asked for (all of them by
 * default: core, cosine, inetorgperson, rfc2307bis, openssh-lpk, ppolicy), in their order; parsed when called, not when
 * the module loads
 * @param names The files besides `system`.
 * @example
 * ```typescript
 * import {bundledSchema, type Schema} from '@lakutata/ldap-engine'
 *
 * const schema: Schema = bundledSchema()
 * console.log(schema.attributesOf(['inetOrgPerson']).must)
 * const minimal: Schema = bundledSchema(['core'])
 * console.log(minimal.objectClass('inetOrgPerson'))
 * ```
 */
export function bundledSchema(names: readonly BundledSchemaName[] = BUNDLED_SCHEMA_NAMES): Schema {
    const schema: Schema = new Schema()
    schema.load(SYSTEM_SCHEMA, 'the bundled schema system (RFC 4512 and others)')
    schema.load(EXTENSIONS_SCHEMA, 'the bundled schema system (X.501)')
    for (const name of BUNDLED_SCHEMA_NAMES.filter((item: BundledSchemaName): boolean => names.includes(item))) schema.load(BUNDLED_SCHEMAS[name], `the bundled schema ${name}`)
    return schema
}
