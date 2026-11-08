import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {BerReader, serialize} from '../lib/ber/Ber.js'
import {filterElement, readFilter} from '../lib/filter/Filter.js'
import {CancelRequest, decodeMessage, encodeMessage, ExtendedOperation, Filter, type LDAPMessage, PasswordModifyRequest, ResultCode} from '../exports/LDAPEngine.js'
import {LDAPJS_EVOLUTION_FILTER, LDAPJS_MESSAGES} from './support/LdapjsFixtures.js'

/**
 * Decode a fixture
 * @param name Its name.
 */
function message(name: string): LDAPMessage {
    return decodeMessage(Buffer.from(LDAPJS_MESSAGES[name], 'hex'))
}

describe('the fixtures of ldapjs', () => {
    it('decode, and encode again byte for byte, all of them', () => {
        for (const [name, hex] of Object.entries(LDAPJS_MESSAGES)) assert.equal(encodeMessage(decodeMessage(Buffer.from(hex, 'hex'))).toString('hex'), hex, name)
    })

    it('hold what the wire protocol reference says', () => {
        assert.deepEqual(message('abandonRequest'), {messageId: 6, protocolOp: {type: 'abandonRequest', messageId: 5}})
        const noSuchObject: LDAPMessage = message('addResponseNoSuchObject')
        assert.ok(noSuchObject.protocolOp.type === 'addResponse' && noSuchObject.protocolOp.resultCode === ResultCode.noSuchObject && noSuchObject.protocolOp.matchedDN === 'ou=People, dc=example, dc=com')
        const referrals: LDAPMessage = message('addResponseReferrals')
        assert.ok(referrals.protocolOp.type === 'addResponse' && referrals.protocolOp.resultCode === ResultCode.referral && referrals.protocolOp.referral?.length === 2)
        const bind: LDAPMessage = message('bindRequest')
        assert.ok(bind.protocolOp.type === 'bindRequest' && bind.protocolOp.version === 3 && bind.protocolOp.authentication.type === 'simple')
        const startTLS: LDAPMessage = message('extenstionStartTLSRequest')
        assert.ok(startTLS.protocolOp.type === 'extendedRequest' && startTLS.protocolOp.name === ExtendedOperation.startTLS && startTLS.protocolOp.value === undefined)
        const whoAmI: LDAPMessage = message('extensionWhoAmIRequest')
        assert.ok(whoAmI.protocolOp.type === 'extendedRequest' && whoAmI.protocolOp.name === ExtendedOperation.whoAmI)
        const disconnection: LDAPMessage = message('extensionDisconnectionNotificationResponse')
        assert.ok(disconnection.messageId === 0 && disconnection.protocolOp.type === 'extendedResponse' && disconnection.protocolOp.name === ExtendedOperation.noticeOfDisconnection)
    })

    it('carry the values of the extended operations the codecs read', () => {
        const change: LDAPMessage = message('extensionChangePasswordRequest')
        assert.ok(change.protocolOp.type === 'extendedRequest' && change.protocolOp.name === ExtendedOperation.passwordModify)
        //Without a new password: the server generates one
        assert.deepEqual(PasswordModifyRequest.decode(change.protocolOp.value!), {userIdentity: 'uid=jdoe,ou=People,dc=example,dc=com', oldPassword: Buffer.from('secret123')})
        const withNew: LDAPMessage = message('extensionChangePasswordWithNewPassword')
        assert.ok(withNew.protocolOp.type === 'extendedRequest' && PasswordModifyRequest.decode(withNew.protocolOp.value!).newPassword !== undefined)
        const cancel: LDAPMessage = message('extensionCancelRequest')
        assert.ok(cancel.protocolOp.type === 'extendedRequest' && cancel.protocolOp.name === ExtendedOperation.cancel)
        assert.equal(typeof CancelRequest.decode(cancel.protocolOp.value!), 'number')
    })

    it('read the filter of the Evolution mail client, and write it back, as BER and as text', () => {
        const bytes: Buffer = Buffer.from(LDAPJS_EVOLUTION_FILTER.hex, 'hex')
        const filter: Filter = readFilter(new BerReader(bytes))
        assert.equal(Filter.stringify(filter), LDAPJS_EVOLUTION_FILTER.text)
        assert.equal(serialize(filterElement(Filter.parse(LDAPJS_EVOLUTION_FILTER.text))).toString('hex'), LDAPJS_EVOLUTION_FILTER.hex)
    })
})
