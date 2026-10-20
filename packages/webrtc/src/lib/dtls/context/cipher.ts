import {type KeyObject, sign} from 'node:crypto'
import {binaryData} from '../imports/common.js'

import {
    type CipherSuites,
    CurveType,
    type NamedCurveAlgorithms,
    SignatureAlgorithm,
    type SignatureHash
} from '../cipher/const.js'
import type {NamedCurveKeyPair} from '../cipher/namedCurve.js'
import {certificateDer, createDtlsCertificate, privateKeyFromPem} from '../cipher/x509.js'
import {prfVerifyDataClient, prfVerifyDataServer} from '../cipher/prf.js'
import {SessionType, type SessionTypes} from '../cipher/suites/abstract.js'
import type AEADCipher from '../cipher/suites/aead.js'
import type {DtlsRandom} from '../handshake/random.js'
import type {DtlsPlaintext} from '../record/message/plaintext.js'

const {encode, types} = binaryData

export class CipherContext {
    localRandom!: DtlsRandom
    remoteRandom!: DtlsRandom
    cipherSuite!: CipherSuites
    remoteCertificate?: Buffer
    remoteKeyPair!: Partial<NamedCurveKeyPair>
    localKeyPair!: NamedCurveKeyPair
    masterSecret!: Buffer
    cipher!: AEADCipher
    namedCurve!: NamedCurveAlgorithms
    signatureHashAlgorithm?: SignatureHash
    localCert!: Buffer
    localPrivateKey!: KeyObject

    constructor(
        public sessionType: SessionTypes,
        public certPem?: string,
        public keyPem?: string,
        signatureHashAlgorithm?: SignatureHash
    ) {
        if (certPem && keyPem && signatureHashAlgorithm) {
            this.parseX509(certPem, keyPem, signatureHashAlgorithm)
        }
    }

    /**
   *
   * @param signatureHash
   * @param namedCurveAlgorithm necessary when use ecdsa
   */
    static createSelfSignedCertificateWithKey = async (
        signatureHash: SignatureHash,
        _namedCurveAlgorithm?: NamedCurveAlgorithms
    ) => {
    //The key of the certificate signs with ECDSA on P-256 or with RSA; the curve of the key exchange is negotiated apart
        const {certPem, keyPem} = createDtlsCertificate(
            signatureHash.signature === SignatureAlgorithm.rsa_1 ? 'rsa' : 'ecdsa'
        )
        return {certPem, keyPem, signatureHash}
    }

    encryptPacket(pkt: DtlsPlaintext) {
        const header = pkt.recordLayerHeader
        const version =
            (header.protocolVersion.major << 8) | header.protocolVersion.minor
        const enc = this.cipher.encrypt(this.sessionType, pkt.fragment, {
            type: header.contentType,
            version,
            epoch: header.epoch,
            sequenceNumber: header.sequenceNumber
        })
        pkt.fragment = enc
        pkt.recordLayerHeader.contentLen = enc.length
        return pkt
    }

    decryptPacket(pkt: DtlsPlaintext) {
        const header = pkt.recordLayerHeader
        const version =
            (header.protocolVersion.major << 8) | header.protocolVersion.minor
        const dec = this.cipher.decrypt(this.sessionType, pkt.fragment, {
            type: header.contentType,
            version,
            epoch: header.epoch,
            sequenceNumber: header.sequenceNumber
        })
        return dec
    }

    verifyData(buf: Buffer) {
        if (this.sessionType === SessionType.CLIENT)
            return prfVerifyDataClient(this.masterSecret, buf)
        else return prfVerifyDataServer(this.masterSecret, buf)
    }

    signatureData(data: Buffer, hash: string) {
        return sign(hash, data, this.localPrivateKey)
    }

    generateKeySignature(hashAlgorithm: string) {
        const clientRandom =
            this.sessionType === SessionType.CLIENT
                ? this.localRandom
                : this.remoteRandom
        const serverRandom =
            this.sessionType === SessionType.SERVER
                ? this.localRandom
                : this.remoteRandom

        const sig = this.valueKeySignature(
            clientRandom.serialize(),
            serverRandom.serialize(),
            this.localKeyPair.publicKey,
            this.namedCurve
        )

        return sign(hashAlgorithm, sig, this.localPrivateKey)
    }

    parseX509(certPem: string, keyPem: string, signatureHash: SignatureHash) {
        this.localCert = certificateDer(certPem)
        this.localPrivateKey = privateKeyFromPem(keyPem)
        this.signatureHashAlgorithm = signatureHash
    }

    private valueKeySignature(
        clientRandom: Buffer,
        serverRandom: Buffer,
        publicKey: Buffer,
        namedCurve: number
    ) {
        const serverParams = encode(
            {
                type: CurveType.named_curve_3,
                curve: namedCurve,
                len: publicKey.length
            },
            {type: types.uint8, curve: types.uint16be, len: types.uint8}
        )
        return Buffer.concat([clientRandom, serverRandom, serverParams, publicKey])
    }
}
