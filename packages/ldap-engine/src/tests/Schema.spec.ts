import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    type AttributeTypeDefinition,
    Filter,
    formatGeneralizedTime,
    LDAPSchemaException,
    matchFilter,
    type ObjectClassDefinition,
    parseAttributeType,
    parseGeneralizedTime,
    parseObjectClass,
    Schema,
    stringifyAttributeType,
    stringifyObjectClass
} from '../exports/LDAPEngine.js'

//A part of the core schemas (RFC 4512, 4519, 2798), enough for the tests
const CORE: string = `
dn: cn=core,cn=schema,cn=config
objectClass: olcSchemaConfig
cn: core
olcAttributeTypes: {0}( 2.5.4.0 NAME 'objectClass' EQUALITY objectIdentifierMatch
  SYNTAX 1.3.6.1.4.1.1466.115.121.1.38 )
olcAttributeTypes: {1}( 2.5.4.41 NAME 'name' EQUALITY caseIgnoreMatch SUBSTR caseIgnoreSubstringsMatch
  SYNTAX 1.3.6.1.4.1.1466.115.121.1.15{32768} )
olcAttributeTypes: {2}( 2.5.4.3 NAME ( 'cn' 'commonName' ) DESC 'RFC4519: common name(s) for which the entity is known by'
  SUP name )
olcAttributeTypes: {3}( 2.5.4.4 NAME ( 'sn' 'surname' ) SUP name )
olcAttributeTypes: {4}( 0.9.2342.19200300.100.1.1 NAME ( 'uid' 'userid' ) EQUALITY caseIgnoreMatch
  SUBSTR caseIgnoreSubstringsMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15{256} )
olcAttributeTypes: {5}( 2.5.4.31 NAME 'member' SUP distinguishedName )
olcAttributeTypes: {6}( 2.5.4.49 NAME 'distinguishedName' EQUALITY distinguishedNameMatch
  SYNTAX 1.3.6.1.4.1.1466.115.121.1.12 )
olcAttributeTypes: {7}( 2.5.18.2 NAME 'modifyTimestamp' EQUALITY generalizedTimeMatch
  ORDERING generalizedTimeOrderingMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.24 SINGLE-VALUE
  NO-USER-MODIFICATION USAGE directoryOperation )
olcAttributeTypes: {8}( 1.3.6.1.1.1.1.0 NAME 'uidNumber' EQUALITY integerMatch ORDERING integerOrderingMatch
  SYNTAX 1.3.6.1.4.1.1466.115.121.1.27 SINGLE-VALUE )
olcAttributeTypes: {9}( 0.9.2342.19200300.100.1.60 NAME 'jpegPhoto' SYNTAX 1.3.6.1.4.1.1466.115.121.1.28 )
olcAttributeTypes: {10}( 1.2.3.9 NAME 'noRules' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )
olcAttributeTypes: {11}( 2.5.4.11 NAME ( 'ou' 'organizationalUnitName' ) SUP name )
olcAttributeTypes: {12}( 2.5.4.35 NAME 'userPassword' EQUALITY octetStringMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.40{128} )
olcAttributeTypes: {13}( 2.5.4.13 NAME 'description' EQUALITY caseIgnoreMatch SUBSTR caseIgnoreSubstringsMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15{1024} )
olcObjectClasses: {0}( 2.5.6.0 NAME 'top' ABSTRACT MUST objectClass )
olcObjectClasses: {1}( 2.5.6.6 NAME 'person' SUP top STRUCTURAL MUST ( sn $ cn ) MAY ( userPassword $ description ) )
olcObjectClasses: {2}( 2.16.840.1.113730.3.2.2 NAME 'inetOrgPerson' SUP person STRUCTURAL MAY ( uid $ jpegPhoto ) )
`

/**
 * The core schema
 */
function core(): Schema {
    return new Schema().load(CORE, 'core.ldif')
}

