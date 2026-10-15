import * as bson from "bson"
import * as mingo from "mingo"
import type { MessagePort } from "worker_threads"
import { parentPort, workerData } from "worker_threads"
import { TypeORMError } from "../../error/TypeORMError"
import { EmbeddedClient } from "./EmbeddedClient"
import type { EmbeddedDocument } from "./EmbeddedValues"
import type {
    EmbeddedReply,
    EmbeddedRequest,
    EmbeddedWorkerData,
} from "./EmbeddedWorkerProtocol"
import {
    COLLECTION_METHODS,
    DB_METHODS,
    describeError,
    REPLY_BATCH,
    SERIALIZE_OPTIONS,
    WORKER_DATA_KEY,
} from "./EmbeddedWorkerProtocol"

/**
 * lakutata: yields the event loop.
 */
function yieldLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve))
}

/**
 * lakutata: the documents of a find or an aggregation in batches of BSON, the event loop yielded between them.
 *
 * @param documents
 */
async function batchesOf(documents: EmbeddedDocument[]): Promise<Uint8Array[]> {
    const batches: Uint8Array[] = []
    for (let start = 0; start < documents.length; start += REPLY_BATCH) {
        if (start) await yieldLoop()
        batches.push(
            bson.serialize(
                { documents: documents.slice(start, start + REPLY_BATCH) },
                SERIALIZE_OPTIONS,
            ),
        )
    }
    return batches
}

/**
 * lakutata: the reply of the worker thread to a call of the main thread.
 *
 * @param client
 * @param request
 */
async function handle(
    client: EmbeddedClient,
    request: EmbeddedRequest,
): Promise<EmbeddedReply> {
    const call: EmbeddedDocument = request.payload
        ? bson.deserialize(request.payload)
        : {}
    switch (request.op) {
        case "collection": {
            if (!COLLECTION_METHODS.has(call.method))
                throw new TypeORMError(
                    `${call.method} is not a method of the collections of mongo-embedded`,
                )
            const collection: any = client.db().collection(call.collection)
            const result = await collection[call.method](...call.args)
            return {
                id: request.id,
                payload: bson.serialize({ result: result }, SERIALIZE_OPTIONS),
            }
        }
        case "db": {
            if (!DB_METHODS.has(call.method))
                throw new TypeORMError(
                    `${call.method} is not a method of the databases of mongo-embedded`,
                )
            const db: any = client.db()
            const result = await db[call.method](...call.args)
            return {
                id: request.id,
                payload: bson.serialize({ result: result }, SERIALIZE_OPTIONS),
            }
        }
        case "find": {
            const cursor = client
                .db()
                .collection(call.collection)
                .find(call.query ?? {})
            if (call.projection) cursor.project(call.projection)
            if (call.sort) cursor.sort(call.sort)
            if (call.skip !== undefined) cursor.skip(call.skip)
            if (call.limit !== undefined) cursor.limit(call.limit)
            return {
                id: request.id,
                batches: await batchesOf(await cursor.toArray()),
            }
        }
        case "aggregate":
            return {
                id: request.id,
                batches: await batchesOf(
                    await client
                        .db()
                        .collection(call.collection)
                        .aggregate(call.pipeline, call.options ?? undefined)
                        .toArray(),
                ),
            }
        case "close":
            await client.close()
            return { id: request.id }
    }
}

/**
 * lakutata: the worker thread of an embedded MongoDB (the option worker): it opens the database, replies to its
 * opening (the id 0), then to the calls of the client of the main thread (EmbeddedWorkerClient), their arguments and
 * their results in BSON. Its code is bundled with mingo and bson (EmbeddedWorkerCode), from which the main thread
 * starts it.
 *
 * @param port
 * @param data
 */
export async function startEmbeddedWorker(
    port: MessagePort,
    data: EmbeddedWorkerData,
): Promise<void> {
    let client: EmbeddedClient
    try {
        client = await EmbeddedClient.connect(
            data.directory,
            data.options,
            mingo,
            bson,
        )
    } catch (error) {
        port.postMessage({ id: 0, error: describeError(bson, error) })
        return
    }
    port.on("message", (request: EmbeddedRequest) => {
        handle(client, request).then(
            (reply) => port.postMessage(reply),
            (error) =>
                port.postMessage({
                    id: request.id,
                    error: describeError(bson, error),
                }),
        )
    })
    port.postMessage({ id: 0 })
}

if (parentPort && workerData?.[WORKER_DATA_KEY])
    void startEmbeddedWorker(parentPort, workerData[WORKER_DATA_KEY])
