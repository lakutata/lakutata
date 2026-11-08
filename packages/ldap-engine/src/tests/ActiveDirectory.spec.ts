import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    adPasswordValue,
    fileTimeToDate,
    Filter,
    guidToString,
    LDAPUsageException,
    parseLDAPURL,
    parseUserAccountControl,
    sidToString,
    stringToGuid,
    stringToSid
} from '../exports/LDAPEngine.js'

describe('the helpers of Active Directory', () => {
    it('turn an objectGUID into its text and back, the first fields little-endian', () => {
        const bytes: Buffer = Buffer.from('fd18213ba6c4fd4f9a8e7cfa3f2a0f11', 'hex')
        assert.equal(guidToString(bytes), '3b2118fd-c4a6-4ffd-9a8e-7cfa3f2a0f11')
        assert.deepEqual(stringToGuid('{3B2118FD-C4A6-4FFD-9A8E-7CFA3F2A0F11}'), bytes)
        assert.equal(Filter.stringify(Filter.equal('objectGUID', bytes)), '(objectGUID=\\fd\\18!;\\a6\\c4\\fdO\\9a\\8e|\\fa?\\2a\\0f\\11)')
        assert.throws(() => guidToString(Buffer.alloc(15)), LDAPUsageException)
        assert.throws(() => stringToGuid('not a guid'), LDAPUsageException)
    })

    it('turn a security identifier into its text and back', () => {
        for (const text of ['S-1-5-21-3623811015-3361044348-30300820-1013', 'S-1-5-32-544', 'S-1-1-0', 'S-1-5-18']) assert.equal(sidToString(stringToSid(text)), text)
        assert.equal(stringToSid('S-1-5-32-544').toString('hex'), '01020000000000052000000020020000')
        assert.throws(() => sidToString(Buffer.from([1, 2, 0])), LDAPUsageException)
    })

    it('read userAccountControl, FILETIMEs and write unicodePwd', () => {
        const flags = parseUserAccountControl('66050')
        assert.deepEqual([flags.accountDisable, flags.normalAccount, flags.dontExpirePassword, flags.lockout], [true, true, true, false])
        assert.equal(fileTimeToDate('0'), undefined)
        assert.equal(fileTimeToDate('9223372036854775807'), undefined)
        assert.equal(fileTimeToDate('116444736000000000')?.getTime(), 0)
        assert.equal(fileTimeToDate(133800000000000000n)?.toISOString(), '2024-12-30T02:40:00.000Z')
        assert.equal(adPasswordValue('pässword').toString('utf16le'), '"pässword"')
    })
})

describe('the LDAP URLs', () => {
    it('give the scheme, the host, the port and the search of RFC 4516', () => {
        assert.deepEqual(parseLDAPURL('ldap://ldap.example.com'), {scheme: 'ldap', host: 'ldap.example.com', port: 389})
        assert.deepEqual(parseLDAPURL('ldaps://[::1]:6360'), {scheme: 'ldaps', host: '::1', port: 6360})
        assert.deepEqual(parseLDAPURL('ldapi://%2Fvar%2Frun%2Fslapd%2Fldapi'), {scheme: 'ldapi', host: '', port: 0, path: '/var/run/slapd/ldapi'})
        assert.deepEqual(parseLDAPURL('ldap://host/dc=example,dc=com?cn,mail?sub?(uid=alice)'), {scheme: 'ldap', host: 'host', port: 389, dn: 'dc=example,dc=com', attributes: ['cn', 'mail'], scope: 'sub', filter: '(uid=alice)'})
        assert.deepEqual(parseLDAPURL('LDAP:///o=University%20of%20Michigan,c=US'), {scheme: 'ldap', host: 'localhost', port: 389, dn: 'o=University of Michigan,c=US'})
        assert.throws(() => parseLDAPURL('http://example.com'), LDAPUsageException)
        assert.throws(() => parseLDAPURL('ldap://host/dc=x??wide'), LDAPUsageException)
    })
})