describe('the schema definitions', () => {
    it('parse an attribute type and write it back', () => {
        const definition: AttributeTypeDefinition = parseAttributeType('( 2.5.18.2 NAME \'modifyTimestamp\' EQUALITY generalizedTimeMatch ORDERING generalizedTimeOrderingMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.24 SINGLE-VALUE NO-USER-MODIFICATION USAGE directoryOperation X-ORIGIN \'RFC 4512\' )')
        assert.deepEqual(definition, {
            oid: '2.5.18.2', names: ['modifyTimestamp'], equality: 'generalizedTimeMatch', ordering: 'generalizedTimeOrderingMatch',
            syntax: '1.3.6.1.4.1.1466.115.121.1.24', singleValue: true, noUserModification: true, usage: 'directoryOperation', extensions: {'X-ORIGIN': ['RFC 4512']}
        })
        assert.deepEqual(parseAttributeType(stringifyAttributeType(definition)), definition)
    })

    it('take the superior named like a keyword ("SUP name")', () => {
        assert.equal(parseAttributeType('( 2.5.4.3 NAME ( \'cn\' \'commonName\' ) SUP name )').superior, 'name')
    })

    it('parse an object class and write it back, the quotes escaped', () => {
        const definition: ObjectClassDefinition = parseObjectClass('( 2.5.6.6 NAME \'person\' DESC \'It\\27s a person\' SUP top STRUCTURAL MUST ( sn $ cn ) MAY ( userPassword $ telephoneNumber $ seeAlso $ description ) )')
        assert.equal(definition.description, 'It\'s a person')
        assert.deepEqual(definition.must, ['sn', 'cn'])
        assert.deepEqual(parseObjectClass(stringifyObjectClass(definition)), definition)
    })

    it('refuse an attribute type with neither a syntax nor a superior', () => {
        assert.throws(() => parseAttributeType('( 1.2.3 NAME \'x\' )'), LDAPSchemaException)
        assert.throws(() => parseAttributeType('1.2.3 NAME \'x\''), LDAPSchemaException)
    })

    it('refuse a definition whose parentheses do not pair up, a list left open included', () => {
        const unpaired = (error: unknown): boolean => error instanceof LDAPSchemaException && /parentheses/.test(error.message)
        assert.throws(() => parseObjectClass('( 1.2.3 NAME \'device\' STRUCTURAL MUST ( cn $ sn )'), unpaired)
        assert.throws(() => parseObjectClass('( 1.2.3 NAME \'device\' MUST cn ) MAY sn )'), unpaired)
        assert.throws(() => parseObjectClass('( 1.2.3 NAME \'device\' MUST ( cn ) ) )'), unpaired)
        assert.equal(parseObjectClass('( 1.2.3 NAME \'device\' DESC \'a (parenthesis\' MUST ( cn $ sn ) )').description, 'a (parenthesis')
    })
})

