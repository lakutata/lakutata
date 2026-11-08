import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    AssertionControl,
    CancelRequest,
    type Control,
    type ControlCodec,
    EntryChangeNotificationControl,
    Filter,
    findControl,
    LDAPDecodeException,
    ManageDsaITControl,
    PagedResultsControl,
    PasswordModifyRequest,
    PasswordModifyResponse,
    PasswordPolicyRequestControl,
    PasswordPolicyResponseControl,
    PersistentSearchChange,
    PersistentSearchControl,
    PostReadRequestControl,
    PreReadResponseControl,
    ProxiedAuthorizationControl,
    SortRequestControl,
    SortResponseControl,
    SyncDoneControl,
    SyncInfo,
    SyncRequestControl,
    SyncStateControl,
    TreeDeleteControl,
    VLVRequestControl,
    VLVResponseControl,
    WhoAmIResponse
} from '../exports/LDAPEngine.js'

/**
 * Encode a value into a control and read it back
 * @param codec The codec.
 * @param value The value.
 * @param hex The bytes of the value, when they are known.
 */
function roundTrip<T>(codec: ControlCodec<T>, value: T, hex?: string): Control {
    const control: Control = codec.encode(value, true)
    assert.equal(control.oid, codec.oid)
    assert.equal(control.critical, true)
    if (hex !== undefined) assert.equal(control.value?.toString('hex'), hex)
    assert.deepEqual(codec.decode(control), value)
    return control
}

describe('the controls', () => {
    it('paged results, its cookie always written and read when missing', () => {
        roundTrip(PagedResultsControl, {size: 5, cookie: Buffer.alloc(0)}, '300502010504' + '00')
        roundTrip(PagedResultsControl, {size: 0, cookie: Buffer.from([1, 2, 3])})
        assert.deepEqual(PagedResultsControl.decode({oid: PagedResultsControl.oid, critical: false, value: Buffer.from('3003020105', 'hex')}), {size: 5, cookie: Buffer.alloc(0)})
    })

    it('server side sort, request and response', () => {
        roundTrip(SortRequestControl, [{attribute: 'cn'}, {attribute: 'sn', orderingRule: 'caseIgnoreOrderingMatch', reverse: true}])
        roundTrip(SortResponseControl, {result: 0})
        roundTrip(SortResponseControl, {result: 18, attribute: 'jpegPhoto'})
    })

    it('virtual list view, by offset and by value', () => {
        roundTrip(VLVRequestControl, {beforeCount: 0, afterCount: 19, offset: {offset: 1, contentCount: 0}})
        roundTrip(VLVRequestControl, {beforeCount: 2, afterCount: 2, greaterThanOrEqual: Buffer.from('M'), contextId: Buffer.from([9])})
        roundTrip(VLVResponseControl, {targetPosition: 1, contentCount: 250, result: 0})
        roundTrip(VLVResponseControl, {targetPosition: 3, contentCount: 7, result: 61, contextId: Buffer.from('ctx')})
    })

    it('without a value: tree delete, ManageDsaIT, the password policy request', () => {
        for (const codec of [TreeDeleteControl, ManageDsaITControl, PasswordPolicyRequestControl]) {
            const control: Control = codec.encode(undefined, false)
            assert.equal(control.value, undefined)
            assert.equal(control.critical, false)
        }
        assert.equal(TreeDeleteControl.oid, '1.2.840.113556.1.4.805')
    })

    it('password policy response, its warnings and its errors', () => {
        roundTrip(PasswordPolicyResponseControl, {timeBeforeExpiration: 3600}, '3006a00480020e10')
        roundTrip(PasswordPolicyResponseControl, {graceAuthNsRemaining: 2}, '3005a003810102')
        roundTrip(PasswordPolicyResponseControl, {error: 'accountLocked'}, '3003810101')
        roundTrip(PasswordPolicyResponseControl, {})
    })

    it('assertion, read entry, proxied authorization', () => {
        roundTrip(AssertionControl, Filter.and(Filter.equal('objectClass', 'person'), Filter.present('mail')))
        roundTrip(PostReadRequestControl, ['entryUUID', 'modifyTimestamp'])
        roundTrip(PreReadResponseControl, {objectName: 'cn=x', attributes: [{type: 'cn', values: [Buffer.from('x')]}]})
        roundTrip(ProxiedAuthorizationControl, 'dn:uid=alice,dc=example,dc=com', Buffer.from('dn:uid=alice,dc=example,dc=com').toString('hex'))
        roundTrip(ProxiedAuthorizationControl, '')
    })

    it('persistent search and content synchronization', () => {
        roundTrip(PersistentSearchControl, {changeTypes: PersistentSearchChange.add | PersistentSearchChange.modify, changesOnly: true, returnECs: true})
        roundTrip(EntryChangeNotificationControl, {changeType: PersistentSearchChange.modifyDN, previousDN: 'cn=old', changeNumber: 42})
        roundTrip(SyncRequestControl, {mode: 'refreshAndPersist', cookie: Buffer.from('c'), reloadHint: true})
        roundTrip(SyncRequestControl, {mode: 'refreshOnly'})
        roundTrip(SyncStateControl, {state: 'modify', entryUUID: Buffer.alloc(16, 1), cookie: Buffer.from('c')})
        roundTrip(SyncDoneControl, {cookie: Buffer.from('c'), refreshDeletes: true})
        roundTrip(SyncDoneControl, {})
    })

    it('refuse a value that is not theirs, or that cannot be read', () => {
        assert.throws(() => PagedResultsControl.decode({oid: '1.2.3', critical: false, value: Buffer.alloc(0)}), LDAPDecodeException)
        assert.throws(() => PagedResultsControl.decode({oid: PagedResultsControl.oid, critical: false}), LDAPDecodeException)
        assert.throws(() => PagedResultsControl.decode({oid: PagedResultsControl.oid, critical: false, value: Buffer.from('0400', 'hex')}), LDAPDecodeException)
        assert.throws(() => PasswordPolicyResponseControl.decode({oid: PasswordPolicyResponseControl.oid, critical: false, value: Buffer.from('3003810163', 'hex')}), LDAPDecodeException)
    })

    it('are found among the controls of a message', () => {
        const controls: Control[] = [TreeDeleteControl.encode(), PagedResultsControl.encode({size: 10, cookie: Buffer.alloc(0)})]
        assert.equal(findControl(controls, PagedResultsControl)?.oid, PagedResultsControl.oid)
        assert.equal(findControl(controls, '1.2.840.113556.1.4.805')?.oid, TreeDeleteControl.oid)
        assert.equal(findControl(undefined, TreeDeleteControl), undefined)
    })
})

