import {LDAPDecodeException} from '../../exceptions/LDAPDecodeException.js'
import {type BerElement, BerReader, BerTag, boolean, CONSTRUCTED, CONTEXT, constructed, decodeUTF8, enumerated, integer, octets, serialize} from '../ber/Ber.js'
import {type Filter, filterElement, readFilter} from '../filter/Filter.js'
import {operationElement, readOperation, tagOfOperation} from '../protocol/Codec.js'
import type {PartialAttribute, SearchResultEntry} from '../protocol/Messages.js'
import type {Control, ControlCodec} from './Control.js'

/**
 * Define the codec of a control
 * @param oid The OID of the control.
 * @param name Its name, for the errors.
 * @param encode The bytes of a value, undefined for a control without a value.
 * @param decode The value of the bytes.
 */
function define<T>(oid: string, name: string, encode: (value: T) => Buffer | undefined, decode: (value: Buffer | undefined) => T): ControlCodec<T> {
    return {
        oid: oid,
        encode(value: T, critical: boolean = false): Control {
            const bytes: Buffer | undefined = encode(value)
            return bytes === undefined ? {oid: oid, critical: critical} : {oid: oid, critical: critical, value: bytes}
        },
        decode(control: Control): T {
            if (control.oid !== oid) throw new LDAPDecodeException(`The control ${control.oid} is not the ${name} control (${oid})`, {fatal: false})
            try {
                return decode(control.value)
            } catch (error) {
                if (error instanceof LDAPDecodeException) throw error
                throw new LDAPDecodeException(`The value of the ${name} control cannot be read: ${(error as Error).message}`, {fatal: false})
            }
        }
    }
}

/**
 * The value of a control, which must be there
 * @param value The value.
 */
function required(value: Buffer | undefined): Buffer {
    if (value === undefined) throw new Error('The value is missing')
    return value
}

/**
 * A reader of the SEQUENCE a value is
 * @param value The value.
 */
function sequence(value: Buffer | undefined): BerReader {
    return new BerReader(required(value)).enter(BerTag.sequence)
}

/**
 * The value of the paged results control (RFC 2696): the page size asked, or the estimate of the entries returned by
 * a server, and the cookie (empty on the first request and on the last page)
 */
export interface PagedResultsValue {
    /**
     * The page size in a request; the estimated count of the entries (0 when unknown) in a response
     */
    size: number
    /**
     * The cookie of the server; empty to start, and on the last page
     */
    cookie: Buffer
}

/**
 * The paged results control (RFC 2696). A value without its cookie, which RFC 2696 requires, is read with an empty
 * one; a value written always has it.
 */
export const PagedResultsControl: ControlCodec<PagedResultsValue> = define<PagedResultsValue>('1.2.840.113556.1.4.319', 'paged results',
    (value: PagedResultsValue): Buffer => serialize(constructed(BerTag.sequence, [integer(value.size), octets(value.cookie)])),
    (value: Buffer | undefined): PagedResultsValue => {
        const reader: BerReader = sequence(value)
        const size: number = reader.integer()
        return {size: size, cookie: reader.atEnd() ? Buffer.alloc(0) : reader.octets()}
    })

/**
 * A key of a server side sort
 */
export interface SortKey {
    /**
     * The attribute description
     */
    attribute: string
    /**
     * The ordering rule, when not the attribute's own
     */
    orderingRule?: string
    /**
     * Whether the order is reversed
     */
    reverse?: boolean
}

/**
 * The server side sort request control (RFC 2891): the keys, most significant first
 */
