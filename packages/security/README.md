# @lakutata/security

English | [中文](README.zh-CN.md)

The security toolkit of the lakutata framework, built on `node:crypto`: password hashing with bcrypt (`PasswordHash`),
message signatures with HMAC (`Mac`) and authenticated encryption with AES-256-GCM (`Crypt`), both with key rotation,
plus lower-level functions (HMAC signatures, random keys, constant-time comparison, encryption with a key or a
password). The umbrella package `lakutata` re-exports it as `lakutata/security`, and `PasswordHash` alone as
`lakutata/provider/passwordHash`.

## Installation

```shell
npm install lakutata
```

It has no optional dependencies: bcrypt is implemented in JavaScript, the rest uses `node:crypto`.

## Usage

### The providers in an application

Declare the providers in the application's `providers`, with their keys read from the environment, then get them with
`getObject()` or `@Inject`. They are scoped, the default lifetime of providers.

```typescript
import {Application} from 'lakutata'
import {Crypt, generateSecret, Mac, PasswordHash} from 'lakutata/security'

Application
    .run(() => ({
        id: 'security.app',
        name: 'Security',
        providers: {
            passwordHash: {class: PasswordHash, saltRounds: 12},
            //The first key signs and encrypts, every key verifies and decrypts
            mac: {class: Mac, keys: [process.env.MAC_KEY ?? generateSecret()], algorithm: 'sha256'},
            crypt: {class: Crypt, keys: [process.env.CRYPT_KEY ?? generateSecret(), process.env.CRYPT_PREVIOUS_KEY ?? generateSecret()]}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const passwordHash: PasswordHash = await app.getObject('passwordHash')
        const hash: string = await passwordHash.hash('correct horse battery staple')
        console.log(await passwordHash.validate('correct horse battery staple', hash))

        const mac: Mac = await app.getObject('mac')
        const token: string = mac.signMessage('user:42')
        console.log(mac.unsignMessage(token))

        const crypt: Crypt = await app.getObject('crypt')
        console.log(crypt.decryptString(crypt.encrypt('api-token-123')))
    })
```

### Which tool for which secret

| Need | Use | Fit for passwords | Output |
|---|---|---|---|
| Store a user password, check it at login | `PasswordHash` (bcrypt) | yes: slow and salted | 60-character bcrypt hash (`$2b$10$...`) |
| Detect tampering (cookies, links, webhooks) | `Mac`, `hmac()` / `verifyHMAC()` | no: fast, needs a random key | base64url HMAC (43 characters with SHA-256) |
| Hide and protect data, read it back | `Crypt`, `encryptByKey()` / `decryptByKey()` | no: needs a random key | base64url: version, salt, IV, tag, ciphertext |
| Encrypt with a passphrase typed by a person | `encryptByPassword()` / `decryptByPassword()` | yes, for encryption (scrypt) | same format, another version |
| Generate a key or a token | `generateSecret()` | — | base64url random bytes (32 by default) |
| Compare a secret received with the expected one | `constantTimeEqual()` | no: use `PasswordHash.validate()` | boolean |

- **Passwords**: `PasswordHash.hash()` rejects a password longer than 72 bytes in UTF-8 with
  `PasswordTooLongException` (bcrypt would ignore the extra bytes), and `validate()` returns `false` for such
  passwords. Each hash includes its own random salt and its cost (`saltRounds`, 4 to 31, 10 by default; each extra
  round doubles the time). Store the hash as is and check it with `validate()`, never with `===`. `validate()` returns
  `false` for a value that is not a bcrypt hash.
- **Keys**: the keys of `Mac` and `Crypt` are strings of at least 16 characters, used as UTF-8 bytes. Generate them
  with `generateSecret()` (32 random bytes): `Mac`, `Crypt` and `encryptByKey()` process their keys quickly, without
  slow key stretching, so a password used as a key is open to brute force. The functions reject an empty key with a
  `RangeError` but do not otherwise check its length.
- **Key rotation**: put the new key first, and keep the previous ones as long as data they signed or encrypted is still
  read. The first key signs and encrypts; every key verifies and decrypts.
