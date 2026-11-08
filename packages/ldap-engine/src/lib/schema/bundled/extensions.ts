//The definitions of the bundled schema that no RFC gives in the form of RFC 4512, written for the engine

/**
 * The operational attributes the engine gives that come from X.500 rather than an LDAP RFC, as a subschema entry in LDIF:
 * hasSubordinates (X.501)
 */
export const EXTENSIONS_SCHEMA: string = `dn: cn=extensions,cn=schema
cn: extensions
objectClass: subschema
# X.501 (ITU-T Rec. X.501) hasSubordinates: whether the entry has entries below it
attributeTypes: ( 2.5.18.9 NAME 'hasSubordinates' EQUALITY booleanMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.7 SINGLE-VALUE NO-USER-MODIFICATION USAGE directoryOperation )
`
