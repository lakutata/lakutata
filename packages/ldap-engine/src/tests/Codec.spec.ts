import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {BerReader, integer, integerContent, isUTF8, serialize} from '../lib/ber/Ber.js'
import {decodeMessage, encodeMessage, Filter, LDAPDecodeException, type LDAPMessage, MessageReader, type ProtocolOp, type ReadMessage} from '../exports/LDAPEngine.js'

/**
 * Encode and decode a message, checking it comes back the same
 * @param message The message.
 */
function roundTrip(message: LDAPMessage): LDAPMessage {
    const decoded: LDAPMessage = decodeMessage(encodeMessage(message))
    assert.deepEqual(decoded, message)
    return decoded
}

const OPERATIONS: ProtocolOp[] = [
    {type: 'bindRequest', version: 3, name: 'cn=admin,dc=example,dc=com', authentication: {type: 'simple', password: Buffer.from('secret')}},
    {type: 'bindRequest', version: 3, name: '', authentication: {type: 'sasl', mechanism: 'EXTERNAL'}},
    {type: 'bindRequest', version: 3, name: '', authentication: {type: 'sasl', mechanism: 'PLAIN', credentials: Buffer.from('\0alice\0secret')}},
    {type: 'bindResponse', resultCode: 14, matchedDN: '', diagnosticMessage: '', serverSaslCredentials: Buffer.from([1, 2, 3])},
    {type: 'bindResponse', resultCode: 10, matchedDN: '', diagnosticMessage: 'go there', referral: ['ldap://a.example.com/', 'ldap://b.example.com/']},
    {type: 'unbindRequest'},
    {
        type: 'searchRequest', baseObject: 'dc=example,dc=com', scope: 'sub', derefAliases: 'always', sizeLimit: 100, timeLimit: 30, typesOnly: true,
        filter: Filter.and(Filter.equal('objectClass', 'person'), Filter.not(Filter.present('mail'))), attributes: ['cn', '+', '1.1']
    },
    {type: 'searchRequest', baseObject: '', scope: 'base', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: Filter.present('objectClass'), attributes: []},
    {type: 'searchResultEntry', objectName: 'uid=alice,ou=people,dc=example,dc=com', attributes: [{type: 'cn', values: [Buffer.from('Alice'), Buffer.from('Alice Liu')]}, {type: 'jpegPhoto', values: [Buffer.from([0xff, 0xd8, 0xff])]}, {type: 'empty', values: []}]},
    {type: 'searchResultReference', uris: ['ldap://other.example.com/ou=x,dc=example,dc=com']},
    {type: 'searchResultDone', resultCode: 32, matchedDN: 'dc=example,dc=com', diagnosticMessage: 'no such object'},
    {type: 'modifyRequest', object: 'uid=alice,dc=example,dc=com', changes: [
        {operation: 'replace', modification: {type: 'mail', values: [Buffer.from('alice@example.com')]}},
        {operation: 'delete', modification: {type: 'description', values: []}},
        {operation: 'add', modification: {type: 'member', values: [Buffer.from('uid=bob')]}},
        {operation: 'increment', modification: {type: 'uidNumber', values: [Buffer.from('1')]}}
    ]},
    {type: 'modifyResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''},
    {type: 'addRequest', entry: 'cn=x,dc=example,dc=com', attributes: [{type: 'objectClass', values: [Buffer.from('top'), Buffer.from('device')]}, {type: 'cn', values: [Buffer.from('x')]}]},
    {type: 'addResponse', resultCode: 68, matchedDN: '', diagnosticMessage: 'exists'},
    {type: 'deleteRequest', entry: 'cn=x,dc=example,dc=com'},
    {type: 'deleteResponse', resultCode: 66, matchedDN: '', diagnosticMessage: ''},
    {type: 'modifyDNRequest', entry: 'cn=x,dc=example,dc=com', newRDN: 'cn=y', deleteOldRDN: true},
    {type: 'modifyDNRequest', entry: 'cn=x,dc=example,dc=com', newRDN: 'cn=y', deleteOldRDN: false, newSuperior: 'ou=z,dc=example,dc=com'},
    {type: 'modifyDNResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''},
    {type: 'compareRequest', entry: 'cn=x,dc=example,dc=com', attribute: 'cn', value: Buffer.from('x')},
    {type: 'compareResponse', resultCode: 6, matchedDN: '', diagnosticMessage: ''},
    {type: 'abandonRequest', messageId: 2147483647},
    {type: 'extendedRequest', name: '1.3.6.1.4.1.1466.20037'},
    {type: 'extendedRequest', name: '1.3.6.1.4.1.4203.1.11.1', value: Buffer.from([0x30, 0x00])},
    {type: 'extendedResponse', resultCode: 0, matchedDN: '', diagnosticMessage: '', value: Buffer.from('dn:cn=admin')},
    {type: 'extendedResponse', resultCode: 52, matchedDN: '', diagnosticMessage: 'shutting down', name: '1.3.6.1.4.1.1466.20036'},
    {type: 'intermediateResponse', name: '1.3.6.1.4.1.4203.1.9.1.4', value: Buffer.from([0xa2, 0x00])},
    {type: 'intermediateResponse'}
]

describe('the messages', () => {
    it('come back the same, every operation', () => {
        for (const [index, operation] of OPERATIONS.entries()) roundTrip({messageId: index + 1, protocolOp: operation})
    })

    it('keep their controls, critical or not, with a value or not', () => {
        roundTrip({
            messageId: 7,
            protocolOp: {type: 'deleteRequest', entry: 'ou=x'},
            controls: [{oid: '1.2.840.113556.1.4.805', critical: true}, {oid: '1.2.840.113556.1.4.319', critical: false, value: Buffer.from([0x30, 0x05, 0x02, 0x01, 0x05, 0x04, 0x00])}]
        })
    })

    it('encode an anonymous bind as RFC 4511 does', () => {
        const bytes: Buffer = encodeMessage({messageId: 1, protocolOp: {type: 'bindRequest', version: 3, name: '', authentication: {type: 'simple', password: Buffer.alloc(0)}}})
        assert.equal(bytes.toString('hex'), '300c020101600702010304008000')
    })

    it('encode a search request with an equality filter byte for byte', () => {
        const bytes: Buffer = encodeMessage({
            messageId: 2,
            protocolOp: {type: 'searchRequest', baseObject: 'o=a', scope: 'one', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: Filter.equal('cn', 'b'), attributes: ['cn']}
        })
        assert.equal(bytes.toString('hex'), '302802010263230403' + '6f3d61' + '0a0101' + '0a0100' + '020100' + '020100' + '010100' + 'a3070402636e040162' + '30040402636e')
    })

    it('keep a malformed DN as it is sent, for the server to answer it', () => {
        const message: LDAPMessage = roundTrip({
            messageId: 3,
            protocolOp: {type: 'searchRequest', baseObject: 'cn=a,=b', scope: 'base', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: Filter.present('objectClass'), attributes: []}
        })
        assert.equal(message.protocolOp.type === 'searchRequest' && message.protocolOp.baseObject, 'cn=a,=b')
    })

    it('read an authentication choice they do not support, for the server to refuse it', () => {
        const bytes: Buffer = Buffer.from('300f020101600a02010304008103414243', 'hex')
        const message: LDAPMessage = decodeMessage(bytes)
        assert.deepEqual(message.protocolOp, {type: 'bindRequest', version: 3, name: '', authentication: {type: 'other', tag: 0x81, value: Buffer.from('ABC')}})
    })

    it('ignore the elements after the known ones (extensions)', () => {
        //A delete response with an extra element
        const bytes: Buffer = Buffer.from('300f0201036b0a0a0100040004000401ff', 'hex')
        const fixed: Buffer = Buffer.from(bytes)
        fixed[1] = bytes.length - 2
        fixed[6] = bytes.length - 7
        assert.deepEqual(decodeMessage(fixed).protocolOp, {type: 'deleteResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''})
    })

    it('fail fatally without a message ID, or with an operation that is not one', () => {
        assert.throws(() => decodeMessage(Buffer.from('3003040100', 'hex')), (error: unknown) => error instanceof LDAPDecodeException && error.fatal && error.messageId === undefined)
        assert.throws(() => decodeMessage(Buffer.from('3005020105' + '5f00', 'hex')), (error: unknown) => error instanceof LDAPDecodeException && error.fatal)
        assert.throws(() => decodeMessage(Buffer.from('3005020105' + '7f00', 'hex')), (error: unknown) => error instanceof LDAPDecodeException && error.fatal)
    })

    it('fail without being fatal inside a known operation, with its message ID and its type', () => {
        //A search request whose scope is 7
        const good: Buffer = encodeMessage({
            messageId: 9,
            protocolOp: {type: 'searchRequest', baseObject: '', scope: 'base', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: Filter.present('a'), attributes: []}
        })
        const bad: Buffer = Buffer.from(good)
        const scope: number = bad.indexOf(Buffer.from([0x0a, 0x01, 0x00]))
        bad[scope + 2] = 7
        assert.throws(() => decodeMessage(bad), (error: unknown) => error instanceof LDAPDecodeException && !error.fatal && !error.malformed && error.messageId === 9 && error.operation === 'searchRequest')
    })

    it('tell a wrong encoding inside a known operation from a value that is not allowed', () => {
        const good: Buffer = encodeMessage({
            messageId: 6,
            protocolOp: {type: 'searchRequest', baseObject: '', scope: 'base', derefAliases: 'never', sizeLimit: 0, timeLimit: 0, typesOnly: false, filter: Filter.present('a'), attributes: []}
        })
        //typesOnly as an OCTET STRING, then as a BOOLEAN of two bytes
        const tag: Buffer = Buffer.from(good)
        tag[tag.indexOf(Buffer.from([0x01, 0x01, 0x00]))] = 0x04
        assert.throws(() => decodeMessage(tag), (error: unknown) => error instanceof LDAPDecodeException && !error.fatal && error.malformed && error.messageId === 6 && error.operation === 'searchRequest')
        const at: number = good.indexOf(Buffer.from([0x01, 0x01, 0x00]))
        const long: Buffer = Buffer.concat([good.subarray(0, at), Buffer.from([0x01, 0x02, 0x00, 0x00]), good.subarray(at + 3)])
        long[1]++
        long[long.indexOf(0x63) + 1]++
        assert.throws(() => decodeMessage(long), (error: unknown) => error instanceof LDAPDecodeException && error.malformed && /BOOLEAN/.test(error.message))
        //A filter of a kind that may come later (a context tag after [9]), a negative size limit: values
        const kind: Buffer = Buffer.from(good)
        kind[kind.indexOf(Buffer.from([0x87, 0x01]))] = 0x8a
        assert.throws(() => decodeMessage(kind), (error: unknown) => error instanceof LDAPDecodeException && !error.malformed && /unknown kind/.test(error.message))
        const limit: Buffer = Buffer.from(good)
        limit[limit.indexOf(Buffer.from([0x02, 0x01, 0x00])) + 2] = 0xff
        assert.throws(() => decodeMessage(limit), (error: unknown) => error instanceof LDAPDecodeException && !error.malformed && /negative/.test(error.message))
        //A known kind in another form, a tag of another class: the encoding
        for (const tag of [0xa7, 0x04]) {
            const other: Buffer = Buffer.from(good)
            other[other.indexOf(Buffer.from([0x87, 0x01]))] = tag
            assert.throws(() => decodeMessage(other), (error: unknown) => error instanceof LDAPDecodeException && error.malformed && /unknown kind/.test(error.message))
        }
        //A size limit of seven bytes, padded: the encoding (X.690 §8.3.2); not padded: a value
        for (const [bytes, malformed] of [[[0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05], true], [[0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05], false]] as const) {
            const at: number = good.indexOf(Buffer.from([0x02, 0x01, 0x00]))
            const wide: Buffer = Buffer.concat([good.subarray(0, at), Buffer.from([0x02, 0x07, ...bytes]), good.subarray(at + 3)])
            wide[1] += 6
            wide[wide.indexOf(0x63) + 1] += 6
            assert.throws(() => decodeMessage(wide), (error: unknown) => error instanceof LDAPDecodeException && error.malformed === malformed)
        }
        //A value that is not allowed, then an error of the encoding after it: the encoding
        const both: Buffer = Buffer.from(tag)
        both[both.indexOf(Buffer.from([0x0a, 0x01, 0x00])) + 2] = 7
        assert.throws(() => decodeMessage(both), (error: unknown) => error instanceof LDAPDecodeException && error.malformed && /scope/.test(error.message))
    })

    it('refuse a DN that is not UTF-8, without being fatal', () => {
        const good: Buffer = encodeMessage({messageId: 4, protocolOp: {type: 'deleteRequest', entry: 'cn=ab'}})
        const bad: Buffer = Buffer.from(good)
        bad[bad.length - 1] = 0xff
        assert.throws(() => decodeMessage(bad), (error: unknown) => error instanceof LDAPDecodeException && !error.fatal && !error.malformed && error.messageId === 4)
    })
})

describe('the integers', () => {
    it('take their minimal two\'s complement form', () => {
        const cases: [number, string][] = [[0, '00'], [1, '01'], [127, '7f'], [128, '0080'], [255, '00ff'], [256, '0100'], [-1, 'ff'], [-128, '80'], [-129, 'ff7f'], [2147483647, '7fffffff'], [-2147483648, '80000000']]
        for (const [value, hex] of cases) {
            assert.equal(integerContent(value).toString('hex'), hex)
            assert.equal(new BerReader(serialize(integer(value))).integer(), value)
        }
    })

    it('write long lengths with as few bytes as needed', () => {
        for (const size of [0, 127, 128, 255, 256, 65535, 65536]) {
            const bytes: Buffer = encodeMessage({messageId: 1, protocolOp: {type: 'extendedRequest', name: '1.2.3', value: Buffer.alloc(size, 0x61)}})
            const decoded: LDAPMessage = decodeMessage(bytes)
            assert.equal(decoded.protocolOp.type === 'extendedRequest' && decoded.protocolOp.value?.length, size)
        }
    })
})

describe('the UTF-8 check', () => {
    it('accepts the valid forms and refuses the others', () => {
        assert.ok(isUTF8(Buffer.from('abc 中文 😀', 'utf8')))
        for (const hex of ['c0af', 'e080af', 'eda080', 'f4908080', 'ff', 'c2', 'e282', 'f09f98']) assert.equal(isUTF8(Buffer.from(hex, 'hex')), false, hex)
    })
})

describe('the message reader', () => {
    const messages: LDAPMessage[] = OPERATIONS.map((operation: ProtocolOp, index: number): LDAPMessage => ({messageId: index + 1, protocolOp: operation}))
    const stream: Buffer = Buffer.concat(messages.map(encodeMessage))

    it('reads the messages whatever the chunks, one byte at a time included', () => {
        for (const size of [1, 2, 3, 7, 64, stream.length]) {
            const reader: MessageReader = new MessageReader()
            const read: LDAPMessage[] = []
            for (let offset: number = 0; offset < stream.length; offset += size) {
                for (const item of reader.push(stream.subarray(offset, offset + size))) read.push(item.message!)
            }
            assert.deepEqual(read, messages)
            assert.equal(reader.bufferedBytes, 0)
        }
    })

    it('refuses a message larger than its limit as soon as its length is read', () => {
        const reader: MessageReader = new MessageReader({maxMessageSize: 100})
        const big: Buffer = encodeMessage({messageId: 1, protocolOp: {type: 'extendedRequest', name: '1.2.3', value: Buffer.alloc(200)}})
        assert.throws(() => reader.push(big.subarray(0, 4)), (error: unknown) => error instanceof LDAPDecodeException && error.fatal)
    })

    it('refuses an indefinite length and a message that is not a SEQUENCE', () => {
        assert.throws(() => new MessageReader().push(Buffer.from('3080', 'hex')), (error: unknown) => error instanceof LDAPDecodeException && error.fatal)
        assert.throws(() => new MessageReader().push(Buffer.from('0400', 'hex')), (error: unknown) => error instanceof LDAPDecodeException && error.fatal)
    })

    it('gives the error of a message it cannot decode and goes on', () => {
        const good: Buffer = encodeMessage({messageId: 4, protocolOp: {type: 'deleteRequest', entry: 'cn=ab'}})
        const bad: Buffer = Buffer.from(good)
        bad[bad.length - 1] = 0xff
        const read: ReadMessage[] = new MessageReader().push(Buffer.concat([bad, good]))
        assert.equal(read.length, 2)
        assert.equal(read[0].error?.messageId, 4)
        assert.equal(read[1].message?.messageId, 4)
    })
})
