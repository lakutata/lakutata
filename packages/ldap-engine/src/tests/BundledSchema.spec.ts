import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {describe, it} from 'node:test'
import {fileURLToPath} from 'node:url'
import {BUNDLED_SCHEMA_NAMES, BUNDLED_SCHEMAS, bundledSchema, CORE_SCHEMA, DEFAULT_SCHEMAS, DN, parseSchemaFile, readSchemaDirectory, Schema, type SchemaDocument, stringifySchemaFile} from '../exports/LDAPEngine.js'

//The LDIF the bundled documents are made from
const SOURCES: string = join(dirname(fileURLToPath(import.meta.url)), '../../../scripts/schema/source')

describe('the bundled schema', () => {
    it('defines everything it refers to, core, cosine and inetorgperson by default, system whole by itself', () => {
        const schema: Schema = bundledSchema()
        schema.check()
        assert.deepEqual(schema.attributesOf(['inetOrgPerson']).must.sort(), ['cn', 'objectClass', 'sn'])
        assert.ok(schema.attributesOf(['inetOrgPerson']).may.includes('jpegPhoto'))
        assert.equal(schema.objectClass('posixAccount'), undefined)
        assert.deepEqual(DEFAULT_SCHEMAS.map((document: SchemaDocument): string => document.name), ['core', 'cosine', 'inetorgperson'])
        assert.equal(bundledSchema(['core']).objectClass('inetOrgPerson'), undefined)
        const system: Schema = bundledSchema([])
        system.check()
        assert.ok(system.isOperational('entryUUID') && system.objectClass('subentry') && system.attributeType('commonName'))
        bundledSchema(BUNDLED_SCHEMA_NAMES).check()
    })

    it('are documents made from the LDIF of the RFCs, which a schema loads without changing them', () => {
        const before: string = JSON.stringify(CORE_SCHEMA)
        bundledSchema(['core'])
        new Schema().load(BUNDLED_SCHEMAS.system).load(CORE_SCHEMA)
        assert.equal(JSON.stringify(CORE_SCHEMA), before)
        assert.ok(CORE_SCHEMA.objectClasses.find((objectClass) => objectClass.names.includes('person'))?.comment?.startsWith('RFC 4519 §3.12'))
        //Each source written back as it was, and each document the same as its source (generated again when it changes)
        const strip = (definitions: {line?: number, span?: [number, number]}[]): unknown[] => definitions.map(({line, span, ...rest}) => (void line, void span, rest))
        for (const file of readdirSync(SOURCES).filter((name: string): boolean => name.endsWith('.ldif'))) {
            const text: string = readFileSync(join(SOURCES, file), 'utf8')
            const document: SchemaDocument = parseSchemaFile(text, file.replace(/\.ldif$/, ''))
            assert.equal(stringifySchemaFile(document), text, file)
            const bundled: SchemaDocument | undefined = BUNDLED_SCHEMAS[document.name as keyof typeof BUNDLED_SCHEMAS]
            if (!bundled) continue
            assert.deepEqual(bundled.attributeTypes.slice(0, document.attributeTypes.length), strip(document.attributeTypes), file)
            assert.deepEqual(bundled.objectClasses.slice(0, document.objectClasses.length), strip(document.objectClasses), file)
        }
    })

    it('knows the attributes by the names X.500 gives them, as the RFCs register them', () => {
        const schema: Schema = bundledSchema()
        assert.deepEqual(['commonName', 'surname', 'userid', 'rfc822Mailbox', 'organizationalUnitName'].map((name) => schema.primaryName(name)), ['cn', 'sn', 'uid', 'mail', 'ou'])
        assert.ok(DN.parse('commonName=Alice,organizationalUnitName=People,domainComponent=example').equals('cn=alice,ou=people,dc=example', schema))
    })

    it('has the POSIX accounts and groups, the SSH public keys and the password policy, when asked for', () => {
        const schema: Schema = bundledSchema(BUNDLED_SCHEMA_NAMES)
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
            for (const file of files) schema.load(file)
            assert.ok(schema.attributeType('earlyAttribute') && schema.attributeType('lateAttribute') && schema.attributeType('localAttribute'))
        } finally {
            rmSync(directory, {recursive: true, force: true})
        }
    })
})
