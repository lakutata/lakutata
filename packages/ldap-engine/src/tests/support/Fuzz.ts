import {DN} from '../../lib/dn/DN.js'
import {LDAPDNSyntaxException} from '../../exceptions/LDAPDNSyntaxException.js'
import {LDAPDecodeException} from '../../exceptions/LDAPDecodeException.js'
import {LDAPFilterSyntaxException} from '../../exceptions/LDAPFilterSyntaxException.js'
import {LDAPLDIFSyntaxException} from '../../exceptions/LDAPLDIFSyntaxException.js'
import {LDAPSchemaException} from '../../exceptions/LDAPSchemaException.js'
import {PagedResultsControl, PasswordPolicyResponseControl, SortRequestControl, VLVRequestControl} from '../../lib/controls/Controls.js'
import {parseFilter} from '../../lib/filter/FilterString.js'
import {Filter} from '../../lib/filter/Filter.js'
import {parseLDIF} from '../../lib/ldif/LDIF.js'
import {decodeMessage, encodeMessage} from '../../lib/protocol/Codec.js'
import {MessageReader} from '../../lib/protocol/MessageReader.js'
import type {LDAPMessage} from '../../lib/protocol/Messages.js'
import {parseAttributeType, parseObjectClass} from '../../lib/schema/Definitions.js'

/**
 * A pseudo-random generator with a seed (mulberry32), so a failure can be run again
 * @param seed The seed.
 */