- **Formats**: signatures and encrypted data are base64url strings without padding, safe in URLs and cookies.
  Encrypted data is authenticated: any change makes decryption fail instead of returning altered data.

### The functions

```typescript
import {
    decryptByKey,
    decryptByPassword,
    encryptByKey,
    encryptByPassword,
    generateSecret,
    hmac,
    constantTimeEqual,
    verifyHMAC
} from 'lakutata/security'

const key: string = generateSecret()

//Signatures: the raw body and its signature, sent in a header
const body: string = JSON.stringify({order: 42})
const signature: string = hmac(body, key, 'sha512')
console.log(verifyHMAC(body, signature, key, 'sha512'))

//Encryption with a random key, decrypted with the current or a previous key
const encrypted: string = encryptByKey('card ending 4242', key)
console.log(decryptByKey(encrypted, [key, generateSecret()]).toString('utf8'))

//Encryption with a passphrase (scrypt, asynchronous)
const backup: string = await encryptByPassword('backup contents', 'a long passphrase')
console.log((await decryptByPassword(backup, 'a long passphrase')).toString('utf8'))

//Constant-time comparison of a presented token
console.log(constantTimeEqual('presented-token', process.env.API_TOKEN ?? ''))
```

## API

| Export | What it is |
|---|---|
| `PasswordHash` | Provider hashing passwords with bcrypt: `hash()`, `validate()`; the option `saltRounds` (default 10) |
| `Mac` | Provider signing with HMAC and key rotation: `sign()`, `verify()`, `signMessage()`, `unsignMessage()`; the options `keys`, `algorithm` (default `'sha256'`) |
| `Crypt` | Provider encrypting with AES-256-GCM and key rotation: `encrypt()`, `decrypt()`, `decryptString()`; the option `keys` |
| `hmac`, `verifyHMAC` | Sign data with a key, check a signature in constant time |
| `HMACAlgorithm` | The hash functions of the signatures: `'sha256'`, `'sha384'`, `'sha512'` |
| `encryptByKey`, `decryptByKey` | Authenticated encryption with a random key (HKDF-SHA256 per message) |
| `encryptByPassword`, `decryptByPassword` | Authenticated encryption with a password (scrypt) |
| `generateSecret` | A random key or token, base64url |
| `constantTimeEqual` | Compare two secrets in constant time, whatever their lengths |
| `PasswordTooLongException`, `InvalidSignatureException`, `DecryptionFailedException` | The exceptions |

All of them are exported by `lakutata/security` and `@lakutata/security`. The typings document each declaration with
examples.

## Errors

| Exception | When |
|---|---|
| `PasswordTooLongException` (`E_PASSWORD_TOO_LONG`) | `PasswordHash.hash()` with a password longer than 72 bytes in UTF-8 |
| `InvalidSignatureException` (`E_INVALID_SIGNATURE`) | `Mac.unsignMessage()` with a message changed, unsigned or signed by an unknown key |
| `DecryptionFailedException` (`E_DECRYPTION_FAILED`) | `Crypt.decrypt()`, `decryptString()`, `decryptByKey()`, `decryptByPassword()`: a wrong key or password, changed or truncated data |
| `InvalidObjectOptionsException` (from `lakutata`) | The application starts with invalid provider options: no key, a key shorter than 16 characters, an unknown algorithm, `saltRounds` outside 4 to 31 (a provider created without this check, by a bare `Container` for example, throws `InvalidValueException` instead) |
| `RangeError` | `generateSecret()` with a negative or too large number of bytes; `hmac()`, `verifyHMAC()`, `encryptByKey()`, `decryptByKey()` with an empty key |

These exceptions have the HTTP status 500 unless the application maps them. `verify()`, `verifyHMAC()` (given a key),
`validate()` and `constantTimeEqual()` return `false` for a wrong or malformed signature, hash or secret instead of
throwing.

## See also

- `doc/en/Security.md` in the `lakutata` package (Chinese in `doc/zh`): the guide to the security tools.
- `@lakutata/core` (`lakutata`): providers, `Application` and dependency injection.
