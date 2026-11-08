import {LDAPDecodeException} from '../../exceptions/LDAPDecodeException.js'
import {BerReader, BerTag, CONSTRUCTED, CONTEXT, constructed, decodeUTF8, integer, octets, serialize, boolean} from '../ber/Ber.js'
import type {ValueCodec} from '../controls/Control.js'

/**
 * The OIDs of the extended operations of LDAP: StartTLS (RFC 4511 §4.14), Who Am I (RFC 4532), Password Modify
 * (RFC 3062), Cancel (RFC 3909), the Notice of Disconnection (RFC 4511 §4.4.1), and the sync info message of content
 * synchronization (RFC 4533), an intermediate response
 */
export const ExtendedOperation = {
    startTLS: '1.3.6.1.4.1.1466.20037',
    whoAmI: '1.3.6.1.4.1.4203.1.11.3',
    passwordModify: '1.3.6.1.4.1.4203.1.11.1',
    cancel: '1.3.6.1.1.8',
    noticeOfDisconnection: '1.3.6.1.4.1.1466.20036',
    syncInfo: '1.3.6.1.4.1.4203.1.9.1.4'
} as const

/**
 * Define the codec of a value
 * @param name Its name, for the errors.
 * @param encode The bytes of a value.
 * @param decode The value of the bytes.
 */
function define<T>(name: string, encode: (value: T) => Buffer, decode: (bytes: Buffer) => T): ValueCodec<T> {
    return {
        encode: encode,
        decode(bytes: Buffer): T {
            try {
                return decode(bytes)
            } catch (error) {
                throw new LDAPDecodeException(`The value of the ${name} cannot be read: ${(error as Error).message}`, {fatal: false})
            }
        }
    }
}

/**
 * The value of a Password Modify request (RFC 3062). Without `userIdentity` the bound user's password changes; without
 * `newPassword` the server generates one.
 */
export interface PasswordModifyRequestValue {
    /**
     * Whose password: a DN, or another identity the server knows
     */
    userIdentity?: string
    /**
     * The current password
     */
    oldPassword?: Buffer
    /**
     * The new password
     */
    newPassword?: Buffer
}

/**
 * The codec of the value of a Password Modify request
 */
export const PasswordModifyRequest: ValueCodec<PasswordModifyRequestValue> = define<PasswordModifyRequestValue>('Password Modify request',
    (value: PasswordModifyRequestValue): Buffer => serialize(constructed(BerTag.sequence, [
        value.userIdentity === undefined ? undefined : octets(value.userIdentity, CONTEXT | 0),
        value.oldPassword === undefined ? undefined : octets(value.oldPassword, CONTEXT | 1),
        value.newPassword === undefined ? undefined : octets(value.newPassword, CONTEXT | 2)
    ])),
    (bytes: Buffer): PasswordModifyRequestValue => {
        const value: PasswordModifyRequestValue = {}
        //A request without a value changes the bound user's password to a generated one
        if (!bytes.length) return value
        const reader: BerReader = new BerReader(bytes).enter(BerTag.sequence)
        if (reader.peek() === (CONTEXT | 0)) value.userIdentity = decodeUTF8(reader.octets(CONTEXT | 0))
        if (reader.peek() === (CONTEXT | 1)) value.oldPassword = reader.octets(CONTEXT | 1)
        if (reader.peek() === (CONTEXT | 2)) value.newPassword = reader.octets(CONTEXT | 2)
        return value
    })

/**
 * The value of a Password Modify response: the password the server generated
 */
export interface PasswordModifyResponseValue {
    /**
     * The generated password
     */
    generatedPassword?: Buffer
}

/**
 * The codec of the value of a Password Modify response
 */
export const PasswordModifyResponse: ValueCodec<PasswordModifyResponseValue> = define<PasswordModifyResponseValue>('Password Modify response',
    (value: PasswordModifyResponseValue): Buffer => serialize(constructed(BerTag.sequence, [value.generatedPassword === undefined ? undefined : octets(value.generatedPassword, CONTEXT | 0)])),
    (bytes: Buffer): PasswordModifyResponseValue => {
        const reader: BerReader = new BerReader(bytes).enter(BerTag.sequence)
        return reader.peek() === (CONTEXT | 0) ? {generatedPassword: reader.octets(CONTEXT | 0)} : {}
    })

