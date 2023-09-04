## Description

Encapsulate symmetric encryption and asymmetric encryption into separate classes, providing alternative interfaces
within the classes (pure JS implementation when the encryption library used by Node.js cannot provide encryption
functionality). This facilitates calling in an object-oriented programming manner.

## Crypto Abstract Class

### AsymmetricEncryption

The following classes inherit from this abstract class:

- `RSA`
- `SM2`

### SymmetricEncryption

The following classes inherit from this abstract class:

- `AES128`
- `AES192`
- `AES256`
- `DES`
- `TripleDES`
- `ARIA128`
- `ARIA192`
- `ARIA256`
- `CAMELLIA128`
- `CAMELLIA192`
- `CAMELLIA256`

## Asymmetric classes

### `RSA`

```typescript
import {RSA} from 'lakutata/crypto'

const keyPair = RSA.generateKeyPair()
const instance = RSA.loadKeyPair(keyPair)
const signed = instance.private.sign('test message')
instance.public.verify('test message', signed)

```

### `SM2`

```typescript
import {SM2} from 'lakutata/crypto'

const keyPair = SM2.generateKeyPair()
const instance = SM2.loadKeyPair(keyPair)
const signed = instance.private.sign('test message')
instance.public.verify('test message', signed)
```

## Symmetric classes

### `AES128`

```typescript
import {AES128} from 'lakutata/crypto'

const cryptor = new AES128(AES128.generateKey(), AES128.generateIV())
const encrypted = cryptor.encrypt('test message')
crypto.decrypt(encrypted)
```

### `AES192`

```typescript
import {AES192} from 'lakutata/crypto'

const cryptor = new AES192(AES192.generateKey(), AES192.generateIV())
const encrypted = cryptor.encrypt('test message')
crypto.decrypt(encrypted)
```

### `AES256`

```typescript
import {AES256} from 'lakutata/crypto'

const cryptor = new AES256(AES256.generateKey(), AES256.generateIV())
const encrypted = cryptor.encrypt('test message')
crypto.decrypt(encrypted)
```

### `DES`

```typescript
import {DES} from 'lakutata/crypto'

const cryptor = new DES(DES.generateKey(), DES.generateIV())
const encrypted = cryptor.encrypt('test message')
crypto.decrypt(encrypted)
```

### `TripleDES`

```typescript
import {TripleDES} from 'lakutata/crypto'

const cryptor = new TripleDES(TripleDES.generateKey(), TripleDES.generateIV())
const encrypted = cryptor.encrypt('test message')
crypto.decrypt(encrypted)
```

### `ARIA128`

```typescript
import {ARIA128} from 'lakutata/crypto'

const cryptor = new ARIA128(ARIA128.generateKey(), ARIA128.generateIV())
const encrypted = cryptor.encrypt('test message')
crypto.decrypt(encrypted)
```

### `ARIA192`

```typescript
import {ARIA192} from 'lakutata/crypto'

const cryptor = new ARIA192(ARIA192.generateKey(), ARIA192.generateIV())
const encrypted = cryptor.encrypt('test message')
crypto.decrypt(encrypted)
```

### `ARIA256`

```typescript
import {ARIA256} from 'lakutata/crypto'

const cryptor = new ARIA256(ARIA256.generateKey(), ARIA256.generateIV())
const encrypted = cryptor.encrypt('test message')
crypto.decrypt(encrypted)
```

### `CAMELLIA128`

```typescript
import {CAMELLIA128} from 'lakutata/crypto'

const cryptor = new CAMELLIA128(CAMELLIA128.generateKey(), CAMELLIA128.generateIV())
const encrypted = cryptor.encrypt('test message')
crypto.decrypt(encrypted)
```

### `CAMELLIA192`

```typescript
import {CAMELLIA192} from 'lakutata/crypto'

const cryptor = new CAMELLIA192(CAMELLIA192.generateKey(), CAMELLIA192.generateIV())
const encrypted = cryptor.encrypt('test message')
crypto.decrypt(encrypted)
```

### `CAMELLIA256`

```typescript
import {CAMELLIA256} from 'lakutata/crypto'

const cryptor = new CAMELLIA256(CAMELLIA256.generateKey(), CAMELLIA256.generateIV())
const encrypted = cryptor.encrypt('test message')
crypto.decrypt(encrypted)
```
