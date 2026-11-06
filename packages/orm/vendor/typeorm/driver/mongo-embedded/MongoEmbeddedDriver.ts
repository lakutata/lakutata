import { DriverPackageNotInstalledError } from "../../error/DriverPackageNotInstalledError"
import { TypeORMError } from "../../error/TypeORMError"
import { requireDriverPackage } from "../../platform/DriverPackages"
import { ObjectUtils } from "../../util/ObjectUtils"
import { MongoDriver } from "../mongodb/MongoDriver"
import type { ReplicationMode } from "../types/ReplicationMode"
import type { ReturningType } from "../types/ReturningType"
import type { MongoEmbeddedDataSourceOptions } from "./MongoEmbeddedDataSourceOptions"
import { MongoEmbeddedQueryRunner } from "./MongoEmbeddedQueryRunner"

/**
 * lakutata: the options of mongo-embedded removed with its native storage (the package @lakutata/mongo-embedded):
 * given, they fail the connection.
 */
const REMOVED_OPTIONS: { [option: string]: string } = {
    compaction:
        "the file of a database reuses the pages freed, without compaction",
    snapshot: "the indexes are stored in the file of the database",
    worker: "the database runs on a thread of its own in its native addon",
    workerResourceLimits:
        "the database runs on a thread of its own in its native addon",
}

/**
 * lakutata: the driver of an embedded MongoDB. It is the driver of MongoDB, its query runner, entity manager and
 * repositories, with the client of the package @lakutata/mongo-embedded, of the same API, holding the collections in
 * the process (stored by SQLite in a native addon, queried and updated by mingo).
 */
export class MongoEmbeddedDriver extends MongoDriver {
    /**
     * The package of the embedded client (@lakutata/mongo-embedded).
     */
    embedded: { EmbeddedClient: any; ObjectId: any }

    /**
     * Opens the database: its directory created and locked, or in memory.
     */
    async connect(): Promise<void> {
        const options = this.options as unknown as MongoEmbeddedDataSourceOptions &
            Record<string, unknown>
        for (const option of Object.keys(REMOVED_OPTIONS))
            if (options[option] !== undefined)
                throw new TypeORMError(
                    `The option ${option} of mongo-embedded is removed (${REMOVED_OPTIONS[option]}): remove it from the options of the data source`,
                )
        const client = await this.embedded.EmbeddedClient.connect(
            options.database,
            {
                sync: options.sync,
                syncInterval: options.syncInterval,
                cacheSize: options.cacheSize,
                mmapSize: options.mmapSize,
            },
        )
        this.queryRunner = new MongoEmbeddedQueryRunner(
            this.dataSource,
            client as any,
        )
        ObjectUtils.assign(this.queryRunner, {
            manager: this.dataSource.manager,
        })
    }

    /**
     * A query runner of its own, on the client of the data source: its transactions are the ones of a session of the
     * client (the one of the data source keeps none).
     *
     * @param mode
     */
    createQueryRunner(mode: ReplicationMode) {
        void mode
        return new MongoEmbeddedQueryRunner(
            this.dataSource,
            this.queryRunner!.databaseConnection,
        )
    }


    /**
     * Whether the persistence of the entities may insert them together: the embedded client inserts the documents of a
     * save with one insertMany (in batches of 1000 documents, each one written as one operation: a failure leaves the
     * batches before it written), and gives their _id in their order. The query builders, which the other uses of the
     * returning statements are, are not supported by MongoDB.
     *
     * @param returningType
     */
    isReturningSqlSupported(returningType?: ReturningType): boolean {
        return returningType === "insert"
    }

    /**
     * Loads the package @lakutata/mongo-embedded; the ObjectId of the entity manager is the one of its bson.
     */
    protected loadDependencies(): any {
        try {
            this.embedded = requireDriverPackage("@lakutata/mongo-embedded")
        } catch {
            throw new DriverPackageNotInstalledError(
                "MongoDB (embedded)",
                "@lakutata/mongo-embedded",
            )
        }
        this.mongodb = { ObjectId: this.embedded.ObjectId }
    }
}