export const SortRequestControl: ControlCodec<SortKey[]> = define<SortKey[]>('1.2.840.113556.1.4.473', 'sort request',
    (keys: SortKey[]): Buffer => serialize(constructed(BerTag.sequence, keys.map((key: SortKey): BerElement => constructed(BerTag.sequence, [
        octets(key.attribute),
        key.orderingRule === undefined ? undefined : octets(key.orderingRule, CONTEXT | 0),
        key.reverse ? boolean(true, CONTEXT | 1) : undefined
    ])))),
    (value: Buffer | undefined): SortKey[] => {
        const reader: BerReader = sequence(value)
        const keys: SortKey[] = []
        while (!reader.atEnd()) {
            const element: BerReader = reader.enter(BerTag.sequence)
            const key: SortKey = {attribute: element.string()}
            if (element.peek() === (CONTEXT | 0)) key.orderingRule = element.string(CONTEXT | 0)
            if (element.peek() === (CONTEXT | 1)) key.reverse = element.boolean(CONTEXT | 1)
            keys.push(key)
        }
        if (!keys.length) throw new Error('A sort without keys')
        return keys
    })

/**
 * The value of the server side sort response control: the result of the sort, and the attribute it failed on
 */
export interface SortResultValue {
    /**
     * The result code of the sort (0, or `inappropriateMatching`, `insufficientAccessRights`…)
     */
    result: number
    /**
     * The attribute the sort failed on
     */
    attribute?: string
}

/**
 * The server side sort response control (RFC 2891)
 */
export const SortResponseControl: ControlCodec<SortResultValue> = define<SortResultValue>('1.2.840.113556.1.4.474', 'sort response',
    (value: SortResultValue): Buffer => serialize(constructed(BerTag.sequence, [enumerated(value.result), value.attribute === undefined ? undefined : octets(value.attribute, CONTEXT | 0)])),
    (value: Buffer | undefined): SortResultValue => {
        const reader: BerReader = sequence(value)
        const result: SortResultValue = {result: reader.enumerated()}
        if (reader.peek() === (CONTEXT | 0)) result.attribute = reader.string(CONTEXT | 0)
        return result
    })

/**
 * The value of the virtual list view request control: the window around a target entry of the sorted result, the
 * target given by its offset or by a value
 */
export interface VLVRequestValue {
    /**
     * The entries before the target
     */
    beforeCount: number
    /**
     * The entries after the target
     */
    afterCount: number
    /**
     * The target by its offset (1 for the first entry) and the client's estimate of the count of entries (0 when
     * unknown)
     */
    offset?: {offset: number, contentCount: number}
    /**
     * The target as the first entry whose sort key is greater than or equal to this value
     */
    greaterThanOrEqual?: Buffer
    /**
     * The context of the server, from its last response
     */
    contextId?: Buffer
}

/**
 * The virtual list view request control (draft-ietf-ldapext-ldapv3-vlv-09), sent with a server side sort
 */
export const VLVRequestControl: ControlCodec<VLVRequestValue> = define<VLVRequestValue>('2.16.840.1.113730.3.4.9', 'virtual list view request',
    (value: VLVRequestValue): Buffer => {
        let target: BerElement
        if (value.offset) {
            target = constructed(CONTEXT | CONSTRUCTED | 0, [integer(value.offset.offset), integer(value.offset.contentCount)])
        } else if (value.greaterThanOrEqual) {
            target = octets(value.greaterThanOrEqual, CONTEXT | 1)
        } else {
            throw new Error('A virtual list view request needs an offset or a value')
        }
        return serialize(constructed(BerTag.sequence, [integer(value.beforeCount), integer(value.afterCount), target, value.contextId === undefined ? undefined : octets(value.contextId)]))
    },
    (value: Buffer | undefined): VLVRequestValue => {
        const reader: BerReader = sequence(value)
        const result: VLVRequestValue = {beforeCount: reader.integer(), afterCount: reader.integer()}
        if (reader.peek() === (CONTEXT | CONSTRUCTED | 0)) {
            const target: BerReader = reader.enter(CONTEXT | CONSTRUCTED | 0)
            result.offset = {offset: target.integer(), contentCount: target.integer()}
        } else {
            result.greaterThanOrEqual = reader.octets(CONTEXT | 1)
        }
        if (reader.peek() === BerTag.octetString) result.contextId = reader.octets()
        return result
    })

/**
 * The value of the virtual list view response control: where the target is, the count of entries, the result
 */