describe('the values of the extended operations', () => {
    it('Password Modify, request and response, an empty request included', () => {
        const request: Buffer = PasswordModifyRequest.encode({userIdentity: 'uid=alice,dc=example,dc=com', oldPassword: Buffer.from('old'), newPassword: Buffer.from('new')})
        assert.deepEqual(PasswordModifyRequest.decode(request), {userIdentity: 'uid=alice,dc=example,dc=com', oldPassword: Buffer.from('old'), newPassword: Buffer.from('new')})
        assert.equal(PasswordModifyRequest.encode({}).toString('hex'), '3000')
        assert.deepEqual(PasswordModifyRequest.decode(Buffer.alloc(0)), {})
        assert.deepEqual(PasswordModifyResponse.decode(PasswordModifyResponse.encode({generatedPassword: Buffer.from('gen')})), {generatedPassword: Buffer.from('gen')})
        assert.deepEqual(PasswordModifyResponse.decode(Buffer.from('3000', 'hex')), {})
    })

    it('Cancel, Who Am I, sync info', () => {
        assert.equal(CancelRequest.decode(CancelRequest.encode(7)), 7)
        assert.equal(WhoAmIResponse.decode(WhoAmIResponse.encode('dn:cn=admin')), 'dn:cn=admin')
        assert.deepEqual(SyncInfo.decode(SyncInfo.encode({type: 'newCookie', cookie: Buffer.from('c')})), {type: 'newCookie', cookie: Buffer.from('c')})
        assert.deepEqual(SyncInfo.decode(SyncInfo.encode({type: 'refreshDelete', cookie: Buffer.from('c')})), {type: 'refreshDelete', cookie: Buffer.from('c'), refreshDone: true})
        assert.deepEqual(SyncInfo.decode(SyncInfo.encode({type: 'refreshPresent', refreshDone: false})), {type: 'refreshPresent', refreshDone: false})
        assert.deepEqual(SyncInfo.decode(SyncInfo.encode({type: 'syncIdSet', refreshDeletes: true, syncUUIDs: [Buffer.alloc(16, 2)]})), {type: 'syncIdSet', refreshDeletes: true, syncUUIDs: [Buffer.alloc(16, 2)]})
        assert.throws(() => CancelRequest.decode(Buffer.from('0400', 'hex')), LDAPDecodeException)
    })
})
