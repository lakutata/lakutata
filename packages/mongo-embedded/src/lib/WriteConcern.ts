import {EmbeddedOperationError, EmbeddedWriteConcernError} from './Errors.js'
import {type EmbeddedDocument} from './Values.js'

/**
 * A write concern, as the client of MongoDB takes it: the acknowledgement of the write (w: a number of members, or
 * "majority"; 0 for none), its journal (j, or fsync: the write on the disk before it is acknowledged) and its time
 * limit (wtimeoutMS, without effect here). The database is a replica set of one member: w beyond 1 fails, once the
 * write is made, as MongoDB fails it (UnsatisfiableWriteConcern, 100); a name of a mode of tags as well
 * (UnknownReplWriteConcern, 79).
 *
 * @example
 * import {EmbeddedClient, type EmbeddedWriteConcern} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect('./data/documents')
 * const durable: EmbeddedWriteConcern = {w: 'majority', j: true}
 * await client.db().collection('orders').insertOne({total: 12}, {writeConcern: durable})
 * await client.close()
 */
export interface EmbeddedWriteConcern {
    /**
     * The acknowledgement of the write: 1 (the default), "majority", 0 for none (the write given no result, its errors
     * not told)
     */
    w?: number | string | boolean

    /**
     * Whether the write is on the disk before it is acknowledged (as the option sync "always" makes each write)
     */
    j?: boolean

    /**
     * The same as j
     */
    fsync?: boolean

    /**
     * The time limit of the acknowledgement, in milliseconds: kept, without effect
     */
    wtimeoutMS?: number
}

/**
 * The write concern an operation is given (its option writeConcern, or the legacy options w, j, fsync and wtimeoutMS),
 * the one inherited (of the collection, of the database, of the client) otherwise; undefined when none is
 *
 * @param options the options of the operation
 * @param inherited
 */
export function writeConcernOf(options: EmbeddedDocument | undefined, inherited?: EmbeddedWriteConcern): EmbeddedWriteConcern | undefined {
    if (options?.writeConcern !== undefined && options.writeConcern !== null) return options.writeConcern
    if (options && ['w', 'j', 'fsync', 'wtimeoutMS', 'wtimeout'].some((option: string): boolean => options[option] !== undefined))
        return {w: options.w, j: options.j, fsync: options.fsync, wtimeoutMS: options.wtimeoutMS ?? options.wtimeout}
    return inherited
}

/**
 * The number of members of a write concern (w): a number, a name ("majority", a mode of tags), undefined for the
 * default; booleans as 1 and 0
 *
 * @param concern
 */
function membersOf(concern: EmbeddedWriteConcern): number | string | undefined {
    return typeof concern.w === 'boolean' ? (concern.w ? 1 : 0) : concern.w
}

/**
 * A write concern checked as MongoDB parses it, before the write: w a number from 0 to 50 or a name (FailedToParse 9),
 * j a boolean or a number (TypeMismatch 14)
 *
 * @param concern
 */
export function checkWriteConcern(concern: EmbeddedWriteConcern): void {
    const w: unknown = membersOf(concern)
    if (typeof w === 'number' && !(w >= 0 && w <= 50))
        throw new EmbeddedOperationError(9, 'FailedToParse', `w has to be a non-negative number and not greater than 50; found: ${w}`)
    if (w !== undefined && w !== null && typeof w !== 'number' && typeof w !== 'string')
        throw new EmbeddedOperationError(9, 'FailedToParse', typeof w === 'object' && !Object.keys(w).length ? 'tagged write concern requires tags' : 'w has to be a number or a string')
    for (const option of ['j', 'fsync'] as const) {
        const value: unknown = concern[option]
        if (value !== undefined && value !== null && typeof value !== 'boolean' && typeof value !== 'number')
            throw new EmbeddedOperationError(14, 'TypeMismatch', `BSON field 'WriteConcernOptions.${option}' is the wrong type '${typeof value}', expected types '[decimal, double, bool, long, int']`)
    }
}

/**
 * Whether a write concern does not acknowledge its write (w 0)
 *
 * @param concern
 */
export function unacknowledged(concern?: EmbeddedWriteConcern): boolean {
    return !!concern && membersOf(concern) === 0
}

/**
 * Whether a write concern asks its write on the disk (j, fsync)
 *
 * @param concern
 */
export function journaled(concern?: EmbeddedWriteConcern): boolean {
    return !!concern && (!!concern.j || !!concern.fsync)
}

/**
 * The error of a write concern a replica set of one member cannot satisfy, once its write is made: more members than
 * one (UnsatisfiableWriteConcern 100), a mode of tags (UnknownReplWriteConcern 79); undefined when it is satisfied
 *
 * @param concern
 * @param wtimeout the time limit told when none is given (10000 for the commit of a transaction)
 */
export function writeConcernFailure(concern: EmbeddedWriteConcern | undefined, wtimeout: number = 0): EmbeddedWriteConcernError | undefined {
    if (!concern) return undefined
    const w: number | string | undefined = membersOf(concern)
    const errInfo: Record<string, unknown> = {
        writeConcern: {
            w: w,
            ...(journaled(concern) ? {j: true} : {}),
            wtimeout: concern.wtimeoutMS ?? wtimeout,
            provenance: 'clientSupplied'
        }
    }
    if (typeof w === 'number' && w > 1) return new EmbeddedWriteConcernError(100, 'UnsatisfiableWriteConcern', 'Not enough data-bearing nodes', errInfo)
    if (typeof w === 'string' && w !== 'majority')
        return new EmbeddedWriteConcernError(79, 'UnknownReplWriteConcern', `No write concern mode named '${w}' found in replica set configuration`, errInfo)
    return undefined
}