export interface VLVResponseValue {
    /**
     * The offset of the target (1 for the first entry)
     */
    targetPosition: number
    /**
     * The count of entries the server has
     */
    contentCount: number
    /**
     * The result code of the view (0, `offsetRangeError`, `sortControlMissing`…)
     */
    result: number
    /**
     * The context of the server, to send back
     */
    contextId?: Buffer
}

/**
 * The virtual list view response control
 */
export const VLVResponseControl: ControlCodec<VLVResponseValue> = define<VLVResponseValue>('2.16.840.1.113730.3.4.10', 'virtual list view response',
    (value: VLVResponseValue): Buffer => serialize(constructed(BerTag.sequence, [integer(value.targetPosition), integer(value.contentCount), enumerated(value.result), value.contextId === undefined ? undefined : octets(value.contextId)])),
    (value: Buffer | undefined): VLVResponseValue => {
        const reader: BerReader = sequence(value)
        const result: VLVResponseValue = {targetPosition: reader.integer(), contentCount: reader.integer(), result: reader.enumerated()}
        if (reader.peek() === BerTag.octetString) result.contextId = reader.octets()
        return result
    })

/**
 * A control without a value
 * @param oid The OID.
 * @param name The name.
 */
function flag(oid: string, name: string): ControlCodec<void> {
    return define<void>(oid, name, (): undefined => undefined, (): void => undefined)
}

/**
 * The tree delete control (draft-armijo-ldap-treedelete): a delete request removes the whole subtree
 */
export const TreeDeleteControl: ControlCodec<void> = flag('1.2.840.113556.1.4.805', 'tree delete')

/**
 * The ManageDsaIT control (RFC 3296): the referral objects are entries like the others
 */
export const ManageDsaITControl: ControlCodec<void> = flag('2.16.840.1.113730.3.4.2', 'ManageDsaIT')

/**
 * The password policy request control (draft-behera-ldap-password-policy): ask for the password policy response
 * control. It has no value.
 */
export const PasswordPolicyRequestControl: ControlCodec<void> = flag('1.3.6.1.4.1.42.2.27.8.5.1', 'password policy request')

/**
 * The errors of the password policy response control
 */
export type PasswordPolicyError = 'passwordExpired' | 'accountLocked' | 'changeAfterReset' | 'passwordModNotAllowed' | 'mustSupplyOldPassword' | 'insufficientPasswordQuality' | 'passwordTooShort' | 'passwordTooYoung' | 'passwordInHistory' | 'passwordTooLong'

const PASSWORD_POLICY_ERRORS: PasswordPolicyError[] = ['passwordExpired', 'accountLocked', 'changeAfterReset', 'passwordModNotAllowed', 'mustSupplyOldPassword', 'insufficientPasswordQuality', 'passwordTooShort', 'passwordTooYoung', 'passwordInHistory', 'passwordTooLong']

/**
 * The value of the password policy response control: a warning (the seconds before the password expires, or the
 * logins left after it expired) and an error
 */
export interface PasswordPolicyValue {
    /**
     * The seconds before the password expires
     */
    timeBeforeExpiration?: number
    /**
     * The logins left with the expired password
     */
    graceAuthNsRemaining?: number
    /**
     * Why the operation failed
     */
    error?: PasswordPolicyError
}

/**
 * The password policy response control (draft-behera-ldap-password-policy). The request control shares its OID; its
 * codec is `PasswordPolicyRequestControl`.
 */
