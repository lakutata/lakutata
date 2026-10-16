import { DriverPackageNotInstalledError } from "../../error/DriverPackageNotInstalledError"
import { requireDriverPackage } from "../../platform/DriverPackages"
import type { ObjectId as BSONObjectId } from "../mongodb/bson.typings"

/**
 * lakutata: the class ObjectId of the package bson the drivers load (its CommonJS module, the module TypeORM requires),
 * or, without the package, a class whose construction tells it is not installed.
 */
function loadObjectId(): typeof BSONObjectId {
    try {
        return requireDriverPackage("bson").ObjectId
    } catch {
        return class ObjectId {
            constructor() {
                throw new DriverPackageNotInstalledError("bson", "bson")
            }
        } as unknown as typeof BSONObjectId
    }
}

/**
 * lakutata: the class ObjectId of the entities of the embedded MongoDB (`mongo-embedded`): the one of the CommonJS
 * module of the package bson, which its driver loads. The ObjectId of an `import {ObjectId} from 'bson'` in an ES module
 * is another class, of which the ids of the entities are not instances (`instanceof` is false); both are taken by the
 * queries. Without the package bson, constructing it throws.
 *
 * @example
 * import {ObjectId} from 'lakutata/orm'
 *
 * const post = await posts.findOneBy({_id: new ObjectId(id)})
 * console.log(post?.id instanceof ObjectId) // true
 */
export const ObjectId: typeof BSONObjectId = loadObjectId()

/**
 * lakutata: the type of the ids of the entities of MongoDB, the instances of {@link ObjectId}, to declare their
 * `@ObjectIdColumn()` properties (`public id: ObjectId`).
 */
export type ObjectId = BSONObjectId