/**
 * The codec of the value of a Cancel request (RFC 3909): the message ID of the operation to cancel
 */
export const CancelRequest: ValueCodec<number> = define<number>('Cancel request',
    (messageId: number): Buffer => serialize(constructed(BerTag.sequence, [integer(messageId)])),
    (bytes: Buffer): number => new BerReader(bytes).enter(BerTag.sequence).integer())

/**
 * The codec of the value of a Who Am I response (RFC 4532): the authzId of the session (`dn:…`, `u:…`), empty for an
 * anonymous one
 */
export const WhoAmIResponse: ValueCodec<string> = define<string>('Who Am I response',
    (authzId: string): Buffer => Buffer.from(authzId, 'utf8'),
    (bytes: Buffer): string => decodeUTF8(bytes))

/**
 * A sync info message (RFC 4533 §2.5): a new cookie, the end of a refresh phase (with or without the deleted entries),
 * or the UUIDs of a set of entries present or deleted
 */
export interface SyncInfoValue {
    /**
     * The kind of message
     */
    type: 'newCookie' | 'refreshDelete' | 'refreshPresent' | 'syncIdSet'
    /**
     * The cookie
     */
    cookie?: Buffer
    /**
     * With `refreshDelete` and `refreshPresent`: whether the refresh phase is done (true by default)
     */
    refreshDone?: boolean
    /**
     * With `syncIdSet`: whether the UUIDs are of deleted entries rather than present ones
     */
    refreshDeletes?: boolean
    /**
     * With `syncIdSet`: the entryUUIDs (16 bytes each)
     */
    syncUUIDs?: Buffer[]
}

/**
 * The codec of the value of a sync info message (RFC 4533), an intermediate response
 */
export const SyncInfo: ValueCodec<SyncInfoValue> = define<SyncInfoValue>('sync info message',
    (value: SyncInfoValue): Buffer => {
        switch (value.type) {
            case 'newCookie':
                return serialize(octets(value.cookie ?? Buffer.alloc(0), CONTEXT | 0))
            case 'refreshDelete':
            case 'refreshPresent':
                return serialize(constructed(CONTEXT | CONSTRUCTED | (value.type === 'refreshDelete' ? 1 : 2), [
                    value.cookie === undefined ? undefined : octets(value.cookie),
                    value.refreshDone === false ? boolean(false) : undefined
                ]))
            case 'syncIdSet':
                return serialize(constructed(CONTEXT | CONSTRUCTED | 3, [
                    value.cookie === undefined ? undefined : octets(value.cookie),
                    value.refreshDeletes ? boolean(true) : undefined,
                    constructed(BerTag.set, (value.syncUUIDs ?? []).map((uuid: Buffer) => octets(uuid)))
                ]))
        }
    },
    (bytes: Buffer): SyncInfoValue => {
        const reader: BerReader = new BerReader(bytes)
        const tag: number | undefined = reader.peek()
        if (tag === (CONTEXT | 0)) return {type: 'newCookie', cookie: reader.octets(CONTEXT | 0)}
        if (tag === (CONTEXT | CONSTRUCTED | 1) || tag === (CONTEXT | CONSTRUCTED | 2)) {
            const inner: BerReader = reader.enter(tag)
            const value: SyncInfoValue = {type: tag === (CONTEXT | CONSTRUCTED | 1) ? 'refreshDelete' : 'refreshPresent', refreshDone: true}
            if (inner.peek() === BerTag.octetString) value.cookie = inner.octets()
            if (inner.peek() === BerTag.boolean) value.refreshDone = inner.boolean()
            return value
        }
        if (tag === (CONTEXT | CONSTRUCTED | 3)) {
            const inner: BerReader = reader.enter(tag)
            const value: SyncInfoValue = {type: 'syncIdSet', refreshDeletes: false, syncUUIDs: []}
            if (inner.peek() === BerTag.octetString) value.cookie = inner.octets()
            if (inner.peek() === BerTag.boolean) value.refreshDeletes = inner.boolean()
            const set: BerReader = inner.enter(BerTag.set)
            while (!set.atEnd()) value.syncUUIDs!.push(set.octets())
            return value
        }
        throw new Error('Not a sync info message')
    })
