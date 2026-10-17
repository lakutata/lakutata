# Lakutata 安全

`lakutata/security`（`@lakutata/security` 包）提供基于 bcrypt 的密码哈希（`PasswordHash`）、基于 HMAC 的消息签名（`Mac`）和基于 AES-256-GCM 的认证加密（`Crypt`），以及它们所基于的函数；其中 `Mac` 和 `Crypt` 支持密钥轮换。它基于 `node:crypto` 实现（bcrypt 用 JavaScript 实现），没有可选依赖。`lakutata/provider/passwordHash` 只导出 `PasswordHash`。更多细节见 `@lakutata/security` 的 README。

## 1. 提供者

`PasswordHash`、`Mac` 和 `Crypt` 都是提供者：在应用的 `providers` 中声明它们，密钥从环境变量读取，然后通过 `getObject()` 或 `@Inject` 获取。

```typescript
import {Application} from 'lakutata'
import {Crypt, generateSecret, Mac, PasswordHash} from 'lakutata/security'

Application
    .run(() => ({
        id: 'security.app',
        name: 'Security',
        providers: {
            //saltRounds：4 到 31，默认 10
            passwordHash: {class: PasswordHash, saltRounds: 12},
            //第一个密钥用于签名和加密，所有密钥都可用于验证和解密
            mac: {class: Mac, keys: [process.env.MAC_KEY ?? generateSecret()], algorithm: 'sha256'},
            crypt: {class: Crypt, keys: [process.env.CRYPT_KEY ?? generateSecret(), process.env.CRYPT_PREVIOUS_KEY ?? generateSecret()]}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const passwordHash: PasswordHash = await app.getObject<PasswordHash>('passwordHash')
        //每次哈希都使用新的盐
        const hash: string = await passwordHash.hash('correct horse battery staple')
        console.log(await passwordHash.validate('correct horse battery staple', hash))

        const mac: Mac = await app.getObject<Mac>('mac')
        //'user:42.<签名>'
        const token: string = mac.signMessage('user:42')
        //消息被篡改时抛出 InvalidSignatureException
        console.log(mac.unsignMessage(token))
        //单独的签名，不附在消息上
        const signature: string = mac.sign('payload')
        console.log(mac.verify('payload', signature))

        const crypt: Crypt = await app.getObject<Crypt>('crypt')
        //AES-256-GCM，base64url；数据被篡改时抛出 DecryptionFailedException
        const encrypted: string = crypt.encrypt('api-token-123')
        console.log(crypt.decryptString(encrypted), crypt.decrypt(encrypted).length)
    })
```

- **密码**：`PasswordHash.hash()` 拒绝 UTF-8 编码超过 72 字节的密码（bcrypt 会忽略超出的字节），抛出 `PasswordTooLongException`；对这类密码，`validate()` 返回 `false`。哈希值请原样保存，并用 `validate()` 校验，不要用 `===` 比较。
- **密钥**：`Mac` 和 `Crypt` 的密钥是至少 16 个字符的字符串。请用 `generateSecret()` 生成（32 个随机字节，base64url）：把密码当作密钥使用容易被暴力破解。
- **密钥轮换**：把新密钥放在最前面；只要还要读取用旧密钥签名或加密的数据，就保留旧密钥。
- **格式**：签名和加密数据都是不带填充的 base64url 字符串，可以安全地用于 URL 和 Cookie。

## 2. 按用途选择工具

| 需求 | 使用 |
|---|---|
| 保存用户密码，登录时校验 | `PasswordHash`（bcrypt：慢且加盐） |
| 检测篡改（Cookie、链接、webhook） | `Mac`、`hmac()` / `verifyHMAC()` |
| 隐藏数据并能读回 | `Crypt`、`encryptByKey()` / `decryptByKey()` |
| 用人输入的口令加密 | `encryptByPassword()` / `decryptByPassword()`（scrypt） |
| 生成密钥或令牌 | `generateSecret()` |
| 比较收到的秘密与预期值 | `constantTimeEqual()` |

## 3. 函数

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

//签名（'sha256'、'sha384'、'sha512'）
const body: string = JSON.stringify({order: 42})
const signature: string = hmac(body, key, 'sha512')
console.log(verifyHMAC(body, signature, key, 'sha512'))

//用一个密钥加密，用给出的任一密钥解密：当前的或之前的
const encrypted: string = encryptByKey('card ending 4242', key)
console.log(decryptByKey(encrypted, [key, generateSecret()]).toString('utf8'))

//用口令加密（scrypt，异步）
const backup: string = await encryptByPassword('backup contents', 'a long passphrase')
console.log((await decryptByPassword(backup, 'a long passphrase')).toString('utf8'))

//以恒定时间比较收到的令牌
console.log(constantTimeEqual('presented-token', process.env.API_TOKEN ?? ''))
```

## 4. 错误

| 异常 | 什么时候 |
|---|---|
| `PasswordTooLongException` | `PasswordHash.hash()` 的密码 UTF-8 编码超过 72 字节 |
| `InvalidSignatureException` | `Mac.unsignMessage()` 的消息被篡改过、没有签名，或者由未知的密钥签名 |
| `DecryptionFailedException` | `Crypt.decrypt()`、`decryptString()`、`decryptByKey()`、`decryptByPassword()`：密钥或口令错误，数据被篡改或截断 |
| `InvalidObjectOptionsException`（来自 `lakutata`） | 应用启动时提供者的选项不合法：没有密钥、密钥短于 16 个字符、未知算法、`saltRounds` 不在 4 到 31 之间 |

`verify()`、`verifyHMAC()`、`validate()` 和 `constantTimeEqual()` 遇到错误或格式不正确的签名、哈希或秘密时返回 `false`，而不是抛出异常。
