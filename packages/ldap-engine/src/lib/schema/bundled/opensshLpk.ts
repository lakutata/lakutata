//Written for the engine: the two definitions the openssh-lpk project (the LDAP public keys of OpenSSH) published, with
//its OIDs and names, which Gitea, SSSD and the AuthorizedKeysCommand scripts read

/**
 * The SSH public keys of the accounts (openssh-lpk), as a subschema entry in LDIF: sshPublicKey and ldapPublicKey
 */
export const OPENSSH_LPK_SCHEMA: string = `dn: cn=openssh-lpk,cn=schema
cn: openssh-lpk
objectClass: subschema
# openssh-lpk: an SSH public key, as authorized_keys writes it
attributeTypes: ( 1.3.6.1.4.1.24552.500.1.1.1.13 NAME 'sshPublicKey' DESC 'OpenSSH public key' EQUALITY octetStringMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.40 )
# openssh-lpk: the class of the entries with SSH public keys
objectClasses: ( 1.3.6.1.4.1.24552.500.1.1.2.0 NAME 'ldapPublicKey' DESC 'OpenSSH LDAP public key' SUP top AUXILIARY MAY ( sshPublicKey $ uid ) )
`