describe('the schema', () => {
    it('loads the cn=config LDIF of OpenLDAP and inherits the rules of the superiors', () => {
        const schema: Schema = core()
        assert.equal(schema.attributeType('commonName')?.oid, '2.5.4.3')
        assert.equal(schema.equality('cn')?.names[0], 'caseIgnoreMatch')
        assert.equal(schema.substrings('cn;lang-en')?.names[0], 'caseIgnoreSubstringsMatch')
        assert.equal(schema.syntaxOf('cn'), '1.3.6.1.4.1.1466.115.121.1.15')
        assert.equal(schema.primaryName('2.5.4.3'), 'cn')
        assert.ok(schema.isSubtypeOf('cn', 'name'))
        assert.ok(!schema.isSubtypeOf('name', 'cn'))
        assert.ok(schema.isBinary('jpegPhoto'))
        assert.ok(!schema.isBinary('cn'))
        assert.ok(schema.isOperational('modifyTimestamp'))
        assert.ok(schema.isSingleValued('uidNumber'))
        assert.deepEqual(schema.attributesOf(['inetOrgPerson']), {must: ['sn', 'cn', 'objectClass'], may: ['uid', 'jpegPhoto', 'userPassword', 'description']})
        assert.deepEqual(schema.superclasses('inetOrgPerson').map((definition: ObjectClassDefinition): string => definition.names[0]), ['inetOrgPerson', 'person', 'top'])
    })

    it('derives a structural or abstract class defined without a superclass from top, not an auxiliary one', () => {
        const schema: Schema = core().load([
            'objectclass ( 1.2.3.1 NAME \'device\' STRUCTURAL MUST cn )',
            'objectclass ( 1.2.3.2 NAME \'thing\' ABSTRACT MAY description )',
            'objectclass ( 1.2.3.3 NAME \'tagged\' AUXILIARY MAY description )'
        ].join('\n'), 'extra.schema')
        const names = (name: string): string[] => schema.superclasses(name).map((definition: ObjectClassDefinition): string => definition.names[0])
        assert.deepEqual(names('device'), ['device', 'top'])
        assert.deepEqual(names('thing'), ['thing', 'top'])
        assert.deepEqual(names('tagged'), ['tagged'])
        assert.deepEqual(names('top'), ['top'])
        assert.deepEqual(schema.attributesOf(['device']), {must: ['cn', 'objectClass'], may: []})
    })

    it('loads the .schema form of slapd.conf, with its OID macros', () => {
        const schema: Schema = new Schema().load([
            '# a comment',
            'objectidentifier Example 1.3.6.1.4.1.99999',
            'objectidentifier ExampleAttributes Example:1',
            'attributetype ( ExampleAttributes:1 NAME \'badge\'',
            '    EQUALITY caseIgnoreMatch',
            '    SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 SINGLE-VALUE )',
            'objectclass ( Example:2.1 NAME \'employee\' SUP top AUXILIARY MAY badge )'
        ].join('\n'), 'example.schema')
        assert.equal(schema.attributeType('badge')?.oid, '1.3.6.1.4.1.99999.1.1')
        assert.equal(schema.objectClass('employee')?.oid, '1.3.6.1.4.1.99999.2.1')
    })

    it('refuses a name or an OID defined twice, naming both places', () => {
        const schema: Schema = core()
        assert.throws(() => schema.addAttributeType('( 1.3.6.1.4.1.2333.1.10 NAME \'member\' SYNTAX 1.3.6.1.4.1.1466.115.121.1.12 )', 'oims.ldif'), (error: unknown) => error instanceof LDAPSchemaException && error.message.includes('core.ldif') && error.message.includes('oims.ldif'))
        assert.throws(() => schema.addAttributeType('( 2.5.4.3 NAME \'other\' SUP name )', 'other.ldif'), LDAPSchemaException)
        assert.throws(() => new Schema().load('attributetype ( 1.2.3 NAME \'a\' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )\nattributetype ( 1.2.4 NAME \'A\' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )'), LDAPSchemaException)
    })

    it('reports the references it does not define, all together', () => {
        const schema: Schema = new Schema().load('attributetype ( 1.2.3 NAME \'a\' SUP missing EQUALITY noSuchMatch )\nobjectclass ( 1.2.4 NAME \'c\' SUP nothing MUST ( a $ b ) )')
        assert.throws(() => schema.check(), (error: unknown) => error instanceof LDAPSchemaException && ['missing', 'noSuchMatch', 'nothing', 'attribute b'].every((part: string): boolean => error.message.includes(part)))
        assert.doesNotThrow(() => core().check())
    })

    it('keeps its built-in syntaxes and matching rules when a subschema entry defines them again', () => {
        const schema: Schema = new Schema().load('dn: cn=Subschema\nldapSyntaxes: ( 1.3.6.1.4.1.1466.115.121.1.15 DESC \'Directory String\' )\nmatchingRules: ( 2.5.13.2 NAME \'caseIgnoreMatch\' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )\n')
        assert.equal(schema.matchingRule('caseIgnoreMatch')?.oid, '2.5.13.2')
        assert.ok(schema.matchingRules().some((rule) => rule.oid === '2.5.13.1'))
    })

    it('checks values by their syntax', () => {
        const schema: Schema = core()
        assert.ok(schema.isValidValue('uidNumber', Buffer.from('1000')))
        assert.ok(!schema.isValidValue('uidNumber', Buffer.from('ten')))
        assert.ok(schema.isValidValue('member', Buffer.from('cn=a,dc=b')))
        assert.ok(!schema.isValidValue('member', Buffer.from('cn=a,=b')))
        assert.ok(schema.isValidValue('modifyTimestamp', Buffer.from('20260108123000Z')))
        assert.ok(!schema.isValidValue('modifyTimestamp', Buffer.from('2026-01-08')))
        assert.ok(schema.isValidValue('jpegPhoto', Buffer.from([0xff, 0xd8])))
    })
})

