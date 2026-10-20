import {createECDH, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, type ECDH} from 'node:crypto'

/**
 * A key pair of P-256 for ECDHE: the private scalar (32 bytes) and the uncompressed public point (65 bytes)
 */
export const p256Keypair = (): {privateKey: Buffer, publicKey: Buffer} => {
    const ecdh: ECDH = createECDH('prime256v1')
    const publicKey: Buffer = ecdh.generateKeys()
    return {privateKey: ecdh.getPrivateKey(), publicKey}
}

/**
 * The premaster secret of ECDHE on P-256: the x coordinate of the shared point
 */
export const p256PreMasterSecret = ({publicKey, privateKey}: {publicKey: Buffer, privateKey: Buffer}): Buffer => {
    const ecdh: ECDH = createECDH('prime256v1')
    ecdh.setPrivateKey(privateKey)
    return ecdh.computeSecret(publicKey)
}

//The fixed DER prefixes of the X25519 keys (RFC 8410): the raw 32 bytes follow them
const x25519Pkcs8Prefix: Buffer = Buffer.from('302e020100300506032b656e04220420', 'hex')
const x25519SpkiPrefix: Buffer = Buffer.from('302a300506032b656e032100', 'hex')

/**
 * A key pair of X25519: both keys as their raw 32 bytes
 */
export const x25519Keypair = (): {privateKey: Buffer, publicKey: Buffer} => {
    const {privateKey, publicKey} = generateKeyPairSync('x25519')
    return {
        privateKey: privateKey.export({type: 'pkcs8', format: 'der'}).subarray(x25519Pkcs8Prefix.length),
        publicKey: publicKey.export({type: 'spki', format: 'der'}).subarray(x25519SpkiPrefix.length)
    }
}

/**
 * The premaster secret of X25519 from the raw keys
 */
export const x25519PreMasterSecret = ({publicKey, privateKey}: {publicKey: Buffer, privateKey: Buffer}): Buffer => diffieHellman({
    privateKey: createPrivateKey({key: Buffer.concat([x25519Pkcs8Prefix, privateKey]), format: 'der', type: 'pkcs8'}),
    publicKey: createPublicKey({key: Buffer.concat([x25519SpkiPrefix, publicKey]), format: 'der', type: 'spki'})
})
