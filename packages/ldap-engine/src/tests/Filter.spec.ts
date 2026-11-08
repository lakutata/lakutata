import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {BerReader, serialize} from '../lib/ber/Ber.js'
import {filterElement, readFilter} from '../lib/filter/Filter.js'
import {escapeFilterValue, filter, Filter, LDAPFilterSyntaxException} from '../exports/LDAPEngine.js'

/**
 * Parse a filter, write it back, and encode and decode it
 * @param text The text.
 * @param written The text it is written back as, when it differs.
 */
function check(text: string, written: string = text): Filter {
    const parsed: Filter = Filter.parse(text)
    assert.equal(Filter.stringify(parsed), written)
    assert.deepEqual(readFilter(new BerReader(serialize(filterElement(parsed)))), parsed)
    return parsed
}

describe('the filters', () => {
    it('parse and write back the kinds of RFC 4515', () => {
        check('(cn=Babs Jensen)')
        check('(!(cn=Tim Howes))')
        check('(&(objectClass=Person)(|(sn=Jensen)(cn=Babs J*)))')
        check('(o=univ*of*mich*)')
        check('(seeAlso=)')
        check('(cn:caseExactMatch:=Fred Flintstone)')
        check('(cn:=Betty Rubble)')
        check('(sn:dn:2.4.6.8.10:=Barney Rubble)')
        check('(o:dn:=Ace Industry)')
        check('(:1.2.3:=Wilma Flintstone)')
        check('(:DN:2.4.6.8.10:=Dino)', '(:dn:2.4.6.8.10:=Dino)')
        check('(uidNumber>=1000)')
        check('(modifyTimestamp<=20260101000000Z)')
        check('(cn~=Jensen)')
        check('(&)')
        check('(|)')
        check('(cn;lang-en=x)')
        check('(2.5.4.3=x)')
    })

    it('read the escapes and write them back, the bytes of a value that is not UTF-8 included', () => {
        assert.deepEqual(check('(o=Parens R Us \\28for all your parenthetical needs\\29)').type, 'equality')
        const star: Filter = check('(cn=*\\2A*)', '(cn=*\\2a*)')
        assert.deepEqual(star, {type: 'substrings', attribute: 'cn', any: [Buffer.from('*')]})
        const guid: Filter = check('(objectGUID=\\04\\02\\48\\c3\\fe\\a0)', '(objectGUID=\\04\\02H\\c3\\fe\\a0)')
        assert.deepEqual(guid.type === 'equality' && guid.value, Buffer.from([0x04, 0x02, 0x48, 0xc3, 0xfe, 0xa0]))
        check('(sn=Lu\\c4\\8di\\c4\\87)', '(sn=Lučić)')
        check('(1.3.6.1.4.1.1466.0=\\04\\02\\48\\69)', '(1.3.6.1.4.1.1466.0=\\04\\02Hi)')
        check('(cn=中文)')
    })

    it('tell present, equality and substrings apart', () => {
        assert.equal(Filter.parse('(cn=*)').type, 'present')
        assert.equal(Filter.parse('(cn=a)').type, 'equality')
        assert.deepEqual(Filter.parse('(cn=a*)'), {type: 'substrings', attribute: 'cn', initial: Buffer.from('a'), any: []})
        assert.deepEqual(Filter.parse('(cn=*a)'), {type: 'substrings', attribute: 'cn', final: Buffer.from('a'), any: []})
        assert.deepEqual(Filter.parse('(cn=a*b*c)'), {type: 'substrings', attribute: 'cn', initial: Buffer.from('a'), any: [Buffer.from('b')], final: Buffer.from('c')})
        assert.deepEqual(check('(cn=**)', '(cn=*)'), {type: 'present', attribute: 'cn'})
        assert.deepEqual(check('(cn=***)', '(cn=*)'), {type: 'present', attribute: 'cn'})
        assert.deepEqual(check('(cn=a**b)', '(cn=a*b)'), {type: 'substrings', attribute: 'cn', initial: Buffer.from('a'), any: [], final: Buffer.from('b')})
        assert.throws(() => Filter.parse('(cn=**)', {strict: true}), LDAPFilterSyntaxException)
    })

    it('accept the spaces between the filters unless they are strict', () => {
        assert.equal(Filter.parse('(& (cn=a)(objectclass=groupOfNames))').type, 'and')
        assert.equal(Filter.parse(' (cn=a) ').type, 'equality')
        assert.throws(() => Filter.parse('(& (cn=a))', {strict: true}), LDAPFilterSyntaxException)
        assert.throws(() => Filter.parse('(c_n=a)', {strict: true}), LDAPFilterSyntaxException)
        assert.equal(Filter.parse('(c_n=a)').type, 'equality')
    })

    it('refuse what is not a filter', () => {
        for (const text of ['', 'cn=a', '(cn=a', '(cn=a))', '(=a)', '(cn=a(b)', '(cn=\\zz)', '(cn~=a*)', '(:=a)', '(!(a=b)(c=d))', '(cn=a\\)']) {
            assert.throws(() => Filter.parse(text), LDAPFilterSyntaxException, text)
        }
    })

    it('escape the values written with the template, so they cannot change the filter', () => {
        const name: string = 'x)(uid=*'
        assert.deepEqual(filter`(&(objectClass=person)(uid=${name}))`, Filter.and(Filter.equal('objectClass', 'person'), Filter.equal('uid', name)))
        assert.deepEqual(filter`(cn=${'a*'})`, Filter.equal('cn', 'a*'))
        assert.deepEqual(filter`(objectGUID=${Buffer.from([0xff, 0x00, 0x2a])})`, Filter.equal('objectGUID', Buffer.from([0xff, 0x00, 0x2a])))
        assert.equal(escapeFilterValue('a*(b)\\\0'), 'a\\2a\\28b\\29\\5c\\00')
    })

    it('are built by the functions of Filter', () => {
        assert.equal(Filter.stringify(Filter.and(Filter.equal('objectClass', 'person'), Filter.substrings('cn', {initial: 'Al', any: ['i'], final: 'e'}), Filter.greaterOrEqual('uidNumber', '1000'))), '(&(objectClass=person)(cn=Al*i*e)(uidNumber>=1000))')
        assert.equal(Filter.stringify(Filter.extensible({attribute: 'member', rule: '1.2.840.113556.1.4.1941', value: 'cn=g'})), '(member:1.2.840.113556.1.4.1941:=cn=g)')
    })

    it('stop at a filter nested too deep', () => {
        const deep: string = '(!'.repeat(200) + '(a=b)' + ')'.repeat(200)
        assert.throws(() => Filter.parse(deep), LDAPFilterSyntaxException)
    })
})