describe('the matching rules', () => {
    const schema: Schema = core()
    const entry = {
        dn: 'uid=alice,ou=People,dc=example,dc=com',
        attributes: [
            {type: 'objectClass', values: [Buffer.from('top'), Buffer.from('Person'), Buffer.from('2.16.840.1.113730.3.2.2')]},
            {type: 'cn', values: [Buffer.from('Alice  LIU')]},
            {type: 'cn;lang-zh', values: [Buffer.from('刘爱丽')]},
            {type: 'sn', values: [Buffer.from('Liu')]},
            {type: 'uid', values: [Buffer.from('alice')]},
            {type: 'member', values: [Buffer.from('CN=Group, DC=Example, DC=com')]},
            {type: 'modifyTimestamp', values: [Buffer.from('20260108123000Z')]},
            {type: 'uidNumber', values: [Buffer.from('1500')]},
            {type: 'noRules', values: [Buffer.from('x')]}
        ]
    }
    const match = (text: string): boolean | undefined => matchFilter(Filter.parse(text), entry, schema)

    it('compare strings without case, with the spaces collapsed, through the subtypes', () => {
        assert.equal(match('(cn=alice liu)'), true)
        assert.equal(match('(commonName=ALICE LIU)'), true)
        assert.equal(match('(name=liu)'), true)
        assert.equal(match('(cn=alice*)'), true)
        assert.equal(match('(cn=*liu)'), true)
        assert.equal(match('(cn=a*e*u)'), true)
        assert.equal(match('(cn=*bob*)'), false)
        assert.equal(match('(cn;lang-zh=刘爱丽)'), true)
        assert.equal(match('(cn;lang-zh=alice liu)'), false)
    })

    it('compare OIDs by the names the schema gives them', () => {
        assert.equal(match('(objectClass=person)'), true)
        assert.equal(match('(objectClass=2.5.6.6)'), true)
        assert.equal(match('(objectClass=inetOrgPerson)'), true)
        assert.equal(match('(objectClass=groupOfNames)'), false)
    })

    it('compare DNs, integers and times by their meaning', () => {
        assert.equal(match('(member=cn=group,dc=example,dc=com)'), true)
        assert.equal(match('(uidNumber>=1000)'), true)
        assert.equal(match('(uidNumber<=999)'), false)
        assert.equal(match('(uidNumber=01500)'), undefined)
        assert.equal(match('(modifyTimestamp>=20260101000000.0Z)'), true)
        assert.equal(match('(modifyTimestamp>=202601081430+0200)'), true)
        assert.equal(match('(modifyTimestamp=20260108123000.000Z)'), true)
        assert.equal(match('(modifyTimestamp>=20270101000000Z)'), false)
    })

    it('are Undefined for what they cannot tell, with the three-valued logic of RFC 4511', () => {
        assert.equal(match('(unknownAttribute=x)'), undefined)
        assert.equal(match('(noRules=x)'), undefined)
        assert.equal(match('(!(unknownAttribute=x))'), undefined)
        assert.equal(match('(&(uid=alice)(unknownAttribute=x))'), undefined)
        assert.equal(match('(&(uid=bob)(unknownAttribute=x))'), false)
        assert.equal(match('(|(uid=alice)(unknownAttribute=x))'), true)
        assert.equal(match('(uidNumber>=many)'), undefined)
        assert.equal(match('(unknownAttribute=*)'), false)
        assert.equal(match('(&)'), true)
        assert.equal(match('(|)'), false)
    })

    it('take approx as equality, and the extensible filters with a rule or on the DN', () => {
        assert.equal(match('(cn~=alice liu)'), true)
        assert.equal(match('(cn:caseExactMatch:=Alice LIU)'), true)
        assert.equal(match('(cn:caseExactMatch:=alice liu)'), false)
        assert.equal(match('(ou:dn:=people)'), true)
        assert.equal(match('(ou:=people)'), false)
        assert.equal(match('(cn:1.2.840.113556.1.4.1941:=x)'), undefined)
        assert.equal(match('(:caseIgnoreMatch:=liu)'), true)
    })

    it('without a schema, compare every attribute as caseIgnoreMatch does', () => {
        const plain = (text: string): boolean | undefined => matchFilter(Filter.parse(text), entry)
        assert.equal(plain('(CN=alice liu)'), true)
        assert.equal(plain('(sn=L*)'), true)
        assert.equal(plain('(unknownAttribute=x)'), false)
        assert.equal(plain('(uid>=a)'), true)
    })

    it('read and write the generalized times', () => {
        assert.equal(parseGeneralizedTime('20260108123000Z'), Date.UTC(2026, 0, 8, 12, 30, 0))
        assert.equal(parseGeneralizedTime('2026010812Z'), Date.UTC(2026, 0, 8, 12))
        assert.equal(parseGeneralizedTime('2026010812.5Z'), Date.UTC(2026, 0, 8, 12, 30))
        assert.equal(parseGeneralizedTime('20260108123000,25+0800'), Date.UTC(2026, 0, 8, 4, 30, 0, 250))
        assert.equal(parseGeneralizedTime('20260230120000Z'), undefined)
        assert.equal(parseGeneralizedTime('20260108123000'), undefined)
        assert.equal(formatGeneralizedTime(Date.UTC(2026, 0, 8, 12, 30, 0)), '20260108123000Z')
        assert.equal(formatGeneralizedTime(new Date(Date.UTC(2026, 0, 8, 12, 30, 0, 250))), '20260108123000.250Z')
    })
})
