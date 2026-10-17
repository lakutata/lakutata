# Lakutata Security

`lakutata/security` (package `@lakutata/security`) provides password hashing with bcrypt (`PasswordHash`), message
signatures with HMAC (`Mac`) and authenticated encryption with AES-256-GCM (`Crypt`), the last two with key rotation,
and the functions they are built on. It uses `node:crypto` (bcrypt is implemented in JavaScript) and has no optional
dependency. `lakutata/provider/passwordHash` exports `PasswordHash` alone. The README of `@lakutata/security` gives the
details.

## 1. The providers

`PasswordHash`, `Mac` and `Crypt` are providers: declare them in the `providers` of the application, with their keys
read from the environment, then get them with `getObject()` or `@Inject`.

```typescript
import {Application} from 'lakutata'
import {Crypt, generateSecret, Mac, PasswordHash} from 'lakutata/security'

Application
    .run(() => ({
        id: 'security.app',
        name: 'Security',
        providers: {
            //saltRounds: 4 to 31, 10 by default
            passwordHash: {class: PasswordHash, saltRounds: 12},
            //The first key signs and encrypts, every key verifies and decrypts
            mac: {class: Mac, keys: [process.env.MAC_KEY ?? generateSecret()], algorithm: 'sha256'},
            crypt: {class: Crypt, keys: [process.env.CRYPT_KEY ?? generateSecret(), process.env.CRYPT_PREVIOUS_KEY ?? generateSecret()]}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const passwordHash: PasswordHash = await app.getObject<PasswordHash>('passwordHash')
        //A new salt for every hash
        const hash: string = await passwordHash.hash('correct horse battery staple')
        console.log(await passwordHash.validate('correct horse battery staple', hash))

        const mac: Mac = await app.getObject<Mac>('mac')
        //'user:42.<signature>'
        const token: string = mac.signMessage('user:42')
        //InvalidSignatureException when the message was changed
        console.log(mac.unsignMessage(token))
        //A detached signature
        const signature: string = mac.sign('payload')
        console.log(mac.verify('payload', signature))

        const crypt: Crypt = await app.getObject<Crypt>('crypt')
        //AES-256-GCM, base64url; DecryptionFailedException when the data was changed
        const encrypted: string = crypt.encrypt('api-token-123')
        console.log(crypt.decryptString(encrypted), crypt.decrypt(encrypted).length)
    })
```

- **Passwords**: `PasswordHash.hash()` rejects the passwords longer than 72 bytes in UTF-8 (bcrypt ignores the
  following bytes) with `PasswordTooLongException`, and `validate()` gives `false` for them. Store the hash as it is and
  check it with `validate()`, never with `===`.
- **Keys**: the keys of `Mac` and `Crypt` are strings of at least 16 characters. Generate them with `generateSecret()`
  (32 random bytes, base64url): a password used as a key is open to brute force.
- **Key rotation**: put the new key first and keep the previous ones while the data they signed or encrypted is still
  read.
- **Formats**: the signatures and the encrypted data are base64url strings without padding, safe in URLs and cookies.

## 2. Which tool for which secret

| Need | Use |
|---|---|
| Store a user password, check it at login | `PasswordHash` (bcrypt: slow and salted) |
| Detect tampering (cookies, links, webhooks) | `Mac`, `hmac()` / `verifyHMAC()` |
| Hide data and read it back | `Crypt`, `encryptByKey()` / `decryptByKey()` |
| Encrypt with a passphrase typed by a person | `encryptByPassword()` / `decryptByPassword()` (scrypt) |
| Generate a key or a token | `generateSecret()` |
| Compare a secret received with the expected one | `constantTimeEqual()` |

## 3. The functions

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

//Signatures ('sha256', 'sha384', 'sha512')
const body: string = JSON.stringify({order: 42})
const signature: string = hmac(body, key, 'sha512')
console.log(verifyHMAC(body, signature, key, 'sha512'))

//Encrypted with a key, decrypted with any of the keys given: the current one or a previous one
const encrypted: string = encryptByKey('card ending 4242', key)
console.log(decryptByKey(encrypted, [key, generateSecret()]).toString('utf8'))

//Encryption with a passphrase (scrypt, asynchronous)
const backup: string = await encryptByPassword('backup contents', 'a long passphrase')
console.log((await decryptByPassword(backup, 'a long passphrase')).toString('utf8'))

//Constant-time comparison of a presented token
console.log(constantTimeEqual('presented-token', process.env.API_TOKEN ?? ''))
```

## 4. Errors

| Exception | When |
|---|---|
| `PasswordTooLongException` | `PasswordHash.hash()` with a password longer than 72 bytes in UTF-8 |
| `InvalidSignatureException` | `Mac.unsignMessage()` with a message that was changed, that has no signature, or that an unknown key signed |
| `DecryptionFailedException` | `Crypt.decrypt()`, `decryptString()`, `decryptByKey()`, `decryptByPassword()`: a wrong key or password, changed or truncated data |
| `InvalidObjectOptionsException` (from `lakutata`) | The application starts with invalid provider options: no key, a key shorter than 16 characters, an unknown algorithm, `saltRounds` outside 4 to 31 |

`verify()`, `verifyHMAC()`, `validate()` and `constantTimeEqual()` return `false` for a wrong or malformed signature,
hash or secret instead of throwing.
