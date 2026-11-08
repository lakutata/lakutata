import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {DN, escapeDNValue, LDAPDNSyntaxException, RDN, Schema} from '../exports/LDAPEngine.js'

describe('the DNs', () => {
    it('parse the examples of RFC 4514 and write them back', () => {
        const cases: [string, string][] = [
            ['UID=jsmith,DC=example,DC=net', 'UID=jsmith,DC=example,DC=net'],
            ['OU=Sales+CN=J.  Smith,DC=example,DC=net', 'OU=Sales+CN=J.  Smith,DC=example,DC=net'],
            ['CN=James \\"Jim\\" Smith\\, III,DC=example,DC=net', 'CN=James \\"Jim\\" Smith\\, III,DC=example,DC=net'],
            ['CN=Before\\0dAfter,DC=example,DC=net', 'CN=Before\\0dAfter,DC=example,DC=net'],
            ['1.3.6.1.4.1.1466.0=#04024869', '1.3.6.1.4.1.1466.0=#04024869'],
            ['CN=Lu\\C4\\8Di\\C4\\87', 'CN=Lučić'],
            ['', '']
        ]
        for (const [text, written] of cases) assert.equal(DN.parse(text).toString(), written, text)
        assert.equal(DN.parse('1.3.6.1.4.1.1466.0=#04024869').rdn()?.attributes[0].value, 'Hi')
    })

    it('escape what RFC 4514 says, leading and trailing spaces and # included', () => {
        assert.equal(escapeDNValue(' #a,b+c;d<e>f"g\\h '), '\\ #a\\,b\\+c\\;d\\<e\\>f\\"g\\\\h\\ ')
        assert.equal(escapeDNValue('#a'), '\\#a')
        assert.equal(escapeDNValue('a\0b'), 'a\\00b')
        const dn: DN = new DN([new RDN([{type: 'cn', value: ' Liu, Alice '}])])
        assert.equal(DN.parse(dn.toString()).rdn()?.get('cn'), ' Liu, Alice ')
    })

    it('accept the spaces around the separators unless they are strict', () => {
        assert.equal(DN.parse('cn=a , dc=example,  dc=com').toString(), 'cn=a,dc=example,dc=com')
        assert.equal(DN.parse('cn = a,dc = b').toString(), 'cn=a,dc=b')
        assert.equal(DN.parse('OID.2.5.4.3=a').toString(), '2.5.4.3=a')
        assert.throws(() => DN.parse('cn=a, dc=b', {strict: true}), LDAPDNSyntaxException)
        assert.throws(() => DN.parse('cn=a ,dc=b', {strict: true}), LDAPDNSyntaxException)
        assert.equal(DN.parse('cn=a\\ ,dc=b', {strict: true}).rdn()?.get('cn'), 'a ')
    })

    it('refuse what is not a DN', () => {
        for (const text of ['cn', 'cn=a,', '=a', 'cn=a,=b', 'c n=a', '1cn=a', 'cn=#abc', 'cn=#zz', 'cn=a\\', 'cn=a\\x', 'cn=\\c3', 'cn=a+', 'cn=a,,dc=b']) {
            assert.throws(() => DN.parse(text), LDAPDNSyntaxException, text)
            assert.equal(DN.isValid(text), false, text)
        }
    })

    it('compare by their normalized form: types and values without case, spaces collapsed, RDN attributes in any order', () => {
        const dn: DN = DN.parse('UID=Alice,OU=People,DC=Example,DC=COM')
        assert.ok(dn.equals('uid=alice,ou=people,dc=example,dc=com'))
        assert.ok(DN.parse('cn=John  Smith').equals('cn=john smith'))
        assert.ok(DN.parse('cn=a+uid=b,dc=c').equals('uid=b+cn=a,dc=c'))
        assert.ok(!dn.equals('uid=alice,ou=people,dc=example'))
        assert.ok(DN.parse('cn=\\41lice').equals('cn=alice'))
    })

    it('compare with a schema: the names of a type made one, the values by their equality rule', () => {
        const schema: Schema = new Schema().load([
            'attributetype ( 2.5.4.41 NAME \'name\' EQUALITY caseIgnoreMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )',
            'attributetype ( 2.5.4.3 NAME ( \'cn\' \'commonName\' ) SUP name )',
            'attributetype ( 1.2.3.4 NAME \'exact\' EQUALITY caseExactMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )'
        ].join('\n'))
        assert.ok(DN.parse('commonName=Alice').equals('CN=alice', schema))
        assert.ok(DN.parse('2.5.4.3=Alice').equals('cn=alice', schema))
        assert.ok(!DN.parse('exact=Alice').equals('exact=alice', schema))
        assert.ok(DN.parse('exact=Alice').equals('EXACT=Alice', schema))
    })

    it('know their parents, their children and their ancestors', () => {
        const dn: DN = DN.parse('uid=alice,ou=people,dc=example,dc=com')
        assert.equal(dn.parent()?.toString(), 'ou=people,dc=example,dc=com')
        assert.equal(dn.length, 4)
        assert.ok(dn.isDescendantOf('DC=Example,DC=Com'))
        assert.ok(dn.isChildOf('ou=people,dc=example,dc=com'))
        assert.ok(!dn.isChildOf('dc=example,dc=com'))
        assert.ok(!dn.isDescendantOf(dn))
        assert.ok(dn.isDescendantOf(''))
        assert.equal(DN.parse('dc=com').child('dc=example').toString(), 'dc=example,dc=com')
        assert.equal(new DN().isRoot(), true)
        assert.equal(new DN().parent(), undefined)
    })

    it('parse an RDN and give the values of its attributes', () => {
        const rdn: RDN = RDN.parse('cn=Alice+uid=alice')
        assert.equal(rdn.get('UID'), 'alice')
        assert.equal(rdn.toString(), 'cn=Alice+uid=alice')
        assert.ok(rdn.equals('UID=ALICE+CN=alice'))
        assert.throws(() => RDN.parse('cn=a,dc=b'), LDAPDNSyntaxException)
    })
})
