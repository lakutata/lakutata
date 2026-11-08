import {DN} from '../dn/DN.js'
import type {PartialAttribute} from '../protocol/Messages.js'
import {formatGeneralizedTime} from '../schema/MatchingRules.js'
import type {Schema} from '../schema/Schema.js'
import {stringifyAttributeType, stringifyMatchingRule, stringifyObjectClass, stringifySyntax} from '../schema/Definitions.js'
import type {DirectoryEntry} from './Types.js'

/**
 * What the root DSE of a server says about it
 */
export interface RootDSEInfo {
    namingContexts: string[]
    defaultNamingContext?: string
    controls: string[]
    extensions: string[]
    saslMechanisms: string[]
    features: string[]
    subschemaSubentry: string
    vendorName?: string
    vendorVersion?: string
    extra?: PartialAttribute[]
}

/**
 * An attribute of text values
 * @param type The type.
 * @param values The values.
 */
function text(type: string, values: (string | undefined)[]): PartialAttribute[] {
    const present: string[] = values.filter((value: string | undefined): value is string => value !== undefined && value !== '')
    return present.length ? [{type: type, values: present.map((value: string): Buffer => Buffer.from(value, 'utf8'))}] : []
}

/**
 * The root DSE (RFC 4512 §5.1), from what the server actually handles
 * @param info What the server handles.
 */
export function rootDSEEntry(info: RootDSEInfo): DirectoryEntry {
    return {
        dn: DN.parse(''),
        attributes: [
            ...text('objectClass', ['top']),
            ...text('namingContexts', info.namingContexts),
            ...text('supportedLDAPVersion', ['3']),
            ...text('supportedControl', info.controls),
            ...text('supportedExtension', info.extensions),
            ...text('supportedFeatures', info.features),
            ...text('supportedSASLMechanisms', info.saslMechanisms),
            ...text('subschemaSubentry', [info.subschemaSubentry]),
            ...text('vendorName', [info.vendorName]),
            ...text('vendorVersion', [info.vendorVersion]),
            //Not in a schema: read by Jenkins, SSSD and nslcd, as Active Directory gives it
            ...text('defaultNamingContext', [info.defaultNamingContext]),
            ...info.extra ?? []
        ]
    }
}

/**
 * The subschema subentry (RFC 4512 §4.2): the definitions of the schema of the server
 * @param schema The schema.
 * @param dn Its DN.
 * @param created When the server started.
 */
export function subschemaEntry(schema: Schema, dn: DN, created: Date): DirectoryEntry {
    const time: string = formatGeneralizedTime(created).replace(/\.\d+Z$/, 'Z')
    return {
        dn: dn,
        attributes: [
            ...text('objectClass', ['top', 'subentry', 'subschema', 'extensibleObject']),
            ...text('cn', [dn.rdn()?.attributes[0]?.value ?? 'Subschema']),
            ...text('ldapSyntaxes', schema.syntaxes().map(stringifySyntax)),
            ...text('matchingRules', schema.matchingRules().map(stringifyMatchingRule)),
            ...text('attributeTypes', schema.attributeTypes().map(stringifyAttributeType)),
            ...text('objectClasses', schema.objectClasses().map(stringifyObjectClass)),
            ...text('createTimestamp', [time]),
            ...text('modifyTimestamp', [time])
        ]
    }
}

/**
 * The read-only view of the schema files as OpenLDAP's `cn=config` shows them: `cn=config`, `cn=schema,cn=config`, and
 * one `cn={N}<name>,cn=schema,cn=config` entry (`olcSchemaConfig`) per file
 * @param files The schema files, in the order they loaded, as schemas of their own.
 */
export function schemaConfigEntries(files: {name: string, schema: Schema}[]): DirectoryEntry[] {
    const entries: DirectoryEntry[] = [
        {dn: DN.parse('cn=config'), attributes: [...text('objectClass', ['olcGlobal']), ...text('cn', ['config'])]},
        {dn: DN.parse('cn=schema,cn=config'), attributes: [...text('objectClass', ['olcSchemaConfig']), ...text('cn', ['schema'])]}
    ]
    files.forEach((file: {name: string, schema: Schema}, index: number): void => {
        const name: string = `{${index}}${file.name}`
        entries.push({
            dn: DN.parse(`cn=${name},cn=schema,cn=config`),
            attributes: [
                ...text('objectClass', ['olcSchemaConfig']),
                ...text('cn', [name]),
                ...text('olcAttributeTypes', file.schema.attributeTypes().map((definition, position: number): string => `{${position}}${stringifyAttributeType(definition)}`)),
                ...text('olcObjectClasses', file.schema.objectClasses().map((definition, position: number): string => `{${position}}${stringifyObjectClass(definition)}`))
            ]
        })
    })
    return entries
}
