import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {BUNDLED_SCHEMAS, bundledSchema, DN, Schema} from '../exports/LDAPEngine.js'

describe('the bundled schema', () => {
    it('defines everything it refers to, and loads the files asked for', () => {
        const schema: Schema = bundledSchema()
        schema.check()
        assert.deepEqual(schema.attributesOf(['inetOrgPerson']).must.sort(), ['cn', 'objectClass', 'sn'])
        assert.ok(schema.attributesOf(['inetOrgPerson']).may.includes('jpegPhoto'))
        assert.equal(bundledSchema(['core']).objectClass('inetOrgPerson'), undefined)
        assert.ok(bundledSchema([]).isOperational('entryUUID'))
        for (const text of Object.values(BUNDLED_SCHEMAS)) assert.ok(new Schema().load(text).attributeTypes().length > 0 || /objectClasses/.test(text))
    })

    it('knows the attributes by the names X.500 gives them, as the RFCs register them', () => {
        const schema: Schema = bundledSchema()
        assert.deepEqual(['commonName', 'surname', 'userid', 'rfc822Mailbox', 'organizationalUnitName'].map((name) => schema.primaryName(name)), ['cn', 'sn', 'uid', 'mail', 'ou'])
        assert.ok(DN.parse('commonName=Alice,organizationalUnitName=People,domainComponent=example').equals('cn=alice,ou=people,dc=example', schema))
    })

    it('reads the syntaxes and the operational attributes of the directory', () => {
        const schema: Schema = bundledSchema()
        assert.ok(schema.isBinary('jpegPhoto') && schema.isBinary('userCertificate') && schema.isBinary('photo'))
        assert.ok(['createTimestamp', 'modifiersName', 'entryDN', 'hasSubordinates', 'subschemaSubentry', 'structuralObjectClass'].every((name) => schema.isOperational(name)))
        assert.ok(schema.isSingleValued('displayName') && !schema.isSingleValued('mail'))
        assert.equal(schema.equality('mail')?.names[0], 'caseIgnoreIA5Match')
        assert.equal(schema.objectClass('groupOfNames')?.must?.includes('member'), true)
    })
})
