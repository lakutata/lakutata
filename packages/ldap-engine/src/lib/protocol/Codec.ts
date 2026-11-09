import {LDAPDecodeException} from '../../exceptions/LDAPDecodeException.js'
import {APPLICATION, BerError, type BerElement, BerReader, BerTag, BerValueError, boolean, CONSTRUCTED, CONTEXT, constructed, enumerated, integer, integerContent, nullElement, octets, primitive, readPastValues, refuseValue, serialize} from '../ber/Ber.js'
import type {Control} from '../controls/Control.js'
import {filterElement, readFilter} from '../filter/Filter.js'
import type {
    AddRequest,
    BindAuthentication,
    BindRequest,
    BindResponse,
    CompareRequest,
    DerefAliases,
    ExtendedRequest,
    ExtendedResponse,
    IntermediateResponse,
    LDAPMessage,
    LDAPResult,
    ModifyChange,
    ModifyDNRequest,
    ModifyOperation,
    ModifyRequest,
    PartialAttribute,
    ProtocolOp,
    ResultResponse,
    SearchRequest,
    SearchResultEntry,
    SearchResultReference,
    SearchScope
} from './Messages.js'

//The application tags of the operations (RFC 4511 Appendix B)
const TAGS: Record<ProtocolOp['type'], number> = {
    bindRequest: APPLICATION | CONSTRUCTED | 0,
    bindResponse: APPLICATION | CONSTRUCTED | 1,
    unbindRequest: APPLICATION | 2,
    searchRequest: APPLICATION | CONSTRUCTED | 3,
    searchResultEntry: APPLICATION | CONSTRUCTED | 4,
    searchResultDone: APPLICATION | CONSTRUCTED | 5,
    modifyRequest: APPLICATION | CONSTRUCTED | 6,
    modifyResponse: APPLICATION | CONSTRUCTED | 7,
    addRequest: APPLICATION | CONSTRUCTED | 8,
    addResponse: APPLICATION | CONSTRUCTED | 9,
    deleteRequest: APPLICATION | 10,
    deleteResponse: APPLICATION | CONSTRUCTED | 11,
    modifyDNRequest: APPLICATION | CONSTRUCTED | 12,
    modifyDNResponse: APPLICATION | CONSTRUCTED | 13,
    compareRequest: APPLICATION | CONSTRUCTED | 14,
    compareResponse: APPLICATION | CONSTRUCTED | 15,
    abandonRequest: APPLICATION | 16,
    searchResultReference: APPLICATION | CONSTRUCTED | 19,
    extendedRequest: APPLICATION | CONSTRUCTED | 23,
    extendedResponse: APPLICATION | CONSTRUCTED | 24,
    intermediateResponse: APPLICATION | CONSTRUCTED | 25
}

const OPERATIONS: Map<number, ProtocolOp['type']> = new Map(Object.entries(TAGS).map(([type, tag]: [string, number]): [number, ProtocolOp['type']] => [tag, type as ProtocolOp['type']]))

const SCOPES: SearchScope[] = ['base', 'one', 'sub', 'children']
const DEREF: DerefAliases[] = ['never', 'searching', 'finding', 'always']
const MODIFY_OPERATIONS: ModifyOperation[] = ['add', 'delete', 'replace', 'increment']

const TAG_CONTROLS: number = CONTEXT | CONSTRUCTED | 0
const TAG_REFERRAL: number = CONTEXT | CONSTRUCTED | 3

/**
 * The operation type of an application tag, or undefined when the tag is not an operation's
 * @param tag The tag.
 */
export function operationOfTag(tag: number): ProtocolOp['type'] | undefined {
    return OPERATIONS.get(tag)
}

/**
 * The application tag of an operation type
 * @param type The operation type.
 */
export function tagOfOperation(type: ProtocolOp['type']): number {
    return TAGS[type]
}

/**
 * The elements of an LDAPResult
 * @param result The result.
 */
function resultElements(result: LDAPResult): BerElement[] {
    return [
        enumerated(result.resultCode),
        octets(result.matchedDN),
        octets(result.diagnosticMessage),
        ...(result.referral?.length ? [constructed(TAG_REFERRAL, result.referral.map((uri: string): BerElement => octets(uri)))] : [])
    ]
}