export const PasswordPolicyResponseControl: ControlCodec<PasswordPolicyValue> = define<PasswordPolicyValue>('1.3.6.1.4.1.42.2.27.8.5.1', 'password policy response',
    (value: PasswordPolicyValue): Buffer => {
        let warning: BerElement | undefined
        if (value.timeBeforeExpiration !== undefined) warning = constructed(CONTEXT | CONSTRUCTED | 0, [integer(value.timeBeforeExpiration, CONTEXT | 0)])
        else if (value.graceAuthNsRemaining !== undefined) warning = constructed(CONTEXT | CONSTRUCTED | 0, [integer(value.graceAuthNsRemaining, CONTEXT | 1)])
        return serialize(constructed(BerTag.sequence, [warning, value.error === undefined ? undefined : enumerated(PASSWORD_POLICY_ERRORS.indexOf(value.error), CONTEXT | 1)]))
    },
    (value: Buffer | undefined): PasswordPolicyValue => {
        const reader: BerReader = sequence(value)
        const result: PasswordPolicyValue = {}
        if (reader.peek() === (CONTEXT | CONSTRUCTED | 0)) {
            const warning: BerReader = reader.enter(CONTEXT | CONSTRUCTED | 0)
            if (warning.peek() === (CONTEXT | 0)) result.timeBeforeExpiration = warning.integer(CONTEXT | 0)
            else result.graceAuthNsRemaining = warning.integer(CONTEXT | 1)
        }
        if (reader.peek() === (CONTEXT | 1)) {
            const index: number = reader.enumerated(CONTEXT | 1)
            const error: PasswordPolicyError | undefined = PASSWORD_POLICY_ERRORS[index]
            if (error === undefined) throw new Error(`${index} is not a password policy error`)
            result.error = error
        }
        return result
    })

/**
 * The assertion control (RFC 4528): the operation runs only if the filter is true on its entry, and fails with
 * `assertionFailed` otherwise
 */
export const AssertionControl: ControlCodec<Filter> = define<Filter>('1.3.6.1.1.12', 'assertion',
    (filter: Filter): Buffer => serialize(filterElement(filter)),
    (value: Buffer | undefined): Filter => {
        const reader: BerReader = new BerReader(required(value))
        const filter: Filter = readFilter(reader)
        if (!reader.atEnd()) throw new Error('Bytes after the filter')
        return filter
    })

/**
 * The read entry controls' request (RFC 4527): the attributes of the entry to return
 * @param oid The OID.
 * @param name The name.
 */
function readRequest(oid: string, name: string): ControlCodec<string[]> {
    return define<string[]>(oid, name,
        (attributes: string[]): Buffer => serialize(constructed(BerTag.sequence, attributes.map((attribute: string): BerElement => octets(attribute)))),
        (value: Buffer | undefined): string[] => {
            const reader: BerReader = sequence(value)
            const attributes: string[] = []
            while (!reader.atEnd()) attributes.push(reader.string())
            return attributes
        })
}

/**
 * The value of the read entry response controls (RFC 4527): the entry as it was before the operation, or as it is
 * after it
 */
export interface ReadEntryValue {
    /**
     * The DN of the entry
     */
    objectName: string
    /**
     * Its attributes
     */
    attributes: PartialAttribute[]
}

/**
 * The read entry controls' response
 * @param oid The OID.
 * @param name The name.
 */
function readResponse(oid: string, name: string): ControlCodec<ReadEntryValue> {
    const tag: number = tagOfOperation('searchResultEntry')
    return define<ReadEntryValue>(oid, name,
        (entry: ReadEntryValue): Buffer => serialize(operationElement({type: 'searchResultEntry', objectName: entry.objectName, attributes: entry.attributes})),
        (value: Buffer | undefined): ReadEntryValue => {
            const reader: BerReader = new BerReader(required(value))
            const entry: SearchResultEntry = readOperation('searchResultEntry', tag, reader) as SearchResultEntry
            return {objectName: entry.objectName, attributes: entry.attributes}
        })
}

/**
 * The pre-read request control (RFC 4527): return the entry as it was before a modify, a delete or a modify DN
 */
export const PreReadRequestControl: ControlCodec<string[]> = readRequest('1.3.6.1.1.13.1', 'pre-read request')

/**
 * The post-read request control (RFC 4527): return the entry as it is after an add, a modify or a modify DN
 */
export const PostReadRequestControl: ControlCodec<string[]> = readRequest('1.3.6.1.1.13.2', 'post-read request')

/**
 * The pre-read response control (RFC 4527)
 */
export const PreReadResponseControl: ControlCodec<ReadEntryValue> = readResponse('1.3.6.1.1.13.1', 'pre-read response')

/**
 * The post-read response control (RFC 4527)
 */
