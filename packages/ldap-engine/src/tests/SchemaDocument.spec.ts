import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {bundledSchema, LDAPSchemaException, parseSchemaFile, Schema, type SchemaDocument, stringifySchemaFile} from '../exports/LDAPEngine.js'

//An entry of cn=config as OpenLDAP writes it: numbered values, a folded line, comments, a value in base64
const CONFIG: string = [
    '# devices.ldif: the devices of the example',
    'dn: cn=devices,cn=schema,cn=config',
    'objectClass: olcSchemaConfig',
    'cn: devices',
    'olcObjectIdentifier: {0}Example 1.3.6.1.4.1.99999',
    '# The serial number',
    '# of a device',
    'olcAttributeTypes: {0}( Example:1.1 NAME \'serial\' EQUALITY caseExactMatch',
    '  SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 SINGLE-VALUE )',
    'olcAttributeTypes: {1}( Example:1.2 NAME \'firmware\'   SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )',
    `olcAttributeTypes:: ${Buffer.from('{2}( Example:1.3 NAME \'location\' DESC \'所在位置\' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )').toString('base64')}`,
    '',
    '# The device',
    'olcObjectClasses: {0}( Example:2.1 NAME \'device\' SUP top STRUCTURAL MUST serial MAY ( firmware $ location ) )',
    ''
].join('\n')

//A subschema entry
const SUBSCHEMA: string = [
    'dn: cn=Subschema',
    'objectClass: top',
    'objectClass: subschema',
    'ldapSyntaxes: ( 1.3.6.1.4.1.99999.3.1 DESC \'Serial number\' )',
    'attributeTypes: ( 1.3.6.1.4.1.99999.1.1 NAME \'serial\' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )',
    'objectClasses: ( 1.3.6.1.4.1.99999.2.1 NAME \'device\' SUP top STRUCTURAL MUST serial )',
    ''
].join('\n')

//The .schema form: macros between the definitions, a definition on several lines with a comment in it
const DOT_SCHEMA: string = [
    '# devices.schema',
    '',
    'objectidentifier Example 1.3.6.1.4.1.99999',
    'objectidentifier ExampleAttribute Example:1',
    '',
    '# The serial number',
    'attributetype ( ExampleAttribute:1 NAME \'serial\'',
    '    # exact, as the devices print it',
    '    EQUALITY caseExactMatch',
    '    SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 SINGLE-VALUE )',
    '',
    'objectidentifier ExampleClass Example:2',
    '',
    'objectclass ( ExampleClass:1 NAME \'device\'',
    '    SUP top STRUCTURAL MUST serial )',
    ''
].join('\n')