/**
 * The element of a list of attributes
 * @param attributes The attributes.
 */
function attributesElement(attributes: PartialAttribute[]): BerElement {
    return constructed(BerTag.sequence, attributes.map((attribute: PartialAttribute): BerElement => constructed(BerTag.sequence, [
        octets(attribute.type),
        constructed(BerTag.set, attribute.values.map((value: Buffer): BerElement => octets(value)))
    ])))
}

/**
 * The element of the authentication of a bind
 * @param authentication The authentication.
 */
function authenticationElement(authentication: BindAuthentication): BerElement {
    switch (authentication.type) {
        case 'simple':
            return octets(authentication.password, CONTEXT | 0)
        case 'sasl':
            return constructed(CONTEXT | CONSTRUCTED | 3, [octets(authentication.mechanism), authentication.credentials === undefined ? undefined : octets(authentication.credentials)])
        case 'other':
            return primitive(authentication.tag, authentication.value)
    }
}

/**
 * The element of an operation
 * @param operation The operation.
 */
export function operationElement(operation: ProtocolOp): BerElement {
    const tag: number = TAGS[operation.type]
    switch (operation.type) {
        case 'bindRequest':
            return constructed(tag, [integer(operation.version), octets(operation.name), authenticationElement(operation.authentication)])
        case 'bindResponse':
            return constructed(tag, [...resultElements(operation), operation.serverSaslCredentials === undefined ? undefined : octets(operation.serverSaslCredentials, CONTEXT | 7)])
        case 'unbindRequest':
            return nullElement(tag)
        case 'searchRequest':
            return constructed(tag, [
                octets(operation.baseObject),
                enumerated(SCOPES.indexOf(operation.scope)),
                enumerated(DEREF.indexOf(operation.derefAliases)),
                integer(operation.sizeLimit),
                integer(operation.timeLimit),
                boolean(operation.typesOnly),
                filterElement(operation.filter),
                constructed(BerTag.sequence, operation.attributes.map((attribute: string): BerElement => octets(attribute)))
            ])
        case 'searchResultEntry':
            return constructed(tag, [octets(operation.objectName), attributesElement(operation.attributes)])
        case 'searchResultReference':
            return constructed(tag, operation.uris.map((uri: string): BerElement => octets(uri)))
        case 'searchResultDone':
        case 'modifyResponse':
        case 'addResponse':
        case 'deleteResponse':
        case 'modifyDNResponse':
        case 'compareResponse':
            return constructed(tag, resultElements(operation))
        case 'modifyRequest':
            return constructed(tag, [
                octets(operation.object),
                constructed(BerTag.sequence, operation.changes.map((change: ModifyChange): BerElement => constructed(BerTag.sequence, [
                    enumerated(MODIFY_OPERATIONS.indexOf(change.operation)),
                    attributesElement([change.modification]).children![0]
                ])))
            ])
        case 'addRequest':
            return constructed(tag, [octets(operation.entry), attributesElement(operation.attributes)])
        case 'deleteRequest':
            return octets(operation.entry, tag)
        case 'modifyDNRequest':
            return constructed(tag, [
                octets(operation.entry),
                octets(operation.newRDN),
                boolean(operation.deleteOldRDN),
                operation.newSuperior === undefined ? undefined : octets(operation.newSuperior, CONTEXT | 0)
            ])
        case 'compareRequest':
            return constructed(tag, [octets(operation.entry), constructed(BerTag.sequence, [octets(operation.attribute), octets(operation.value)])])
        case 'abandonRequest':
            return primitive(tag, integerContent(operation.messageId))
        case 'extendedRequest':
            return constructed(tag, [octets(operation.name, CONTEXT | 0), operation.value === undefined ? undefined : octets(operation.value, CONTEXT | 1)])
        case 'extendedResponse':
            return constructed(tag, [
                ...resultElements(operation),
                operation.name === undefined ? undefined : octets(operation.name, CONTEXT | 10),
                operation.value === undefined ? undefined : octets(operation.value, CONTEXT | 11)
            ])
        case 'intermediateResponse':
            return constructed(tag, [
                operation.name === undefined ? undefined : octets(operation.name, CONTEXT | 0),
                operation.value === undefined ? undefined : octets(operation.value, CONTEXT | 1)
            ])
    }
}