export const PostReadResponseControl: ControlCodec<ReadEntryValue> = readResponse('1.3.6.1.1.13.2', 'post-read response')

/**
 * The proxied authorization control (RFC 4370, version 2): run the operation as another identity, given as an authzId
 * (`dn:uid=alice,dc=example,dc=com` or `u:alice`; empty for the anonymous one). It must be critical.
 */
export const ProxiedAuthorizationControl: ControlCodec<string> = define<string>('2.16.840.1.113730.3.4.18', 'proxied authorization',
    (authzId: string): Buffer => Buffer.from(authzId, 'utf8'),
    (value: Buffer | undefined): string => decodeUTF8(required(value)))

/**
 * The kinds of change of a persistent search, as the bits of `changeTypes`
 */
export const PersistentSearchChange = {
    add: 1,
    delete: 2,
    modify: 4,
    modifyDN: 8
} as const

/**
 * The value of the persistent search control: the changes to report, whether to skip the entries matching now, and
 * whether to attach the entry change notification control
 */
export interface PersistentSearchValue {
    /**
     * The changes to report, as the bits of `PersistentSearchChange`
     */
    changeTypes: number
    /**
     * Whether only the changes are reported, not the entries matching when the search starts
     */
    changesOnly: boolean
    /**
     * Whether each entry reported carries the entry change notification control
     */
    returnECs: boolean
}

/**
 * The persistent search control (draft-ietf-ldapext-psearch): a search that does not end and reports the changes
 */
export const PersistentSearchControl: ControlCodec<PersistentSearchValue> = define<PersistentSearchValue>('2.16.840.1.113730.3.4.3', 'persistent search',
    (value: PersistentSearchValue): Buffer => serialize(constructed(BerTag.sequence, [integer(value.changeTypes), boolean(value.changesOnly), boolean(value.returnECs)])),
    (value: Buffer | undefined): PersistentSearchValue => {
        const reader: BerReader = sequence(value)
        return {changeTypes: reader.integer(), changesOnly: reader.boolean(), returnECs: reader.boolean()}
    })

/**
 * The value of the entry change notification control: the change, the DN before a modify DN, and the change number
 */
export interface EntryChangeValue {
    /**
     * The change, one of the bits of `PersistentSearchChange`
     */
    changeType: number
    /**
     * The DN of the entry before a modify DN
     */
    previousDN?: string
    /**
     * The number of the change
     */
    changeNumber?: number
}

/**
 * The entry change notification control (draft-ietf-ldapext-psearch), on the entries of a persistent search
 */
export const EntryChangeNotificationControl: ControlCodec<EntryChangeValue> = define<EntryChangeValue>('2.16.840.1.113730.3.4.7', 'entry change notification',
    (value: EntryChangeValue): Buffer => serialize(constructed(BerTag.sequence, [enumerated(value.changeType), value.previousDN === undefined ? undefined : octets(value.previousDN), value.changeNumber === undefined ? undefined : integer(value.changeNumber)])),
    (value: Buffer | undefined): EntryChangeValue => {
        const reader: BerReader = sequence(value)
        const result: EntryChangeValue = {changeType: reader.enumerated()}
        if (reader.peek() === BerTag.octetString) result.previousDN = reader.string()
        if (reader.peek() === BerTag.integer) result.changeNumber = reader.integer()
        return result
    })

/**
 * The value of the sync request control (RFC 4533): refresh only, or refresh and persist, from a cookie
 */
export interface SyncRequestValue {
    /**
     * The mode
     */
    mode: 'refreshOnly' | 'refreshAndPersist'
    /**
     * The cookie of the last synchronization
     */
    cookie?: Buffer
    /**
     * Whether the client asks for a full reload when the server cannot send the changes only
     */
    reloadHint?: boolean
}

/**
 * The sync request control (RFC 4533, content synchronization)
 */
