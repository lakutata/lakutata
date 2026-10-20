import type {CipherGCMTypes} from 'node:crypto'
import type {KeyExchange} from '../key-exchange.js'

export type CipherHeader = {
    type: number
    version: number
    epoch: number
    sequenceNumber: number
}

export const SessionType = {
    CLIENT: 1,
    SERVER: 2
} as const
export type SessionTypes = (typeof SessionType)[keyof typeof SessionType]

export default abstract class AbstractCipher {
    id = 0
    name?: string
    hashAlgorithm?: string
    verifyDataLength = 12

    blockAlgorithm?: CipherGCMTypes
    kx?: KeyExchange

    /**
   * Init cipher.
   * @abstract
   */
    init(..._args: any) {
        throw new Error('not implemented')
    }

    /**
   * Encrypts data.
   * @abstract
   */
    encrypt(..._args: any): Buffer {
        throw new Error('not implemented')
    }

    /**
   * Decrypts data.
   * @abstract
   */
    decrypt(..._args: any): Buffer {
        throw new Error('not implemented')
    }

    /**
   * @returns {string}
   */
    toString() {
        return this.name
    }
}
