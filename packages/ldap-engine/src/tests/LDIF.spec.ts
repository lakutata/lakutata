import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {LDAPLDIFSyntaxException, type LDIFRecord, parseLDIF, stringifyLDIF} from '../exports/LDAPEngine.js'

describe('LDIF', () => {
    it('reads the entries of RFC 2849 example 1 to 3: folded lines, base64, comments', () => {
        const records: LDIFRecord[] = parseLDIF([
            'version: 1',
            '# a comment',
            'dn: cn=Barbara Jensen, ou=Product Development, dc=airius, dc=com',
            'objectclass: top',
            'objectclass: person',
            'cn: Barbara Jensen',
            'cn: Barbara J Jensen',
            'description: Babs is a big sailing fan, and travels extensively in sea',
            ' rch of perfect sailing conditions.',
            'title:Product Manager, Rod and Reel Division',
            '',
            '# another',
            '#  folded comment',
            ' still the comment',
            'dn:: b3U95Za25qWt6YOoLG89QWlyaXVz',
            'ou:: 5Za25qWt6YOo',
            'description:: V2hhdCBhIGNhcmVmdWwgcmVhZGVyIHlvdSBhcmUhICBUaGlzIHZhbHVl',
            ''
        ].join('\n'))
        assert.equal(records.length, 2)
        assert.deepEqual(records[0], {
            changeType: 'content',
            dn: 'cn=Barbara Jensen, ou=Product Development, dc=airius, dc=com',
            attributes: [
                {type: 'objectclass', values: [Buffer.from('top'), Buffer.from('person')]},
                {type: 'cn', values: [Buffer.from('Barbara Jensen'), Buffer.from('Barbara J Jensen')]},
                {type: 'description', values: [Buffer.from('Babs is a big sailing fan, and travels extensively in search of perfect sailing conditions.')]},
                {type: 'title', values: [Buffer.from('Product Manager, Rod and Reel Division')]}
            ],
            comments: [' a comment'],
            line: 3
        })
        assert.equal(records[1].dn, 'ou=営業部,o=Airius')
        assert.deepEqual(records[1].comments, [' another', '  folded commentstill the comment'])
        assert.equal(records[1].line, 15)
    })

    it('reads the changes of RFC 2849 example 6, with controls', () => {
        const records: LDIFRecord[] = parseLDIF([
            'dn: cn=Fiona Jensen, ou=Marketing, dc=airius, dc=com',
            'changetype: add',
            'objectclass: top',
            'cn: Fiona Jensen',
            '',
            'dn: cn=Robert Jensen, ou=Marketing, dc=airius, dc=com',
            'changetype: delete',
            '',
            'dn: cn=Paul Jensen, ou=Product Development, dc=airius, dc=com',
            'changetype: modrdn',
            'newrdn: cn=Paula Jensen',
            'deleteoldrdn: 1',
            '',
            'dn: ou=PD Accountants, ou=Product Development, dc=airius, dc=com',
            'changetype: modrdn',
            'newrdn: ou=Product Development Accountants',
            'deleteoldrdn: 0',
            'newsuperior: ou=Accounting, dc=airius, dc=com',
            '',
            'dn: cn=Paula Jensen, ou=Product Development, dc=airius, dc=com',
            'control: 1.2.840.113556.1.4.805 true',
            'changetype: modify',
            'add: postaladdress',
            'postaladdress: 123 Anystreet $ Sunnyvale, CA $ 94086',
            '-',
            'delete: description',
            '-',
            'replace: telephonenumber',
            'telephonenumber: +1 408 555 1234',
            'telephonenumber: +1 408 555 5678',
            '-',
            'delete: facsimiletelephonenumber',
            'facsimiletelephonenumber: +1 408 555 9876',
            '-',
            ''
        ].join('\n'))
        assert.deepEqual(records.map((record: LDIFRecord): string => record.changeType), ['add', 'delete', 'modifyDN', 'modifyDN', 'modify'])
        const modify: LDIFRecord = records[4]
        assert.ok(modify.changeType === 'modify')
        assert.deepEqual(modify.controls, [{oid: '1.2.840.113556.1.4.805', critical: true}])
        assert.deepEqual(modify.changes.map((change) => [change.operation, change.modification.type, change.modification.values.length]), [['add', 'postaladdress', 1], ['delete', 'description', 0], ['replace', 'telephonenumber', 2], ['delete', 'facsimiletelephonenumber', 1]])
        assert.ok(records[3].changeType === 'modifyDN' && records[3].newSuperior === 'ou=Accounting, dc=airius, dc=com' && !records[3].deleteOldRDN)
    })

    it('writes back what it reads, base64 for the values that are not safe, the long lines folded', () => {
        const records: LDIFRecord[] = [
            {changeType: 'content', dn: 'cn=Liu,dc=example,dc=com', attributes: [{type: 'cn', values: [Buffer.from('刘'), Buffer.from(' leading'), Buffer.from(':colon'), Buffer.from('trailing ')]}, {type: 'description', values: [Buffer.from('x'.repeat(200))]}, {type: 'jpegPhoto', values: [Buffer.from([0xff, 0xd8, 0x00])]}]},
            {changeType: 'modify', dn: 'cn=a', changes: [{operation: 'replace', modification: {type: 'mail', values: [Buffer.from('a@example.com')]}}, {operation: 'delete', modification: {type: 'description', values: []}}]},
            {changeType: 'modifyDN', dn: 'cn=a', newRDN: 'cn=b', deleteOldRDN: true, newSuperior: 'dc=x'},
            {changeType: 'delete', dn: 'cn=b,dc=x', controls: [{oid: '1.2.840.113556.1.4.805', critical: true}]},
            {changeType: 'add', dn: 'cn=c', attributes: [{type: 'objectClass', values: [Buffer.from('device')]}]}
        ]
        const text: string = stringifyLDIF(records)
        assert.ok(text.startsWith('version: 1\n\n'))
        assert.ok(text.split('\n').every((line: string): boolean => line.length <= 76))
        assert.ok(text.includes('cn:: 5YiY'))
        assert.deepEqual(parseLDIF(text).map(({line, ...record}) => (void line, record)), records)
        //The comments before a record written back before it
        const commented: string = stringifyLDIF([{...records[2], comments: [' renamed', ' by the migration']}], {version: false})
        assert.ok(commented.startsWith('# renamed\n# by the migration\ndn: cn=a\n'))
        assert.deepEqual(parseLDIF(commented)[0].comments, [' renamed', ' by the migration'])
    })

    it('refuses what it cannot read, with the line', () => {
        assert.throws(() => parseLDIF('cn: no dn\n'), (error: unknown) => error instanceof LDAPLDIFSyntaxException && error.line === 1)
        assert.throws(() => parseLDIF('dn: cn=a\nchangetype: rename\n'), LDAPLDIFSyntaxException)
        assert.throws(() => parseLDIF('dn: cn=a\njpegPhoto:< file:///etc/passwd\n'), LDAPLDIFSyntaxException)
        assert.throws(() => parseLDIF(' continuation\n'), LDAPLDIFSyntaxException)
        assert.throws(() => parseLDIF('version: 2\n\ndn: cn=a\ncn: a\n'), LDAPLDIFSyntaxException)
        assert.deepEqual(parseLDIF('dn: cn=a\nphoto:< file:///p.jpg\n', {readURL: (url: string): Buffer => Buffer.from(url)})[0], {changeType: 'content', dn: 'cn=a', attributes: [{type: 'photo', values: [Buffer.from('file:///p.jpg')]}], line: 1})
    })
})
