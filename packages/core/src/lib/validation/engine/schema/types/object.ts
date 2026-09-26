/**
 * Derived from the upstream lib/types/object.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import Keys, {type KeysSchema} from './keys.js'

/**
 * The object schema: keys, cast to a map
 */
export type ObjectSchema = KeysSchema

const ObjectType: ObjectSchema = Keys.extend<ObjectSchema>({

    type: 'object',

    cast: {
        map: {
            from: (value: unknown): unknown => value && typeof value === 'object',
            to(value: unknown): Map<string, unknown> {
                return new Map(Object.entries(value as object))
            }
        }
    }
})

export default ObjectType
