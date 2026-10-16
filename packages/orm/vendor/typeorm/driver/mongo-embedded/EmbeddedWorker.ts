import * as bson from "bson"
import * as mingo from "mingo"
import type { MessagePort } from "worker_threads"
import { parentPort, workerData } from "worker_threads"
import { TypeORMError } from "../../error/TypeORMError"
import { EmbeddedClient } from "./EmbeddedClient"
import { SCAN_TIMEOUT } from "./EmbeddedCollectionStore"
import type { EmbeddedDocument } from "./EmbeddedValues"
import type {
    EmbeddedReply,
    EmbeddedRequest,
    EmbeddedWorkerData,
} from "./EmbeddedWorkerProtocol"
import {
    COLLECTION_METHODS,
    DB_METHODS,
    decodeDocuments,
    describeError,
    encode,
    encodeDocuments,
    REPLY_BATCH,
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
            encodeDocuments(bson, documents.slice(start, start + REPLY_BATCH)),
        )
    }
    return batches
}

/**
 * lakutata: a cursor of the worker thread read a batch at a time, closed when it is not read for SCAN_TIMEOUT (as
 * MongoDB closes them).
 */
interface Cursor {
    batches: AsyncIterator<EmbeddedDocument[]>
    timer?: ReturnType<typeof setTimeout>
}

const cursors = new Map<number, Cursor>()

let nextCursor = 1

/**
 * lakutata: closes a cursor of the worker thread.
 *
 * @param id
 */
function kill(id: number): void {
    const cursor = cursors.get(id)
    if (!cursor) return
    cursors.delete(id)
    clearTimeout(cursor.timer)
    void cursor.batches.return?.()?.catch(() => {})
}

/**
 * lakutata: the next batch of a cursor of the worker thread, the cursor closed at its end.
 *
 * @param id
 * @param request
 */
async function more(id: number, request: EmbeddedRequest): Promise<EmbeddedReply> {
    const cursor = cursors.get(id)
    if (!cursor)
        throw new TypeORMError(
            `The cursor of mongo-embedded is closed: it was not read for ${SCAN_TIMEOUT / 60000} minutes`,
        )
    clearTimeout(cursor.timer)
    let result: IteratorResult<EmbeddedDocument[]>
    try {
        result = await cursor.batches.next()
    } catch (error) {
        kill(id)
        throw error
    }
    if (result.done) {
        kill(id)
        return { id: request.id, cursor: id, done: true, batches: [] }
    }
    cursor.timer = setTimeout(() => kill(id), SCAN_TIMEOUT)
    cursor.timer.unref?.()
    return {
        id: request.id,
        cursor: id,
        done: false,
        batches: [encodeDocuments(bson, result.value)],
    }
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
            const args = request.documents
                ? [decodeDocuments(bson, request.documents), ...call.args]
                : call.args
            const result = await collection[call.method](...args)
            return { id: request.id, payload: encode(bson, { result: result }) }
        }
        case "db": {
            if (!DB_METHODS.has(call.method))
                throw new TypeORMError(
                    `${call.method} is not a method of the databases of mongo-embedded`,
                )
            const db: any = client.db()
            const result = await db[call.method](...call.args)
            return { id: request.id, payload: encode(bson, { result: result }) }
        }
        case "find":
        case "open": {
            const cursor = client
                .db()
                .collection(call.collection)
                .find(call.query ?? {})
            if (call.projection) cursor.project(call.projection)
            if (call.sort) cursor.sort(call.sort)
            if (call.skip !== undefined) cursor.skip(call.skip)
            if (call.limit !== undefined) cursor.limit(call.limit)
            const batches = request.op === "open" && cursor.streamedBatches()
            if (!batches)
                return {
                    id: request.id,
                    batches: await batchesOf(await cursor.toArray()),
                }
            const id = nextCursor++
            cursors.set(id, { batches: batches })
            return more(id, request)
        }
        case "more":
            return more(call.cursor, request)
        case "kill":
            kill(call.cursor)
            return { id: request.id }
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
            data.token,
        )
    } catch (error) {
        port.postMessage({ id: 0, error: describeError(bson, error) })
        return
    }
    // The calls are handled as they come, not queued: as on the main thread (worker false), a call awaiting (a write
    // between its batches, a find) lets the next ones run, a close included; the replies are posted as the calls end,
    // in any order, the client matching them by their id
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
