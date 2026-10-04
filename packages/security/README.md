# @lakutata/security

The security toolkit of the lakutata framework, built on `node:crypto`: password hashing with bcrypt (`PasswordHash`),
message signatures with HMAC (`Mac`), authenticated encryption with AES-256-GCM (`Crypt`), with key rotation, and the
functions under them (random keys, constant-time comparison, encryption with a key or a password). The umbrella package
`lakutata` re-exports it as `lakutata/security`, and `PasswordHash` alone as `lakutata/provider/passwordHash`.

## Installation

```shell
npm install lakutata
```

It has no optional dependencies: bcrypt is implemented in JavaScript, the rest uses `node:crypto`.

## Usage

### The providers in an application

Declare the providers in the `providers` of the application, with their keys read from the environment, then get them
with `getObject()` or `@Inject`. They are scoped, like every provider.

```typescript
import {Application} from 'lakutata'
import {Crypt, GenerateKey, Mac, PasswordHash} from 'lakutata/security'

Application
    .run(() => ({
        id: 'security.app',
        name: 'Security',
        providers: {
            passwordHash: {class: PasswordHash, saltRounds: 12},
            //The first key signs and encrypts, every key verifies and decrypts
            mac: {class: Mac, keys: [process.env.MAC_KEY ?? GenerateKey()], algorithm: 'sha256'},
            crypt: {class: Crypt, keys: [process.env.CRYPT_KEY ?? GenerateKey(), process.env.CRYPT_PREVIOUS_KEY ?? GenerateKey()]}
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
| Detect tampering (cookies, links, webhooks) | `Mac`, `HMAC()` / `VerifyHMAC()` | no: fast, needs a random key | base64url HMAC (43 characters with SHA-256) |
| Hide and protect data, read it back | `Crypt`, `EncryptByKey()` / `DecryptByKey()` | no: needs a random key | base64url: version, salt, IV, tag, ciphertext |
| Encrypt with a passphrase typed by a person | `EncryptByPassword()` / `DecryptByPassword()` | yes, for encryption (scrypt) | same format, another version |
| Generate a key or a token | `GenerateKey()` | — | base64url random bytes (32 by default) |
| Compare a secret received with the expected one | `TimingSafeEqual()` | no: use `PasswordHash.validate()` | boolean |

- **Passwords**: `PasswordHash.hash()` rejects passwords longer than 72 bytes in UTF-8 (bcrypt ignores the following
  bytes) with `PasswordTooLongException`, and `validate()` gives `false` for them. Each hash has its own random salt and
  its cost (`saltRounds`, 4 to 31, 10 by default: each extra round doubles the time); store the hash as is and check it
  with `validate()`, never with `===`. `validate()` gives `false` for a value which is not a bcrypt hash.
- **Keys**: the keys of `Mac` and `Crypt` are strings of at least 16 characters, used as their UTF-8 bytes. Generate
  them with `GenerateKey()` (32 random bytes): the key derivations of `Mac`, `Crypt` and `EncryptByKey()` are fast, so a
  password used as a key is open to brute force. The functions refuse an empty key with a `RangeError`, but do not
  check the key's length otherwise.
- **Key rotation**: put the new key first and keep the previous ones while the data they signed or encrypted is read;
  the first key signs and encrypts, every key verifies and decrypts.
- **Formats**: the signatures and the encrypted data are base64url strings without padding, safe in URLs and cookies.
  The encrypted data is authenticated: any change makes the decryption fail rather than return altered data.

### The functions

```typescript
import {
    DecryptByKey,
    DecryptByPassword,
    EncryptByKey,
    EncryptByPassword,
    GenerateKey,
    HMAC,
    TimingSafeEqual,
    VerifyHMAC
} from 'lakutata/security'

const key: string = GenerateKey()

//Signatures: the raw body and its signature, sent in a header
const body: string = JSON.stringify({order: 42})
const signature: string = HMAC(body, key, 'sha512')
console.log(VerifyHMAC(body, signature, key, 'sha512'))

//Encryption with a random key, decrypted with the current or a previous key
const encrypted: string = EncryptByKey('card ending 4242', key)
console.log(DecryptByKey(encrypted, [key, GenerateKey()]).toString('utf8'))

//Encryption with a passphrase (scrypt, asynchronous)
const backup: string = await EncryptByPassword('backup contents', 'a long passphrase')
console.log((await DecryptByPassword(backup, 'a long passphrase')).toString('utf8'))

//Constant-time comparison of a presented token
console.log(TimingSafeEqual('presented-token', process.env.API_TOKEN ?? ''))
```

## API

| Export | What it is |
|---|---|
| `PasswordHash` | Provider hashing passwords with bcrypt: `hash()`, `validate()`; the option `saltRounds` (default 10) |
| `Mac` | Provider signing with HMAC and key rotation: `sign()`, `verify()`, `signMessage()`, `unsignMessage()`; the options `keys`, `algorithm` (default `'sha256'`) |
| `Crypt` | Provider encrypting with AES-256-GCM and key rotation: `encrypt()`, `decrypt()`, `decryptString()`; the option `keys` |
| `HMAC`, `VerifyHMAC` | Sign data with a key, check a signature in constant time |
| `HMACAlgorithm` | The hash functions of the signatures: `'sha256'`, `'sha384'`, `'sha512'` |
| `EncryptByKey`, `DecryptByKey` | Authenticated encryption with a random key (HKDF-SHA256 per message) |
| `EncryptByPassword`, `DecryptByPassword` | Authenticated encryption with a password (scrypt) |
| `GenerateKey` | A random key or token, base64url |
| `TimingSafeEqual` | Compare two secrets in constant time, whatever their lengths |
| `PasswordTooLongException`, `InvalidSignatureException`, `DecryptionFailedException` | The exceptions |

All are exported by `lakutata/security` and `@lakutata/security`. The typings document each declaration with examples.

## Errors

| Exception | When |
|---|---|
| `PasswordTooLongException` (`E_PASSWORD_TOO_LONG`) | `PasswordHash.hash()` with a password longer than 72 bytes in UTF-8 |
| `InvalidSignatureException` (`E_INVALID_SIGNATURE`) | `Mac.unsignMessage()` with a message changed, unsigned or signed by an unknown key |
| `DecryptionFailedException` (`E_DECRYPTION_FAILED`) | `Crypt.decrypt()`, `decryptString()`, `DecryptByKey()`, `DecryptByPassword()`: a wrong key or password, changed or truncated data |
| `InvalidObjectOptionsException` (from `lakutata`) | The application starts with invalid provider options: no key, a key shorter than 16 characters, an unknown algorithm, `saltRounds` outside 4 to 31 (`InvalidValueException` when the provider is created outside the checked options, as in a bare `Container`) |
| `RangeError` | `GenerateKey()` with a negative or too large number of bytes; `HMAC()`, `VerifyHMAC()`, `EncryptByKey()`, `DecryptByKey()` with an empty key |

The exceptions have the HTTP status 500 unless the application maps them; `verify()`, `VerifyHMAC()` (given a key),
`validate()` and `TimingSafeEqual()` return `false` for a wrong or malformed signature, hash or secret instead of
throwing.

## See also

- `doc/en/Security.md` of the package `lakutata` (Chinese in `doc/zh`): the guide of the security tools.
- `@lakutata/core` (`lakutata`): the providers, `Application` and the dependency injection.
