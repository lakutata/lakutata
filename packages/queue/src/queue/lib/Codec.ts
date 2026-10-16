import {MessagePack} from '@lakutata/utils'

/**
 * The encoding of the messages and the results of a {@link Queue}: both sides of a queue use the same one.
 */
export interface QueueCodec {
    /**
     * Encode a value (an object for a message).
     * @param value The value.
     * @returns Its bytes.
     */
    encode(value: unknown): Uint8Array

    /**
     * Decode bytes encoded by {@link QueueCodec.encode}.
     * @param bytes The bytes.
     * @returns The value.
     */
    decode(bytes: Uint8Array): unknown
}

/**
 * The MessagePack codec of the queues, the default `codec` of a {@link Queue}, the same as the default codec of
 * `@lakutata/nats`: the value is first normalized through JSON (`JSON.parse(JSON.stringify(value))`), so that the
 * services written in other languages read plain data. A `Date` arrives as its ISO string (an input DTO converts it
 * back, a result stays a string), a `Buffer` as `{type: 'Buffer', data: [...]}`, a class instance as a plain object,
 * `undefined` as `null` (dropped from the objects); a `bigint` or a circular value fails the encoding with a
 * `TypeError`.
 * @returns The codec.
 * @example
 * ```typescript
 * import {messagePackQueueCodec} from '@lakutata/queue'
 *
 * const codec = messagePackQueueCodec()
 * console.log(codec.decode(codec.encode({id: 7, at: new Date(0)}))) //{id: 7, at: '1970-01-01T00:00:00.000Z'}
 * ```
 */
export function messagePackQueueCodec(): QueueCodec {
    return {
        encode(value: unknown): Uint8Array {
            return MessagePack.encode(JSON.parse(JSON.stringify([value])))
        },
        decode(bytes: Uint8Array): unknown {
            const [value] = MessagePack.decode(bytes) as unknown[]
            return value
        }
    }
}

/**
 * The JSON codec of the queues (the UTF-8 bytes of the JSON text), for the services written in other languages: the
 * same normalization as {@link messagePackQueueCodec}.
 * @returns The codec.
 * @example
 * ```typescript
 * import {jsonQueueCodec} from '@lakutata/queue'
 *
 * const codec = jsonQueueCodec()
 * console.log(new TextDecoder().decode(codec.encode({id: 7}))) //{"id":7}
 * ```
 */
export function jsonQueueCodec(): QueueCodec {
    return {
        encode(value: unknown): Uint8Array {
            return new TextEncoder().encode(JSON.stringify(value === undefined ? null : value))
        },
        decode(bytes: Uint8Array): unknown {
            return JSON.parse(new TextDecoder().decode(bytes))
        }
    }
}
