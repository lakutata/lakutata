import {NamedCurveAlgorithm, type NamedCurveAlgorithms} from './const.js'
import {p256Keypair, x25519Keypair} from './ec.js'

export interface NamedCurveKeyPair {
    curve: NamedCurveAlgorithms
    publicKey: Buffer
    privateKey: Buffer
}

export function generateKeyPair(
    namedCurve: NamedCurveAlgorithms
): NamedCurveKeyPair {
    switch (namedCurve) {
        case NamedCurveAlgorithm.secp256r1_23: {
            const {privateKey, publicKey} = p256Keypair()

            return {
                curve: namedCurve,
                privateKey,
                publicKey
            }
        }
        case NamedCurveAlgorithm.x25519_29: {
            const {privateKey, publicKey} = x25519Keypair()

            return {
                curve: namedCurve,
                privateKey,
                publicKey
            }
        }
        default:
            throw new Error()
    }
}
