import {Schema} from '../Schema.js'
import {CORE_SCHEMA} from './core.js'
import {COSINE_SCHEMA} from './cosine.js'
import {EXTENSIONS_SCHEMA} from './extensions.js'
import {INETORGPERSON_SCHEMA} from './inetorgperson.js'
import {SYSTEM_SCHEMA} from './system.js'

/**
 * The names of the schema files bundled with the engine, in the order they load
 */
export type BundledSchemaName = 'system' | 'core' | 'cosine' | 'inetorgperson'

/**
 * The texts of the bundled schema files, as subschema entries in LDIF, by name; `system` includes the operational
 * attributes the engine gives
 */
export const BUNDLED_SCHEMAS: Readonly<Record<BundledSchemaName, string>> = {
    system: SYSTEM_SCHEMA + '\n' + EXTENSIONS_SCHEMA,
    core: CORE_SCHEMA,
    cosine: COSINE_SCHEMA,
    inetorgperson: INETORGPERSON_SCHEMA
}

/**
 * A schema with the bundled files loaded: the system schema always, then the others asked for (all of them by
 * default), in their order; parsed when called, not when the module loads
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
export function bundledSchema(names: BundledSchemaName[] = ['core', 'cosine', 'inetorgperson']): Schema {
    const schema: Schema = new Schema()
    schema.load(SYSTEM_SCHEMA, 'the bundled schema system (RFC 4512 and others)')
    schema.load(EXTENSIONS_SCHEMA, 'the bundled schema system (X.501)')
    for (const name of (['core', 'cosine', 'inetorgperson'] as const).filter((item: BundledSchemaName): boolean => names.includes(item))) schema.load(BUNDLED_SCHEMAS[name], `the bundled schema ${name}`)
    return schema
}
