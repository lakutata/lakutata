# Lakutata 安全

`lakutata/security` 提供密码哈希、签名与加密，基于 Node 自带的 `node:crypto`（密码哈希使用 bcrypt）。Provider 从配置中读取密钥，函数则通过参数接收密钥。

## 密码哈希

```typescript
import {PasswordHash} from 'lakutata/security'

const passwordHash = await app.getObject(PasswordHash)      // 可配置 saltRounds（默认 10）
const hash = await passwordHash.hash(password)               // 每次哈希都使用新的盐
const valid = await passwordHash.validate(password, hash)
```

超过 72 字节（UTF-8）的密码会以 `PasswordTooLongException` 拒绝：bcrypt 会忽略之后的字节。

## 签名（`Mac`）

```typescript
import {Mac} from 'lakutata/security'

// 配置：{keys: [process.env.MAC_KEY], algorithm: 'sha256'}
const signed = mac.signMessage('user.42')                   // 'user.42.<签名>'
const message = mac.unsignMessage(signed)                    // 被篡改时抛出 InvalidSignatureException
const signature = mac.sign(data)                             // 独立的签名
mac.verify(data, signature)
```

## 加密（`Crypt`）

```typescript
import {Crypt} from 'lakutata/security'

// 配置：{keys: [process.env.CRYPT_KEY]}
const encrypted = crypt.encrypt('secret')                    // AES-256-GCM，base64url
const secret = crypt.decryptString(encrypted)                // 被篡改时抛出 DecryptionFailedException
```

## 密钥轮换

`Mac` 与 `Crypt` 接收一组密钥（每个至少 16 个字符，可用 `GenerateKey()` 生成）：第一个密钥用于签名和加密，所有密钥都可用于校验和解密。轮换时把新密钥放在第一位，并保留旧密钥，直到用它们签名或加密的数据不再被读取。

## 函数

| 函数 | 用途 |
|---|---|
| `TimingSafeEqual(a, b)` | 以常数时间比较机密值 |
| `GenerateKey(bytes = 32)` | 生成随机密钥（base64url） |
| `HMAC(data, key, algorithm)` / `VerifyHMAC(data, signature, key, algorithm)` | 签名（`sha256`、`sha384`、`sha512`） |
| `EncryptByKey(data, key)` / `DecryptByKey(encrypted, keys)` | 使用密钥的认证加密 |
| `EncryptByPassword(data, password)` / `DecryptByPassword(encrypted, password)` | 使用口令的认证加密（scrypt） |
