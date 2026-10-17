# @lakutata/security

[English](README.md) | 中文

lakutata 框架的安全工具包，构建在 `node:crypto` 之上：基于 bcrypt 的密码哈希（`PasswordHash`）、基于 HMAC 的消息签名（`Mac`）和基于 AES-256-GCM 的认证加密（`Crypt`），后两者都支持密钥轮换；另外还有更底层的函数（HMAC 签名、随机密钥、恒定时间比较、用密钥或口令加密）。`lakutata` 包通过 `lakutata/security` 重新导出它，并通过 `lakutata/provider/passwordHash` 单独导出 `PasswordHash`。

## 安装

```shell
npm install lakutata
```

它没有可选依赖：bcrypt 用 JavaScript 实现，其余部分使用 `node:crypto`。

## 用法

### 在应用中使用提供者

在应用的 `providers` 中声明这些提供者，密钥从环境变量读取，然后通过 `getObject()` 或 `@Inject` 获取它们。它们的生命周期类型是作用域（scoped），即提供者的默认类型。

```typescript
import {Application} from 'lakutata'
import {Crypt, generateSecret, Mac, PasswordHash} from 'lakutata/security'

Application
    .run(() => ({
        id: 'security.app',
        name: 'Security',
        providers: {
            passwordHash: {class: PasswordHash, saltRounds: 12},
            //第一个密钥用于签名和加密，所有密钥都可用于验证和解密
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

### 按用途选择工具

| 需求 | 使用 | 适合密码吗 | 输出 |
|---|---|---|---|
| 保存用户密码，登录时校验 | `PasswordHash`（bcrypt） | 适合：慢且加盐 | 60 个字符的 bcrypt 哈希（`$2b$10$...`） |
| 检测篡改（Cookie、链接、webhook） | `Mac`、`hmac()` / `verifyHMAC()` | 不适合：速度快，需要随机密钥 | base64url 格式的 HMAC（使用 SHA-256 时为 43 个字符） |
| 隐藏和保护数据，之后还能读回 | `Crypt`、`encryptByKey()` / `decryptByKey()` | 不适合：需要随机密钥 | base64url：版本、盐、IV、标签、密文 |
| 根据用户输入的口令加密 | `encryptByPassword()` / `decryptByPassword()` | 适合，用于加密（scrypt） | 格式相同，版本不同 |
| 生成密钥或令牌 | `generateSecret()` | — | base64url 格式的随机字节（默认 32 个） |
| 比较收到的秘密与预期值 | `constantTimeEqual()` | 不适合：请用 `PasswordHash.validate()` | 布尔值 |

- **密码**：`PasswordHash.hash()` 拒绝 UTF-8 编码超过 72 字节的密码，抛出 `PasswordTooLongException`（bcrypt 会忽略超出的字节）；对这类密码，`validate()` 返回 `false`。每个哈希都包含它自己的随机盐和计算成本（`saltRounds`，4 到 31，默认 10；每多一轮，耗时翻倍）。哈希值请原样保存，并用 `validate()` 校验，不要用 `===` 比较。值不是 bcrypt 哈希时，`validate()` 返回 `false`。
- **密钥**：`Mac` 和 `Crypt` 的密钥是至少 16 个字符的字符串，按 UTF-8 字节使用。请用 `generateSecret()` 生成（32 个随机字节）：`Mac`、`Crypt` 和 `encryptByKey()` 处理密钥很快，不做慢速的密钥拉伸，所以把密码当作密钥使用容易被暴力破解。这些函数遇到空密钥会抛出 `RangeError`，除此之外不检查密钥的长度。
- **密钥轮换**：把新密钥放在最前面；只要还要读取用旧密钥签名或加密的数据，就保留旧密钥。第一个密钥用于签名和加密，所有密钥都可用于验证和解密。
- **格式**：签名和加密数据都是不带填充的 base64url 字符串，可以安全地用于 URL 和 Cookie。加密数据经过认证：数据有任何改动，解密都会失败，而不是返回被改过的数据。

### 函数

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

//签名：原始请求体，以及放在请求头中发送的签名
const body: string = JSON.stringify({order: 42})
const signature: string = hmac(body, key, 'sha512')
console.log(verifyHMAC(body, signature, key, 'sha512'))

//用随机密钥加密，用当前的或之前的密钥解密
const encrypted: string = encryptByKey('card ending 4242', key)
console.log(decryptByKey(encrypted, [key, generateSecret()]).toString('utf8'))

//用口令加密（scrypt，异步）
const backup: string = await encryptByPassword('backup contents', 'a long passphrase')
console.log((await decryptByPassword(backup, 'a long passphrase')).toString('utf8'))

//以恒定时间比较收到的令牌
console.log(constantTimeEqual('presented-token', process.env.API_TOKEN ?? ''))
```

