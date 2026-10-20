import {describe, test, expect} from '../../../support/vitest.js'
import {SrtcpContext} from '../../../../../lib/rtp/srtp/context/srtcp.js'
import {SrtpAuthenticationError} from '../../../../../lib/rtp/srtp/error.js'

const rtcpTestMasterKey = Buffer.from([
    0xfd, 0xa6, 0x25, 0x95, 0xd7, 0xf6, 0x92, 0x6f, 0x7d, 0x9c, 0x02, 0x4c, 0xc9,
    0x20, 0x9f, 0x34
])
const rtcpTestMasterSalt = Buffer.from([
    0xa9, 0x65, 0x19, 0x85, 0x54, 0x0b, 0x47, 0xbe, 0x2f, 0x27, 0xa8, 0xb8, 0x81,
    0x23
])

const rtcpTestEncrypted = Buffer.from([
    0x80, 0xc8, 0x00, 0x06, 0x66, 0xef, 0x91, 0xff, 0xcd, 0x34, 0xc5, 0x78, 0xb2,
    0x8b, 0xe1, 0x6b, 0xc5, 0x09, 0xd5, 0x77, 0xe4, 0xce, 0x5f, 0x20, 0x80, 0x21,
    0xbd, 0x66, 0x74, 0x65, 0xe9, 0x5f, 0x49, 0xe5, 0xf5, 0xc0, 0x68, 0x4e, 0xe5,
    0x6a, 0x78, 0x07, 0x75, 0x46, 0xed, 0x90, 0xf6, 0xdc, 0x9d, 0xef, 0x3b, 0xdf,
    0xf2, 0x79, 0xa9, 0xd8, 0x80, 0x00, 0x00, 0x01, 0x60, 0xc0, 0xae, 0xb5, 0x6f,
    0x40, 0x88, 0x0e, 0x28, 0xba
])
const rtcpTestDecrypted = Buffer.from([
    0x80, 0xc8, 0x00, 0x06, 0x66, 0xef, 0x91, 0xff, 0xdf, 0x48, 0x80, 0xdd, 0x61,
    0xa6, 0x2e, 0xd3, 0xd8, 0xbc, 0xde, 0xbe, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00,
    0x16, 0x04, 0x81, 0xca, 0x00, 0x06, 0x66, 0xef, 0x91, 0xff, 0x01, 0x10, 0x52,
    0x6e, 0x54, 0x35, 0x43, 0x6d, 0x4a, 0x68, 0x7a, 0x79, 0x65, 0x74, 0x41, 0x78,
    0x77, 0x2b, 0x00, 0x00
])

describe('srtp/context/srtcp', () => {
    function tamper(buffer: Buffer, index: number, mask = 0x01) {
        const tampered = Buffer.from(buffer)
        tampered[index] ^= mask
        return tampered
    }

    test('TestRTCPLifecycle', () => {
        const encryptContext = new SrtcpContext(
            rtcpTestMasterKey,
            rtcpTestMasterSalt,
            1
        )
        const decryptContext = new SrtcpContext(
            rtcpTestMasterKey,
            rtcpTestMasterSalt,
            1
        )

        const [decryptResult] = decryptContext.decryptRTCP(rtcpTestEncrypted)
        expect(decryptResult).toEqual(rtcpTestDecrypted)

        const encryptResult = encryptContext.encryptRTCP(rtcpTestDecrypted)
        expect(encryptResult).toEqual(rtcpTestEncrypted)
    })

    test('TestRTCPLifecycleInPlace', () => {
        const decryptContext = new SrtcpContext(
            rtcpTestMasterKey,
            rtcpTestMasterSalt,
            1
        )

        const decryptInput = Buffer.from(rtcpTestEncrypted)
        const [actualDecrypted, decryptHeader] =
            decryptContext.decryptRTCP(decryptInput)
        expect(decryptHeader.type).toBe(200)
        expect(actualDecrypted).toEqual(rtcpTestDecrypted)
    })

    test('Rejects tampered SRTCP auth tag', () => {
        const decryptContext = new SrtcpContext(
            rtcpTestMasterKey,
            rtcpTestMasterSalt,
            1
        )

        expect(() =>
            decryptContext.decryptRTCP(
                tamper(rtcpTestEncrypted, rtcpTestEncrypted.length - 1)
            )
        ).toThrowError(SrtpAuthenticationError)
    })

    test('Rejects tampered SRTCP encryption flag before decrypting', () => {
        const decryptContext = new SrtcpContext(
            rtcpTestMasterKey,
            rtcpTestMasterSalt,
            1
        )
        const eBitOffset = rtcpTestEncrypted.length - 14
        const tamperedEncryptionFlag = Buffer.from(rtcpTestEncrypted)
        tamperedEncryptionFlag[eBitOffset] &= 0x7f

        expect(() =>
            decryptContext.decryptRTCP(tamperedEncryptionFlag)
        ).toThrowError(SrtpAuthenticationError)

        const [decrypted] = decryptContext.decryptRTCP(rtcpTestEncrypted)
        expect(decrypted).toEqual(rtcpTestDecrypted)
    })

    test('Rejects tampered SRTCP index', () => {
        const decryptContext = new SrtcpContext(
            rtcpTestMasterKey,
            rtcpTestMasterSalt,
            1
        )

        expect(() =>
            decryptContext.decryptRTCP(
                tamper(rtcpTestEncrypted, rtcpTestEncrypted.length - 12)
            )
        ).toThrowError(SrtpAuthenticationError)
    })

    test('Rejects short SRTCP packet as authentication failure', () => {
        const decryptContext = new SrtcpContext(
            rtcpTestMasterKey,
            rtcpTestMasterSalt,
            1
        )

        expect(() =>
            decryptContext.decryptRTCP(Buffer.from([0x80, 0xc8]))
        ).toThrowError(SrtpAuthenticationError)
    })
})
