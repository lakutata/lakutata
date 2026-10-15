import { DriverPackageNotInstalledError } from "../../error/DriverPackageNotInstalledError"
import { requireDriverPackage } from "../../platform/DriverPackages"
import { ObjectUtils } from "../../util/ObjectUtils"
import { MongoDriver } from "../mongodb/MongoDriver"
import { MongoQueryRunner } from "../mongodb/MongoQueryRunner"
import type { ReturningType } from "../types/ReturningType"
import { EmbeddedClient } from "./EmbeddedClient"
import type { EmbeddedStoreOptions } from "./EmbeddedStore"
import { EmbeddedWorkerClient } from "./EmbeddedWorkerClient"
import type { MongoEmbeddedDataSourceOptions } from "./MongoEmbeddedDataSourceOptions"

/**
 * lakutata: the driver of an embedded MongoDB. It is the driver of MongoDB, its query runner, entity manager and
 * repositories, with a client of the same API holding the collections in the process: in a worker thread (the option
 * worker, by default), or in the thread of the application.
 */
export class MongoEmbeddedDriver extends MongoDriver {
    /**
     * The packages of the embedded client: mingo (the semantics of MongoDB) and bson (its types).
     */
    embedded: { mingo: any; bson: any }

    /**
     * Opens the database: its files read when they exist, in a worker thread unless the option worker is false.
     */
    async connect(): Promise<void> {
        const options = this.options as unknown as MongoEmbeddedDataSourceOptions
        const storeOptions: EmbeddedStoreOptions = {
            sync: options.sync,
            syncInterval: options.syncInterval,
            cacheSize: options.cacheSize,
            compaction: options.compaction,
            snapshot: options.snapshot,
        }
        const client =
            options.worker === false
                ? await EmbeddedClient.connect(
                      options.database,
                      storeOptions,
                      this.embedded.mingo,
                      this.embedded.bson,
                  )
                : await EmbeddedWorkerClient.connect(
                      options.database,
                      storeOptions,
                      this.embedded.bson,
                      options.workerResourceLimits,
                  )
        this.queryRunner = new MongoQueryRunner(this.dataSource, client as any)
        ObjectUtils.assign(this.queryRunner, {
            manager: this.dataSource.manager,
        })
    }

    /**
     * Whether the persistence of the entities may insert them together: the embedded client inserts the documents of a
     * save in one insertMany (one write of its file), and gives their _id in their order. The query builders, which
     * the other uses of the returning statements are, are not supported by MongoDB.
     *
     * @param returningType
     */
    isReturningSqlSupported(returningType?: ReturningType): boolean {
        return returningType === "insert"
    }

    /**
     * Loads mingo and bson; the ObjectId of the entity manager is the one of bson.
     */
    protected loadDependencies(): any {
        const load = (packageName: string) => {
            try {
                return requireDriverPackage(packageName)
            } catch {
                throw new DriverPackageNotInstalledError(
                    "MongoDB (embedded)",
                    packageName,
                )
            }
        }
        const mingo = load("mingo")
        const bson = load("bson")
        this.embedded = { mingo, bson }
        this.mongodb = { ObjectId: bson.ObjectId }
    }
}