/**
 * The element of a control
 * @param control The control.
 */
export function controlElement(control: Control): BerElement {
    return constructed(BerTag.sequence, [
        octets(control.oid),
        control.critical ? boolean(true) : undefined,
        control.value === undefined ? undefined : octets(control.value)
    ])
}

/**
 * Encode a message
 * @param message The message.
 * @example
 * ```typescript
 * import {decodeMessage, encodeMessage, Filter} from '@lakutata/ldap-engine'
 *
 * const bytes: Buffer = encodeMessage({
 *     messageId: 2,
 *     protocolOp: {
 *         type: 'searchRequest',
 *         baseObject: 'dc=example,dc=com',
 *         scope: 'sub',
 *         derefAliases: 'never',
 *         sizeLimit: 0,
 *         timeLimit: 0,
 *         typesOnly: false,
 *         filter: Filter.equal('uid', 'alice'),
 *         attributes: ['cn', 'mail']
 *     }
 * })
 * console.log(decodeMessage(bytes).protocolOp.type) //searchRequest
 * ```
 */
export function encodeMessage(message: LDAPMessage): Buffer {
    return serialize(constructed(BerTag.sequence, [
        integer(message.messageId),
        operationElement(message.protocolOp),
        message.controls?.length ? constructed(TAG_CONTROLS, message.controls.map(controlElement)) : undefined
    ]))
}

/**
 * Read an LDAPResult
 * @param reader The reader, inside the operation.
 */
function readResult(reader: BerReader): LDAPResult {
    const result: LDAPResult = {
        resultCode: reader.enumerated(),
        matchedDN: reader.string(),
        diagnosticMessage: reader.string()
    }
    if (reader.peek() === TAG_REFERRAL) {
        const uris: BerReader = reader.enter(TAG_REFERRAL)
        result.referral = []
        while (!uris.atEnd()) result.referral.push(uris.string())
    }
    return result
}

/**
 * Read a list of attributes
 * @param reader The reader, at the list.
 */
function readAttributes(reader: BerReader): PartialAttribute[] {
    const list: BerReader = reader.enter(BerTag.sequence)
    const attributes: PartialAttribute[] = []
    while (!list.atEnd()) attributes.push(readAttribute(list))
    return attributes
}

/**
 * Read an attribute
 * @param reader The reader, at the attribute.
 */
function readAttribute(reader: BerReader): PartialAttribute {
    const element: BerReader = reader.enter(BerTag.sequence)
    const type: string = element.string()
    const set: BerReader = element.enter(BerTag.set)
    const values: Buffer[] = []
    while (!set.atEnd()) values.push(set.octets())
    return {type: type, values: values}
}

/**
 * Read the authentication of a bind
 * @param reader The reader, at the authentication.
 */
function readAuthentication(reader: BerReader): BindAuthentication {
    const tag: number | undefined = reader.peek()
    if (tag === (CONTEXT | 0)) return {type: 'simple', password: reader.octets(CONTEXT | 0)}
    if (tag === (CONTEXT | CONSTRUCTED | 3)) {
        const sasl: BerReader = reader.enter(CONTEXT | CONSTRUCTED | 3)
        const mechanism: string = sasl.string()
        return sasl.atEnd() ? {type: 'sasl', mechanism: mechanism} : {type: 'sasl', mechanism: mechanism, credentials: sasl.octets()}
    }
    if (tag === undefined) throw new BerError('The authentication of a bind is missing')
    const {end} = reader.header()
    const value: Buffer = reader.buffer.subarray(reader.offset, end)
    reader.offset = end
    return {type: 'other', tag: tag, value: value}
}

/**
 * The value of an enumeration
 * @param values The values, by their numbers.
 * @param index The number.
 * @param what What the enumeration is.
 */