export const SyncRequestControl: ControlCodec<SyncRequestValue> = define<SyncRequestValue>('1.3.6.1.4.1.4203.1.9.1.1', 'sync request',
    (value: SyncRequestValue): Buffer => serialize(constructed(BerTag.sequence, [enumerated(value.mode === 'refreshOnly' ? 1 : 3), value.cookie === undefined ? undefined : octets(value.cookie), value.reloadHint ? boolean(true) : undefined])),
    (value: Buffer | undefined): SyncRequestValue => {
        const reader: BerReader = sequence(value)
        const mode: number = reader.enumerated()
        if (mode !== 1 && mode !== 3) throw new Error(`${mode} is not a sync mode`)
        const result: SyncRequestValue = {mode: mode === 1 ? 'refreshOnly' : 'refreshAndPersist'}
        if (reader.peek() === BerTag.octetString) result.cookie = reader.octets()
        if (reader.peek() === BerTag.boolean) result.reloadHint = reader.boolean()
        return result
    })

const SYNC_STATES: SyncStateValue['state'][] = ['present', 'add', 'modify', 'delete']

/**
 * The value of the sync state control (RFC 4533), on the entries of a synchronization
 */
export interface SyncStateValue {
    /**
     * What happened to the entry
     */
    state: 'present' | 'add' | 'modify' | 'delete'
    /**
     * The entryUUID of the entry (16 bytes)
     */
    entryUUID: Buffer
    /**
     * The cookie after this entry
     */
    cookie?: Buffer
}

/**
 * The sync state control (RFC 4533)
 */
export const SyncStateControl: ControlCodec<SyncStateValue> = define<SyncStateValue>('1.3.6.1.4.1.4203.1.9.1.2', 'sync state',
    (value: SyncStateValue): Buffer => serialize(constructed(BerTag.sequence, [enumerated(SYNC_STATES.indexOf(value.state)), octets(value.entryUUID), value.cookie === undefined ? undefined : octets(value.cookie)])),
    (value: Buffer | undefined): SyncStateValue => {
        const reader: BerReader = sequence(value)
        const index: number = reader.enumerated()
        const state: SyncStateValue['state'] | undefined = SYNC_STATES[index]
        if (state === undefined) throw new Error(`${index} is not a sync state`)
        const result: SyncStateValue = {state: state, entryUUID: reader.octets()}
        if (reader.peek() === BerTag.octetString) result.cookie = reader.octets()
        return result
    })

/**
 * The value of the sync done control (RFC 4533), at the end of a refresh
 */
export interface SyncDoneValue {
    /**
     * The cookie to send next time
     */
    cookie?: Buffer
    /**
     * Whether the deleted entries were reported as deletes rather than by the present ones
     */
    refreshDeletes?: boolean
}

/**
 * The sync done control (RFC 4533)
 */
export const SyncDoneControl: ControlCodec<SyncDoneValue> = define<SyncDoneValue>('1.3.6.1.4.1.4203.1.9.1.3', 'sync done',
    (value: SyncDoneValue): Buffer => serialize(constructed(BerTag.sequence, [value.cookie === undefined ? undefined : octets(value.cookie), value.refreshDeletes ? boolean(true) : undefined])),
    (value: Buffer | undefined): SyncDoneValue => {
        const reader: BerReader = sequence(value)
        const result: SyncDoneValue = {}
        if (reader.peek() === BerTag.octetString) result.cookie = reader.octets()
        if (reader.peek() === BerTag.boolean) result.refreshDeletes = reader.boolean()
        return result
    })

/**
 * Find a control among the controls of a message
 * @param controls The controls.
 * @param codec The codec, or the OID, of the control.
 * @example
 * ```typescript
 * import {findControl, PagedResultsControl, type Control} from '@lakutata/ldap-engine'
 *
 * const controls: Control[] = [PagedResultsControl.encode({size: 100, cookie: Buffer.alloc(0)})]
 * const paged: Control | undefined = findControl(controls, PagedResultsControl)
 * if (paged) console.log(PagedResultsControl.decode(paged).size) //100
 * ```
 */
export function findControl(controls: Control[] | undefined, codec: ControlCodec<unknown> | string): Control | undefined {
    const oid: string = typeof codec === 'string' ? codec : codec.oid
    return controls?.find((control: Control): boolean => control.oid === oid)
}
