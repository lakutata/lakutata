import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, it} from 'node:test'
import {BUNDLED_SCHEMAS, bundledSchema, DN, readSchemaDirectory, Schema} from '../exports/LDAPEngine.js'

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

    it('has the POSIX accounts and groups, the SSH public keys and the password policy', () => {
        const schema: Schema = bundledSchema()
        assert.deepEqual(schema.attributesOf(['posixAccount']).must.sort(), ['cn', 'gidNumber', 'homeDirectory', 'objectClass', 'uid', 'uidNumber'])
        assert.equal(schema.objectClass('posixGroup')?.kind, 'auxiliary')
        assert.ok(schema.objectClass('groupOfMembers')?.may?.includes('member'))
        assert.equal(schema.ordering('uidNumber')?.names[0], 'integerOrderingMatch')
        assert.ok(schema.attributesOf(['ldapPublicKey']).may.includes('sshPublicKey'))
        assert.deepEqual(schema.attributesOf(['pwdPolicy']).must, ['pwdAttribute', 'objectClass'])
        assert.ok(['pwdChangedTime', 'pwdAccountLockedTime', 'pwdFailureTime', 'pwdHistory', 'pwdReset', 'pwdPolicySubentry'].every((name) => schema.isOperational(name)))
        assert.ok(schema.attributeType('authPassword'))
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

describe('the schema files of a directory', () => {
    it('reads the .ldif and .schema files in the order of their names, the numbers by their value', async () => {
        const directory: string = mkdtempSync(join(tmpdir(), 'lakutata-schema-'))
        try {
            const definition = (name: string, oid: string): string => `dn: cn=${name},cn=schema,cn=config\nobjectClass: olcSchemaConfig\ncn: ${name}\nolcAttributeTypes: ( 1.3.6.1.4.1.99999.${oid} NAME '${name}Attribute' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )\n`
            writeFileSync(join(directory, 'cn={10}late.ldif'), definition('late', '10'))
            writeFileSync(join(directory, 'cn={2}early.ldif'), definition('early', '2'))
            writeFileSync(join(directory, 'local.schema'), "attributetype ( 1.3.6.1.4.1.99999.3 NAME 'localAttribute' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )\n")
            writeFileSync(join(directory, 'README.md'), 'not a schema')
            writeFileSync(join(directory, '.hidden.ldif'), 'not read')
            mkdirSync(join(directory, 'nested.ldif'))
            const files = await readSchemaDirectory(directory)
            assert.deepEqual(files.map((file) => file.name), ['early', 'late', 'local'])
            const schema: Schema = bundledSchema()
            for (const file of files) schema.load(file.text, file.name)
            assert.ok(schema.attributeType('earlyAttribute') && schema.attributeType('lateAttribute') && schema.attributeType('localAttribute'))
        } finally {
            rmSync(directory, {recursive: true, force: true})
        }
    })
})