function enumValue<T>(values: T[], index: number, what: string): T {
    const value: T | undefined = values[index]
    if (value === undefined) {
        refuseValue(`${index} is not a ${what}`)
        return values[0]
    }
    return value
}

/**
 * Read an operation
 * @param type The operation.
 * @param tag Its tag.
 * @param reader The reader, at the operation.
 */
export function readOperation(type: ProtocolOp['type'], tag: number, reader: BerReader): ProtocolOp {
    if (!(tag & CONSTRUCTED)) {
        switch (type) {
            case 'unbindRequest':
                reader.null(tag)
                return {type: 'unbindRequest'}
            case 'deleteRequest':
                return {type: 'deleteRequest', entry: reader.string(tag)}
            case 'abandonRequest':
                return {type: 'abandonRequest', messageId: reader.integer(tag)}
            default:
                throw new BerError('A primitive operation')
        }
    }
    const inner: BerReader = reader.enter(tag)
    //The elements after the known ones are extensions, ignored (RFC 4511 §4)
    switch (type) {
        case 'bindRequest': {
            const operation: BindRequest = {type: 'bindRequest', version: inner.integer(), name: inner.string(), authentication: readAuthentication(inner)}
            return operation
        }
        case 'bindResponse': {
            const operation: BindResponse = {type: 'bindResponse', ...readResult(inner)}
            if (inner.peek() === (CONTEXT | 7)) operation.serverSaslCredentials = inner.octets(CONTEXT | 7)
            return operation
        }
        case 'searchRequest': {
            const operation: SearchRequest = {
                type: 'searchRequest',
                baseObject: inner.string(),
                scope: enumValue(SCOPES, inner.enumerated(), 'scope'),
                derefAliases: enumValue(DEREF, inner.enumerated(), 'deref aliases value'),
                sizeLimit: inner.integer(),
                timeLimit: inner.integer(),
                typesOnly: inner.boolean(),
                filter: readFilter(inner),
                attributes: []
            }
            const attributes: BerReader = inner.enter(BerTag.sequence)
            while (!attributes.atEnd()) operation.attributes.push(attributes.string())
            if (operation.sizeLimit < 0 || operation.timeLimit < 0) refuseValue('A negative limit')
            return operation
        }
        case 'searchResultEntry': {
            const operation: SearchResultEntry = {type: 'searchResultEntry', objectName: inner.string(), attributes: readAttributes(inner)}
            return operation
        }
        case 'searchResultReference': {
            const operation: SearchResultReference = {type: 'searchResultReference', uris: []}
            while (!inner.atEnd()) operation.uris.push(inner.string())
            return operation
        }
        case 'searchResultDone':
        case 'modifyResponse':
        case 'addResponse':
        case 'deleteResponse':
        case 'modifyDNResponse':
        case 'compareResponse': {
            const operation: ResultResponse = {type: type, ...readResult(inner)}
            return operation
        }
        case 'modifyRequest': {
            const operation: ModifyRequest = {type: 'modifyRequest', object: inner.string(), changes: []}
            const changes: BerReader = inner.enter(BerTag.sequence)
            while (!changes.atEnd()) {
                const change: BerReader = changes.enter(BerTag.sequence)
                operation.changes.push({operation: enumValue(MODIFY_OPERATIONS, change.enumerated(), 'modify operation'), modification: readAttribute(change)})
            }
            return operation
        }
        case 'addRequest': {
            const operation: AddRequest = {type: 'addRequest', entry: inner.string(), attributes: readAttributes(inner)}
            return operation
        }
        case 'modifyDNRequest': {
            const operation: ModifyDNRequest = {type: 'modifyDNRequest', entry: inner.string(), newRDN: inner.string(), deleteOldRDN: inner.boolean()}
            if (inner.peek() === (CONTEXT | 0)) operation.newSuperior = inner.string(CONTEXT | 0)
            return operation
        }
        case 'compareRequest': {
            const entry: string = inner.string()
            const assertion: BerReader = inner.enter(BerTag.sequence)
            const operation: CompareRequest = {type: 'compareRequest', entry: entry, attribute: assertion.string(), value: assertion.octets()}
            return operation
        }
        case 'extendedRequest': {
            const operation: ExtendedRequest = {type: 'extendedRequest', name: inner.string(CONTEXT | 0)}
            if (inner.peek() === (CONTEXT | 1)) operation.value = inner.octets(CONTEXT | 1)
            return operation
        }
        case 'extendedResponse': {
            const operation: ExtendedResponse = {type: 'extendedResponse', ...readResult(inner)}
            if (inner.peek() === (CONTEXT | 10)) operation.name = inner.string(CONTEXT | 10)
            if (inner.peek() === (CONTEXT | 11)) operation.value = inner.octets(CONTEXT | 11)
            return operation
        }
        case 'intermediateResponse': {
            const operation: IntermediateResponse = {type: 'intermediateResponse'}
            if (inner.peek() === (CONTEXT | 0)) operation.name = inner.string(CONTEXT | 0)
            if (inner.peek() === (CONTEXT | 1)) operation.value = inner.octets(CONTEXT | 1)
            return operation
        }
        default:
            throw new BerError(`A constructed ${type}`)
    }
}

