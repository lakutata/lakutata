# @lakutata/ldap

English | [中文](README.zh-CN.md)

LDAP for the [lakutata](https://www.npmjs.com/package/lakutata) framework. The `LDAPClient` component gives an
application a pool of connections to an LDAP server (OpenLDAP, Active Directory, 389 Directory Server…), bound as one
identity, opened on the first operation and closed with the application. The protocol and the client come from
[`@lakutata/ldap-engine`](https://www.npmjs.com/package/@lakutata/ldap-engine), which this package re-exports.

## Installation

```shell
npm install lakutata @lakutata/ldap
```

Node.js `>=18.10.0`, Bun, Electron and NW.js.

## Usage

```typescript
import {Application} from 'lakutata'
import {buildLDAPClientOptions, filter, type LDAPClient} from '@lakutata/ldap'

Application.run(() => ({
    id: 'directory.app',
    name: 'Directory',
    components: {
        ldap: buildLDAPClientOptions({
            url: 'ldaps://dc1.example.com',
            bindDN: 'CN=svc-app,OU=Service,DC=example,DC=com',
            password: process.env.LDAP_PASSWORD
        })
    }
})).onLaunched(async (app) => {
    const ldap: LDAPClient = await app.getObject('ldap')
    const name: string = 'alice'
    const {entries} = await ldap.search('DC=example,DC=com', {
        filter: filter`(&(objectClass=user)(sAMAccountName=${name}))`,
        attributes: ['displayName', 'mail', 'memberOf']
    })
    console.log(entries[0]?.get('memberOf'))

    const result = await ldap.authenticate({username: 'alice', password: 'secret', base: 'DC=example,DC=com', attribute: 'sAMAccountName'})
    console.log(result.ok ? result.dn : result.reason)
})
```

The component has the operations of an LDAP connection (`search()`, `searchIterator()`, `compare()`, `add()`,
`modify()`, `delete()`, `modifyDN()`, `extended()`, `passwordModify()`, `whoAmI()`), `authenticate()` to check a user's
password on a connection of its own, `readSchema()`, and `connect()` for a connection apart from the pool. Searches are
paged, and a result that is not a success throws its exception; see the README of `@lakutata/ldap-engine`.
`authenticate()` sends passwords only over TLS (an `ldaps` URL or `startTLS: true`) or a local `ldapi` socket, unless it
is given `requireTLS: false`.

## Options

| Option | Default | What it is |
|---|---|---|
| `url` | | The LDAP URL of the server, or of several tried in order |
| `srv` | | A DNS SRV record naming the servers, instead of `url` |
| `bindDN`, `password` | anonymous | The identity of the pool |
| `tls` | | The options of TLS (`ca`, `cert`, `key`, `rejectUnauthorized`…) |
| `startTLS` | `false` | Run StartTLS on each connection of an `ldap://` URL |
| `poolSize` | `4` | The most connections of the pool |
| `connectTimeout` | `5000` | The milliseconds a connection may take |
| `timeout` | `30000` | The milliseconds an operation may take before it is abandoned (`0` for none) |
| `idleTimeout` | `600000` | Close a connection idle that many milliseconds |
| `maxMessageSize` | 64 MiB | The largest message a server may send |
| `binaryAttributes` | | More attributes whose values are bytes |

## API

| Export | What it is |
|---|---|
| `LDAPClient` | The component |
| `buildLDAPClientOptions(options)` | Its options, for the `components` of an application |
| `LDAPClientOptions` | The type of its options |
| Everything `@lakutata/ldap-engine` exports | The protocol and the client |
