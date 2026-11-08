//Derived from the tests of the DN parser of ldapjs, @ldapjs/dn lib/utils/parse-string/index.test.js (see
//THIRD_PARTY_NOTICES.md; MIT): the examples of RFC 4514 §4 and RFC 2253 §5 and the cases ldapjs checks.
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {type AttributeTypeAndValue, DN, LDAPDNSyntaxException, type RDN} from '../exports/LDAPEngine.js'

/**
 * The attributes of the RDNs of a DN, as ldapjs gives them: one object for each RDN
 * @param text The DN.
 */
function parse(text: string): Record<string, string>[] {
    return DN.parse(text).rdns.map((rdn: RDN): Record<string, string> => Object.fromEntries(rdn.attributes.map((attribute: AttributeTypeAndValue): [string, string] => [attribute.type, attribute.value])))
}

describe('the DN cases of ldapjs', () => {
    it('parse the root, single and multiple RDNs, leading and trailing whitespace', () => {
        assert.deepEqual(parse(''), [])
        assert.deepEqual(parse('cn=foo'), [{cn: 'foo'}])
        assert.deepEqual(parse('   cn=foo'), [{cn: 'foo'}])
        assert.deepEqual(parse('dc=example,dc=com'), [{dc: 'example'}, {dc: 'com'}])
        assert.deepEqual(parse('dc=example;dc=com'), [{dc: 'example'}, {dc: 'com'}])
        assert.deepEqual(parse('foo=bar+baz=bif'), [{foo: 'bar', baz: 'bif'}])
        assert.deepEqual(parse('foo=bar   '), [{foo: 'bar'}])
        assert.deepEqual(parse('0.9.2342.19200300.100.1.25=Example'), [{'0.9.2342.19200300.100.1.25': 'Example'}])
    })

    it('refuse the strings ending abruptly and the invalid attribute types', () => {
        for (const text of ['foo=bar+', 'foo=bar,', 'foo=bar;', '3foo=bar', '1.2.3.abc=bar', 'føø=bar']) assert.throws(() => DN.parse(text), LDAPDNSyntaxException, text)
    })

    it('parse the examples of RFC 4514 §4', () => {
        assert.deepEqual(parse('UID=jsmith,DC=example,DC=net'), [{UID: 'jsmith'}, {DC: 'example'}, {DC: 'net'}])
        assert.deepEqual(parse('OU=Sales+CN=J.  Smith,DC=example,DC=net'), [{OU: 'Sales', CN: 'J.  Smith'}, {DC: 'example'}, {DC: 'net'}])
        assert.deepEqual(parse('CN=James \\"Jim\\" Smith\\, III,DC=example,DC=net'), [{CN: 'James "Jim" Smith, III'}, {DC: 'example'}, {DC: 'net'}])
        assert.deepEqual(parse('CN=Before\\0dAfter,DC=example,DC=net'), [{CN: 'Before\rAfter'}, {DC: 'example'}, {DC: 'net'}])
        assert.deepEqual(DN.parse('1.3.6.1.4.1.1466.0=#04024869').rdns[0].attributes[0].binary, Buffer.from([0x04, 0x02, 0x48, 0x69]))
        assert.deepEqual(parse('CN=Lu\\C4\\8Di\\C4\\87'), [{CN: 'Lučić'}])
    })

    it('parse the examples of RFC 2253 §5', () => {
        assert.deepEqual(parse('CN=Steve Kille,O=Isode Limited,C=GB'), [{CN: 'Steve Kille'}, {O: 'Isode Limited'}, {C: 'GB'}])
        assert.deepEqual(parse('OU=Sales+CN=J. Smith,O=Widget Inc.,C=US'), [{OU: 'Sales', CN: 'J. Smith'}, {O: 'Widget Inc.'}, {C: 'US'}])
        assert.deepEqual(parse('CN=L. Eagle,O=Sue\\, Grabbit and Runn,C=GB'), [{CN: 'L. Eagle'}, {O: 'Sue, Grabbit and Runn'}, {C: 'GB'}])
        assert.deepEqual(parse('CN=Before\\0DAfter,O=Test,C=GB'), [{CN: 'Before\rAfter'}, {O: 'Test'}, {C: 'GB'}])
        const hex: DN = DN.parse('1.3.6.1.4.1.1466.0=#04024869,O=Test,C=GB')
        assert.deepEqual(hex.rdns[0].attributes[0].binary, Buffer.from([0x04, 0x02, 0x48, 0x69]))
        assert.deepEqual(parse('O=Test,C=GB'), [{O: 'Test'}, {C: 'GB'}])
        assert.deepEqual(parse('SN=Lu\\C4\\8Di\\C4\\87'), [{SN: 'Lučić'}])
    })

    it('refuse the RFC 2253 separator when strict', () => {
        assert.throws(() => DN.parse('dc=example;dc=com', {strict: true}), LDAPDNSyntaxException)
    })
})