/**
 * Read the controls of a message
 * @param reader The reader, at the controls.
 */
function readControls(reader: BerReader): Control[] {
    const list: BerReader = reader.enter(TAG_CONTROLS)
    const controls: Control[] = []
    while (!list.atEnd()) {
        const element: BerReader = list.enter(BerTag.sequence)
        const control: Control = {oid: element.string(), critical: false}
        if (element.peek() === BerTag.boolean) control.critical = element.boolean()
        if (element.peek() === BerTag.octetString) control.value = element.octets()
        controls.push(control)
    }
    return controls
}

/**
 * Decode a message: the bytes of one whole LDAPMessage. The DNs, the attribute descriptions and the values are kept as
 * they are sent (a DN is not parsed here), so a server can answer a malformed one with a result code.
 * @param bytes The bytes; the values of the message are slices of them.
 * @example
 * ```typescript
 * import {decodeMessage, encodeMessage, type LDAPMessage} from '@lakutata/ldap-engine'
 *
 * const message: LDAPMessage = decodeMessage(encodeMessage({messageId: 1, protocolOp: {type: 'unbindRequest'}}))
 * console.log(message.messageId, message.protocolOp.type) //1 unbindRequest
 * ```
 */
export function decodeMessage(bytes: Buffer): LDAPMessage {
    let reader: BerReader
    let messageId: number
    try {
        const outer: BerReader = new BerReader(bytes)
        reader = outer.enter(BerTag.sequence)
        if (!outer.atEnd()) throw new BerError('Bytes after the message')
        messageId = reader.integer()
        if (messageId < 0 || messageId > 0x7fffffff) throw new BerError(`The message ID ${messageId} is out of range`)
    } catch (error) {
        throw new LDAPDecodeException(`The message cannot be read: ${(error as Error).message}`, {fatal: true})
    }
    const tag: number | undefined = reader.peek()
    const type: ProtocolOp['type'] | undefined = tag === undefined ? undefined : OPERATIONS.get(tag)
    if (tag === undefined || type === undefined) {
        throw new LDAPDecodeException(tag === undefined ? 'The message has no operation' : `The operation of tag 0x${tag.toString(16)} is not known`, {fatal: true, messageId: messageId})
    }
    const read = (from: BerReader): LDAPMessage => {
        const message: LDAPMessage = {messageId: messageId, protocolOp: readOperation(type, tag, from)}
        if (from.peek() === TAG_CONTROLS) message.controls = readControls(from)
        return message
    }
    const operation: number = reader.offset
    try {
        return read(reader)
    } catch (error) {
        let malformed: boolean = !(error instanceof BerValueError)
        //A value that is not allowed: the message read again past such values, for an error of its encoding after it
        if (!malformed) {
            try {
                readPastValues((): LDAPMessage => read(new BerReader(reader.buffer, operation, reader.end)))
            } catch (later) {
                malformed = !(later instanceof BerValueError)
            }
        }
        throw new LDAPDecodeException(`The ${type} cannot be read: ${(error as Error).message}`, {fatal: false, malformed: malformed, messageId: messageId, operation: type})
    }
}