export function random(seed: number): () => number {
    let state: number = seed >>> 0
    return (): number => {
        state = (state + 0x6d2b79f5) >>> 0
        let value: number = state
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

//The messages the mutations start from
const SEEDS: LDAPMessage[] = [
    {messageId: 1, protocolOp: {type: 'bindRequest', version: 3, name: 'cn=admin,dc=example,dc=com', authentication: {type: 'simple', password: Buffer.from('secret')}}},
    {messageId: 2, protocolOp: {type: 'bindRequest', version: 3, name: '', authentication: {type: 'sasl', mechanism: 'PLAIN', credentials: Buffer.from('\0a\0b')}}},
    {
        messageId: 3,
        protocolOp: {
            type: 'searchRequest', baseObject: 'dc=example,dc=com', scope: 'sub', derefAliases: 'never', sizeLimit: 10, timeLimit: 5, typesOnly: false,
            filter: parseFilter('(&(objectClass=person)(|(cn=a*b*c)(uidNumber>=10)(!(mail=*)))(cn:dn:caseExactMatch:=x)(sn~=y))'), attributes: ['cn', '+']
        },
        controls: [PagedResultsControl.encode({size: 100, cookie: Buffer.from('abc')}, true), SortRequestControl.encode([{attribute: 'cn', reverse: true}]), VLVRequestControl.encode({beforeCount: 1, afterCount: 2, offset: {offset: 1, contentCount: 0}})]
    },
    {messageId: 4, protocolOp: {type: 'searchResultEntry', objectName: 'cn=x', attributes: [{type: 'cn', values: [Buffer.from('x'), Buffer.from('y')]}, {type: 'jpegPhoto', values: [Buffer.alloc(300, 7)]}]}},
    {messageId: 5, protocolOp: {type: 'modifyRequest', object: 'cn=x', changes: [{operation: 'replace', modification: {type: 'mail', values: [Buffer.from('a@b')]}}, {operation: 'delete', modification: {type: 'description', values: []}}]}},
    {messageId: 6, protocolOp: {type: 'addRequest', entry: 'cn=x', attributes: [{type: 'objectClass', values: [Buffer.from('top')]}]}},
    {messageId: 7, protocolOp: {type: 'modifyDNRequest', entry: 'cn=x', newRDN: 'cn=y', deleteOldRDN: true, newSuperior: 'dc=z'}},
    {messageId: 8, protocolOp: {type: 'compareRequest', entry: 'cn=x', attribute: 'cn', value: Buffer.from('x')}},
    {messageId: 9, protocolOp: {type: 'extendedResponse', resultCode: 0, matchedDN: '', diagnosticMessage: 'ok', name: '1.2.3', value: Buffer.from([1])}},
    {messageId: 10, protocolOp: {type: 'bindResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''}, controls: [PasswordPolicyResponseControl.encode({timeBeforeExpiration: 100, error: 'changeAfterReset'})]},
    {messageId: 11, protocolOp: {type: 'abandonRequest', messageId: 3}},
    {messageId: 12, protocolOp: {type: 'deleteRequest', entry: 'cn=x,dc=y'}}
]

/**
 * Mutate bytes: flip bits, change a byte, cut, insert, duplicate a part
 * @param bytes The bytes.
 * @param next The generator.
 */
function mutate(bytes: Buffer, next: () => number): Buffer {
    let result: Buffer = Buffer.from(bytes)
    const count: number = 1 + Math.floor(next() * 4)
    for (let index: number = 0; index < count; index++) {
        const position: number = Math.floor(next() * Math.max(result.length, 1))
        switch (Math.floor(next() * 6)) {
            case 0:
                if (result.length) result[position] ^= 1 << Math.floor(next() * 8)
                break
            case 1:
                if (result.length) result[position] = Math.floor(next() * 256)
                break
            case 2:
                result = result.subarray(0, position)
                break
            case 3:
                result = Buffer.concat([result.subarray(0, position), Buffer.from([Math.floor(next() * 256)]), result.subarray(position)])
                break
            case 4:
                //A length byte made long: the most frequent cause of over-reads
                if (result.length) result[position] = [0x80, 0x81, 0x84, 0x85, 0xff, 0x7f][Math.floor(next() * 6)]
                break
            default:
                result = Buffer.concat([result, result.subarray(position, position + Math.floor(next() * 16))])
        }
    }
    return result
}

/**
 * A random string from an alphabet that has the special characters of filters, DNs and LDIF
 * @param next The generator.
 */
function randomText(next: () => number): string {
    const alphabet: string = '()&|!=~<>*:\\,+;#" \'abcdefABC012.-_$\n#:<中\u0000'
    let text: string = ''
    const length: number = Math.floor(next() * 40)
    for (let index: number = 0; index < length; index++) text += alphabet[Math.floor(next() * alphabet.length)]
    return text
}

/**
 * What one iteration found wrong: an error that is not the expected one, with what caused it
 */
export interface FuzzFailure {
    iteration: number
    target: string
    input: string
    error: Error
}

/**
 * Run the fuzzing: decode mutated messages (whole, and through a reader in random chunks), and parse random filters,
 * DNs, LDIF and schema definitions. Only the package's own exceptions may come out.
 * @param iterations How many iterations.
 * @param seed The seed.
 */
export function fuzz(iterations: number, seed: number = 1): FuzzFailure[] {
    const next: () => number = random(seed)
    const encoded: Buffer[] = SEEDS.map(encodeMessage)
    const failures: FuzzFailure[] = []
    const record = (iteration: number, target: string, input: string, error: unknown, expected: boolean): void => {
        if (!expected) failures.push({iteration: iteration, target: target, input: input, error: error as Error})
    }
    for (let iteration: number = 0; iteration < iterations; iteration++) {
        const bytes: Buffer = mutate(encoded[Math.floor(next() * encoded.length)], next)
        try {
            const message: LDAPMessage = decodeMessage(bytes)
            //What decodes encodes again
            encodeMessage(message)
        } catch (error) {
            record(iteration, 'decodeMessage', bytes.toString('hex'), error, error instanceof LDAPDecodeException)
        }
        try {
            const reader: MessageReader = new MessageReader({maxMessageSize: 4096})
            let offset: number = 0
            while (offset < bytes.length) {
                const size: number = 1 + Math.floor(next() * 8)
                reader.push(bytes.subarray(offset, offset + size))
                offset += size
            }
        } catch (error) {
            record(iteration, 'MessageReader', bytes.toString('hex'), error, error instanceof LDAPDecodeException)
        }
        const text: string = randomText(next)
        try {
            Filter.stringify(parseFilter(text))
        } catch (error) {
            record(iteration, 'parseFilter', text, error, error instanceof LDAPFilterSyntaxException)
        }
        try {
            DN.parse(text).toString()
        } catch (error) {
            record(iteration, 'DN.parse', text, error, error instanceof LDAPDNSyntaxException)
        }
        try {
            parseLDIF('dn: cn=a\n' + text)
        } catch (error) {
            record(iteration, 'parseLDIF', text, error, error instanceof LDAPLDIFSyntaxException)
        }
        try {
            if (next() < 0.5) parseAttributeType(`( 1.2.3 ${text} SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )`)
            else parseObjectClass(`( 1.2.3 ${text} )`)
        } catch (error) {
            record(iteration, 'parseSchemaDefinition', text, error, error instanceof LDAPSchemaException)
        }
    }
    return failures
}