describe('the schema documents', () => {
    it('read cn=config, a subschema entry and the .schema form, and write them back as they were', () => {
        for (const [text, name] of [[CONFIG, 'devices'], [SUBSCHEMA, 'subschema'], [DOT_SCHEMA, 'devices']]) assert.equal(stringifySchemaFile(parseSchemaFile(text, name)), text)
        const config: SchemaDocument = parseSchemaFile(CONFIG, 'devices')
        assert.equal(config.format, 'ldif')
        assert.deepEqual(config.entry, {dn: 'cn=devices,cn=schema,cn=config', attributes: [{type: 'objectClass', values: ['olcSchemaConfig']}, {type: 'cn', values: ['devices']}], config: true, numbered: true})
        assert.deepEqual(config.objectIdentifiers?.map((macro) => [macro.name, macro.oid]), [['Example', '1.3.6.1.4.1.99999']])
        const [serial, firmware, location] = config.attributeTypes
        assert.equal(serial.oid, 'Example:1.1')
        assert.equal(serial.comment, 'The serial number\nof a device')
        assert.equal(serial.line, 8)
        assert.equal(CONFIG.slice(...serial.span!), CONFIG.split('\n').slice(5, 9).join('\n'))
        assert.equal(firmware.comment, undefined)
        assert.equal(location.description, '所在位置')
        assert.equal(config.objectClasses[0].comment, 'The device')
        const dotSchema: SchemaDocument = parseSchemaFile(DOT_SCHEMA, 'devices')
        assert.equal(dotSchema.format, 'schema')
        assert.deepEqual(dotSchema.objectIdentifiers?.map((macro) => macro.name), ['Example', 'ExampleAttribute', 'ExampleClass'])
        assert.equal(dotSchema.attributeTypes[0].equality, 'caseExactMatch')
        assert.equal(parseSchemaFile(SUBSCHEMA, 'subschema').syntaxes?.[0].description, 'Serial number')
    })

    it('write a definition changed in its form, the others as they were, the comment part of the definition', () => {
        const document: SchemaDocument = parseSchemaFile(CONFIG, 'devices')
        document.objectClasses[0].may = ['firmware']
        const lines: string[] = stringifySchemaFile(document).split('\n')
        assert.equal(lines[13], 'olcObjectClasses: {0}( Example:2.1 NAME \'device\' SUP top STRUCTURAL MUST serial MAY firmware )')
        assert.deepEqual(lines.slice(0, 13), CONFIG.split('\n').slice(0, 13))
        const commented: SchemaDocument = parseSchemaFile(DOT_SCHEMA, 'devices')
        commented.attributeTypes[0].comment = 'The serial number, as printed'
        assert.equal(stringifySchemaFile(commented), DOT_SCHEMA.replace(/# The serial number\nattributetype \( ExampleAttribute:1 NAME 'serial'\n {4}# exact, as the devices print it\n {4}EQUALITY caseExactMatch\n {4}SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 SINGLE-VALUE \)/, '# The serial number, as printed\nattributetype ( ExampleAttribute:1 NAME \'serial\' EQUALITY caseExactMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 SINGLE-VALUE )'))
    })

    it('take a definition out with its comment, and number the others again', () => {
        const document: SchemaDocument = parseSchemaFile(CONFIG, 'devices')
        document.attributeTypes.splice(0, 1)
        const written: string = stringifySchemaFile(document)
        assert.ok(!written.includes('serial number') && !written.includes('\'serial\' EQUALITY'))
        assert.ok(written.includes('olcAttributeTypes: {0}( Example:1.2 NAME \'firmware\'   SYNTAX'))
        //The value in base64 is written again with its new position
        const encoded: string = written.split('\n').find((line: string): boolean => line.startsWith('olcAttributeTypes:: '))!
        assert.ok(Buffer.from(encoded.slice('olcAttributeTypes:: '.length), 'base64').toString('utf8').startsWith('{1}( Example:1.3 NAME \'location\''))
        assert.equal(written.split('\n')[4], 'olcObjectIdentifier: {0}Example 1.3.6.1.4.1.99999')
        assert.equal(written.split('\n')[5], 'olcAttributeTypes: {0}( Example:1.2 NAME \'firmware\'   SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )')
    })

    it('add a definition after the last of its kind, with its position and its comment', () => {
        const document: SchemaDocument = parseSchemaFile(CONFIG, 'devices')
        document.attributeTypes.push({oid: 'Example:1.4', names: ['owner'], syntax: '1.3.6.1.4.1.1466.115.121.1.12', comment: 'Who owns it'})
        const lines: string[] = stringifySchemaFile(document).split('\n')
        assert.deepEqual(lines.slice(11, 13), ['# Who owns it', 'olcAttributeTypes: {3}( Example:1.4 NAME \'owner\' SYNTAX 1.3.6.1.4.1.1466.115.121.1.12 )'])
        const dotSchema: SchemaDocument = parseSchemaFile(DOT_SCHEMA, 'devices')
        dotSchema.objectClasses.push({oid: 'ExampleClass:2', names: ['sensor'], superiors: ['device'], kind: 'structural'})
        assert.equal(stringifySchemaFile(dotSchema), DOT_SCHEMA + '\nobjectclass ( ExampleClass:2 NAME \'sensor\' SUP device STRUCTURAL )\n'.replace(/^\n/, '\n'))
    })

    it('go through JSON, load into a schema unchanged, and be written in another form', () => {
        const document: SchemaDocument = parseSchemaFile(CONFIG, 'devices')
        const json: string = JSON.stringify(document)
        const copy: SchemaDocument = JSON.parse(json)
        assert.equal(stringifySchemaFile(copy), CONFIG)
        const schema: Schema = new Schema().load(copy)
        assert.equal(JSON.stringify(copy), json)
        //The macros expanded by the schema, the document keeping them as written
        assert.equal(schema.attributeType('serial')?.oid, '1.3.6.1.4.1.99999.1.1')
        assert.equal(copy.attributeTypes[0].oid, 'Example:1.1')
        assert.equal(schema.objectClass('device')?.oid, '1.3.6.1.4.1.99999.2.1')
        const asDotSchema: string = stringifySchemaFile(document, {format: 'schema'})
        assert.ok(asDotSchema.startsWith('objectidentifier Example 1.3.6.1.4.1.99999\n\n# The serial number\n# of a device\nattributetype ( Example:1.1 NAME \'serial\''))
        assert.deepEqual(new Schema().load(asDotSchema, 'again').objectClass('device')?.must, ['serial'])
        //A document made in code: an entry of cn=config
        assert.equal(stringifySchemaFile({name: 'tiny', format: 'ldif', attributeTypes: [{oid: '1.2.3', names: ['tiny'], syntax: '1.3.6.1.4.1.1466.115.121.1.15'}], objectClasses: []}), 'dn: cn=tiny,cn=schema,cn=config\nobjectClass: olcSchemaConfig\ncn: tiny\nolcAttributeTypes: {0}( 1.2.3 NAME \'tiny\' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )\n')
    })

    it('name the line of a definition that is not valid, and the file and line of what a definition refers to', () => {
        assert.throws(() => parseSchemaFile('attributetype ( 1.2.3 NAME \'a\' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )\n\nobjectclass ( 1.2.4 NAME \'b\' MUST ( a )', 'broken'), (error: unknown) => error instanceof LDAPSchemaException && error.message.startsWith('broken, line 3:'))
        const schema: Schema = bundledSchema([]).load(parseSchemaFile(DOT_SCHEMA.replace('MUST serial', 'MUST ( serial $ owner )'), 'devices'))
        assert.deepEqual(schema.problems(), [{message: 'the attribute owner of the object class device', source: 'devices', line: 14}])
        assert.throws(() => schema.check(), /the attribute owner of the object class device/)
        //Matching rules: in a subschema entry only
        const rules: SchemaDocument = {name: 'rules', format: 'ldif', matchingRules: [{oid: '1.2.3', names: ['exampleMatch'], syntax: '1.3.6.1.4.1.1466.115.121.1.15'}], attributeTypes: [], objectClasses: []}
        assert.throws(() => stringifySchemaFile(rules, {format: 'schema'}), LDAPSchemaException)
        assert.throws(() => stringifySchemaFile(rules), LDAPSchemaException)
        assert.ok(stringifySchemaFile({...rules, entry: {dn: 'cn=Subschema', attributes: [], config: false, numbered: false}}).includes('matchingRules: ( 1.2.3 NAME \'exampleMatch\''))
    })
})
