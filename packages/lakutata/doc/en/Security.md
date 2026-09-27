# Lakutata Security

`lakutata/security` provides password hashing, signatures and encryption, built on Node's `node:crypto` (and bcrypt
for passwords). The providers read their keys from the configuration; the functions take them as arguments.

## Password hashing

```typescript
import {PasswordHash} from 'lakutata/security'

const passwordHash = await app.getObject(PasswordHash)      // configurable: saltRounds (default 10)
const hash = await passwordHash.hash(password)               // a new salt for every hash
const valid = await passwordHash.validate(password, hash)
```

Passwords longer than 72 bytes (UTF-8) are rejected with `PasswordTooLongException`: bcrypt ignores the following bytes.

## Signatures (`Mac`)

```typescript
import {Mac} from 'lakutata/security'

// Configuration: {keys: [process.env.MAC_KEY], algorithm: 'sha256'}
const signed = mac.signMessage('user.42')                   // 'user.42.<signature>'
const message = mac.unsignMessage(signed)                    // throws InvalidSignatureException when changed
const signature = mac.sign(data)                             // a detached signature
mac.verify(data, signature)
```

## Encryption (`Crypt`)

```typescript
import {Crypt} from 'lakutata/security'

// Configuration: {keys: [process.env.CRYPT_KEY]}
const encrypted = crypt.encrypt('secret')                    // AES-256-GCM, base64url
const secret = crypt.decryptString(encrypted)                // throws DecryptionFailedException when changed
```

## Key rotation

`Mac` and `Crypt` take a list of keys (at least 16 characters each; generate them with `GenerateKey()`): the first key
signs and encrypts, every key verifies and decrypts. To rotate, put the new key first and keep the previous ones while
the data they signed or encrypted is still read.

## Functions

| Function | Purpose |
|---|---|
| `TimingSafeEqual(a, b)` | Compare secrets in constant time |
| `GenerateKey(bytes = 32)` | A random key, base64url |
| `HMAC(data, key, algorithm)` / `VerifyHMAC(data, signature, key, algorithm)` | Signatures (`sha256`, `sha384`, `sha512`) |
| `EncryptByKey(data, key)` / `DecryptByKey(encrypted, keys)` | Authenticated encryption with keys |
| `EncryptByPassword(data, password)` / `DecryptByPassword(encrypted, password)` | Authenticated encryption with a password (scrypt) |