## API

| 导出 | 说明 |
|---|---|
| `PasswordHash` | 用 bcrypt 哈希密码的提供者：`hash()`、`validate()`；选项 `saltRounds`（默认 10） |
| `Mac` | 用 HMAC 签名并支持密钥轮换的提供者：`sign()`、`verify()`、`signMessage()`、`unsignMessage()`；选项 `keys`、`algorithm`（默认 `'sha256'`） |
| `Crypt` | 用 AES-256-GCM 加密并支持密钥轮换的提供者：`encrypt()`、`decrypt()`、`decryptString()`；选项 `keys` |
| `hmac`、`verifyHMAC` | 用密钥签名数据；以恒定时间校验签名 |
| `HMACAlgorithm` | 签名使用的哈希函数：`'sha256'`、`'sha384'`、`'sha512'` |
| `encryptByKey`、`decryptByKey` | 用随机密钥做认证加密（每条消息使用 HKDF-SHA256） |
| `encryptByPassword`、`decryptByPassword` | 用口令做认证加密（scrypt） |
| `generateSecret` | 随机密钥或令牌，base64url 格式 |
| `constantTimeEqual` | 以恒定时间比较两个秘密，无论它们的长度是否相同 |
| `PasswordTooLongException`、`InvalidSignatureException`、`DecryptionFailedException` | 异常 |

以上全部由 `lakutata/security` 和 `@lakutata/security` 导出。类型声明中的每一项都附有说明和示例。

## 错误

| 异常 | 什么时候 |
|---|---|
| `PasswordTooLongException`（`E_PASSWORD_TOO_LONG`） | `PasswordHash.hash()` 的密码 UTF-8 编码超过 72 字节 |
| `InvalidSignatureException`（`E_INVALID_SIGNATURE`） | `Mac.unsignMessage()` 的消息被篡改过、没有签名，或者由未知的密钥签名 |
| `DecryptionFailedException`（`E_DECRYPTION_FAILED`） | `Crypt.decrypt()`、`decryptString()`、`decryptByKey()`、`decryptByPassword()`：密钥或口令错误，数据被篡改或截断 |
| `InvalidObjectOptionsException`（来自 `lakutata`） | 应用启动时提供者的选项不合法：没有密钥、密钥短于 16 个字符、未知算法、`saltRounds` 不在 4 到 31 之间（不经过这项检查创建的提供者，例如在单独的 `Container` 中创建时，抛出的是 `InvalidValueException`） |
| `RangeError` | `generateSecret()` 的字节数为负数或过大；`hmac()`、`verifyHMAC()`、`encryptByKey()`、`decryptByKey()` 的密钥为空 |

除非应用另行映射，这些异常的 HTTP 状态码都是 500。`verify()`、`verifyHMAC()`（给出了密钥时）、`validate()` 和 `constantTimeEqual()` 遇到错误或格式不正确的签名、哈希或秘密时返回 `false`，而不是抛出异常。

## 另见

- `lakutata` 包中的 `doc/zh/Security.md`：安全工具指南。
- `@lakutata/core`（`lakutata`）：提供者、`Application` 和依赖注入。
