# 大消息传输方案设计（@lakutata/nats）

> 状态:**架构已定,工程细节待敲定**(见末尾 checklist)。
> 本文档是多轮设计讨论的沉淀,目标是让后续实现不必重推已排除的弯路。

## 1. 背景与硬约束

这个包用于 K8s 集群中、跨语言服务之间的 RPC 通讯(core NATS request-reply + pub/sub)。
现实中存在大 payload(查大表、读文件等,8M+)。设计必须同时满足:

| 约束 | 说明 |
|---|---|
| **业务 API 不变** | 业务两端保持 `invoke(pattern)→完整对象`、`@ServiceAction return 完整对象`、`publish/subscribe`。中间件断面只在传输+调用层。 |
| **跨语言** | 有非 JS 服务,必须保证标准 JSON 子集语义(原生 codec 的 `JSON.parse(JSON.stringify())` 清洗必须保留,不能用 msgpack 富类型)。 |
| **不能 break 已上线服务** | 滚动升级新旧共存,必须向后兼容(能力协商 + 退化)。 |
| **不重复响应** | 多副本下一个请求只能一个副本处理(已由 queue group 保证)。 |

## 2. 两个阻塞机制(问题根源)

| 机制 | 现象 | 本质 | 能否消除 |
|---|---|---|---|
| **机制1:TCP 队头阻塞** | 单条 16M 帧在连接上传输的 ~100ms 里,堵住该连接上后续所有消息 | 单 TCP 连接、协议帧不可交错 | 可隔离(独立连接) |
| **机制2:事件循环卡顿** | `codec.decode`/`encode` 是同步 CPU,16M 各 ~100ms 卡住**整个进程**的事件循环 | 完整对象 materialize 是物理成本 + **V8 对象只能在主线程构建** | **不能消除,只能隔离/分散** |

实测(11KB→132µs encode;8.5M→50ms;16M→~100ms),decode/encode 随大小线性增长。

## 3. 总体架构

> **一句话:小消息走现状 core RPC(零影响);大消息自动经 Object Store 中转(独立 bulk 连接 + 可选 bulk 副本双隔离);用 NATS header 协商保证灰度不破坏;业务两端 API 完全不变。**

```
┌─────────────────────────────────────────────────────────┐
│ 常规副本(处理高频小请求)                                    │
│   连接① nats(core)   : invoke/event/publish 的小消息        │
│   连接② natsBulk     : 大数据 Object Store put/get(默认建)  │
├─────────────────────────────────────────────────────────┤
│ bulk 副本(可选,第二层,独立 deployment)                    │
│   订阅 serviceId.bulk,用原生 codec,烧自己的事件循环         │
│   → 机制2 的处理隔离(没有它就退化到常规副本处理)            │
├─────────────────────────────────────────────────────────┤
│ NATS + JetStream Object Store(local-path 块存储)           │
│   bucket:大对象中转,持久存储(get 不删),短 MaxAge 自动清    │
└─────────────────────────────────────────────────────────┘
```

**双隔离:**
- 独立连接(`natsBulk`)→ 解机制1(传输互不挤);
- 独立进程(bulk 副本)→ 解机制2(CPU 互不卡)。
- 两者是两件事,连接独立 ≠ 处理独立。

## 4. bulk 连接策略(本次更新重点)

**`bulk` 默认 `true`:NATS 客户端启动时默认建立 bulk 连接 + 准备 Object Store 旁路。**

```ts
nats: buildNatsClientOptions({
    servers: '...',
    bulk: true    // 默认 true:启动即建 bulk 连接 + 准备 Object Store 旁路
})
```

设计要点:
- **预建立**(启动就连,无 cold start),符合 lakutata Component 的 init/destroy 生命周期;
- **连接配置自动复用 core**(servers/认证/codec 继承),**不用重复配**;但仍是**第二条独立 TCP**(隔离需要),不是共用一条;
- **连接与 Object Store 绑定**:默认开 = 连接 + Object Store 旁路一起就绪,**避免建一条空连接**;
- **可关**:`bulk: false` 给明确从不收发大数据的服务关掉省资源;
- **代价**:每副本 2 条连接,NATS server 端连接数翻倍,超大规模需评估;
- **bulk 副本是第二层可选**:没有它,大请求退化到常规副本处理(卡常规副本但功能正常);有它才完整隔离机制2。

`bulkNatsComponentName` 降级为**可选高级覆盖**:仅当想把 bulk 流量隔离到**另一个 NATS 集群**(不同 servers)时才用;默认同集群、自动复用配置,无需此项。

## 5. 阈值:自动从 server 拿,零配置

判断标准 = **encode 后的字节长度**(不是对象逻辑大小)。

```ts
private get bulkThreshold(): number {
    const maxPayload = this.#conn.info?.max_payload ?? 1024 * 1024  // fallback 1M
    return Math.floor(maxPayload * 0.9)   // 留 framing 余量
}
```

- `max_payload` 由 NATS 握手的 `INFO` 消息提供,`nc.info.max_payload` 现成可读(已验证 `ServerInfo.max_payload` 存在);
- 阈值 = `max_payload × 0.9`,**跟随集群配置自动变化**,保证"core 发不出去的必走 bulk";
- 每次读、不缓存(应对 server 运行时重配,成本几乎为零);
- 可由用户配置向下覆盖(极低延迟场景想更激进隔离时)。

**诚实局限:判断需先 encode,而 encode 大对象本身就卡(机制2)。** 小消息 encode 微秒级无负担;大消息发送侧 encode 那一下卡躲不过(见 §11)。不能靠"预估大小"绕过(遍历估大小也是 O(size) 卡顿)。

## 6. 数据流

### (A) 小请求 RPC —— 完全是现状,零额外开销
```
invoke(pattern) → encode < 阈值 → nats.request(serviceId, bytes) → 常规副本 → 响应
```

### (B) 大请求/大响应 RPC —— Object Store 传引用
```
客户端: encode ≥ 阈值 → natsBulk.put(TTL)→objId → nats.request(serviceId.bulk, {__ref:objId}, header)
bulk 副本: 收 {__ref} → natsBulk.get → decode → handler(完整对象)
          → return 大对象 → put → 回 {__ref:objId2}
客户端: 收 {__ref:objId2} → natsBulk.get → decode → resolve
```
- core 连接上只跑**小引用消息**;大数据字节走 natsBulk + Object Store,离开 core;
- decode/encode 卡顿烧在 bulk 副本进程,常规副本无感;
- 业务两端只看到 `invoke(pattern)`/`return 对象`,看不到任何 ref。

### (C) 大 publish/event —— Object Store 发引用(一对多更优)
```
emitServiceEvent(evt, big) → encode ≥ 阈值 → put → publish(subject, {__ref})
每个订阅方: 收 {__ref} → 按需 get → decode → listener(完整对象)
```
- 广播的是小引用,所有订阅方 core 连接都不被砸;
- **一份存储多方按需取,没有 N× 流量放大**(优于 natsBulk 直传广播);
- 不关心的订阅方可以不下载。

## 7. 协议:全部走 NATS header,payload 不动

| header 键 | 方向 | 含义 |
|---|---|---|
| `X-Lkt-Chunk: 1` | 请求 | 客户端能力声明:能处理引用中转 |

- payload 永远是业务数据或 `{__ref}`,协议元信息只在 header → 不污染、跨语言干净;
- `server` 是否支持 header:从 `nc.info.headers` 自动判断,不支持则自动退化。

## 8. 向后兼容 + 灰度

能力声明 header(`X-Lkt-Bulk`)可选,缺失即"对端不支持"→ 不给它发引用:

| 客户端 | 服务端 | 行为 |
|---|---|---|
| 旧 | 新 | 旧客户端不带 `X-Lkt-Bulk` → 新服务端响应直传退化 |
| 新 | 旧 | 旧服务端响应不带 `X-Lkt-Bulk` → 新客户端学到"不支持"→ 后续不发引用、直传 |
| 新 | 新 | 双向都声明 → 大数据走 Object Store 引用 |
| 旧 | 旧 | 完全不变 |

**已验证**:用裸 NATS 模拟真旧版(无 header、无中转),两个方向(旧→新、新→旧)wire 兼容均通过(`compat.test.ts`)。关键保证:**新版只在对端声明能力时才发引用,旧版不声明 → 自动退化直传**,新旧混部署 / 滚动升级不破坏。

**上线顺序(无 flag day):**
1. 发新版(带能力,默认旁路可退化),`max_payload` 暂保持现值;
2. 滚动升级所有服务;
3. 部署 bulk 副本、开启旁路;
4. 全升级确认后,把 `max_payload` 调回安全值(如 1M)。

## 9. 清理 / 容量(Object Store)

- JetStream/Object Store **默认不会"消费即删"**(那是 WorkQueue retention);Object Store 是**持久存储,get 不删**;
- 必须配**短 `MaxAge`**(如 5min)兜底自动清;RPC 点对点可加"下载后显式 `delete`"双保险;publish 一对多只能靠 `MaxAge`;
- `max_file_store` 按 `峰值并发大对象数 × 大小 × TTL` 估算,别撑爆 local-path 磁盘。

## 10. 分阶段落地

| 阶段 | 内容 | 状态 |
|---|---|---|
| **S1** | NATS 组件 bulk 基础能力:bulk 连接默认开(复用 core 配置)、Object Store `putBulk`/`getBulk`/`deleteBulk`/`bulkStatus`、阈值(`max_payload×0.9` 从 info)、`headersSupported` 探针、TTL/replicas/bucket 配置 | ✅ 已落地(`bulk.test.ts` 7 例) |
| **S2** | `request`/`subscribe` 透明中转:自适应阈值路由、双向能力协商(`X-Lkt-Bulk`/`X-Lkt-Ref`/`{__ref}`)、客户端缓存对端能力(`#peerCapabilityCache`)、退化兼容、引用用完即删 + TTL 兜底、`NatsBulkException` 错误语义化 | ✅ 已落地(`bulk-rpc.test.ts` 5 例 + `compat.test.ts` 真旧版兼容 2 例) |
| S3 | publish/event 的引用中转(一对多用 Object Store 发引用,不放大流量) | 待做 |
| S4 | bulk 副本(机制2 处理隔离)+ 部署/路由(没有 bulk 副本时退化常规副本) | 待做 |
| S5 | 背压(#1,bulk 副本尤其必要)+ 全集群升级后调回 `max_payload` | 待做 |

**S1+S2 = MVP 核心链路**:RPC 大请求/大响应透明走 Object Store、双向协商、退化兼容、API 完全不变,全部有测试。每阶段向后兼容、可单独测、不破坏现状。

## 11. 已知边界 / 删不掉的代价(诚实记录)

- **调用方侧机制2躲不过**:调用方 `invoke` 大数据时,它自己 encode 请求 + decode 响应卡**它自己**的事件循环。自适应路由 + bulk 副本只隔离了**被调用方**侧;调用方侧的卡顿是物理成本,且调用方预知不了响应大小,无法提前隔离。**接受它。**
- 大数据请求**本身慢**(Object Store 多一跳 + encode/decode 物理成本)——但被关在 bulk 连接 + bulk 副本里,只烧自己,不连累高频小 RPC。
- bulk 副本需**单独部署**(运维多一份);Object Store 占磁盘 + 需 TTL 管理;依赖 JetStream(已开、底座已修为 local-path)。

## 12. 待敲定的工程细节(实现前 checklist)

- [x] **objId 生命周期**:`randomUUID` 命名;取回后即删(请求 obj 在响应返回后删、响应 obj 客户端 get 后删),均 + 5min TTL 兜底 ✅
- [x] **配置 API**:`bulk`(默认 true)/`bulkBucket`/`bulkTTL`/`bulkReplicas`;`bulkNatsComponentName` 降级为可选高级覆盖 ✅
- [x] **测试策略**:容器加 `-js` 启 JetStream;`bulk.test.ts`(基础 7 例)+ `bulk-rpc.test.ts`(中转/协商/退化 4 例)✅
- [x] **超时/重试**:已在 §14 落地(超时 10min、NoResponders 安全重试)✅
- [x] **错误传播**:`NatsBulkException` 语义化(put/get 失败、引用取不到、未启用);服务端 bulk 失败 → errorResponse → 客户端收带 `E_NATS_BULK` 的 `ServiceInvokeException`;客户端 bulk 失败 → `NatsBulkException`(**不被 #7 重试**);`ServiceResponseCodec.decode` 只读属性 bug 已修。测试:`bulk.test.ts` / `bulk-rpc.test.ts`(端到端不同 bucket)/ 单元。Object Store 完全不可用靠 code review ✅
- [ ] **bulk 副本部署/路由**:常规 vs bulk 副本角色区分;没有 bulk 副本时大请求落哪 —— 留待 **S4**
- [ ] **背压(#1)**:bulk 副本尤其必要 —— 留待 **S5**

## 13. 明确排除的弯路(不要重走)

| 方案 | 为什么不行 |
|---|---|
| 调大 max_payload 单条传 | 机制1 + 机制2 双重打击 |
| 自建 chunking + 流控 | 造轮子;Object Store 已内建分块/流控 |
| worker thread 放 codec | 对象跨边界结构化克隆 ≈ 序列化,还在主线程付账,多构建一次 |
| 异步 JSON 库 / stream-json | "异步"≠不占 CPU;JS 流式实现慢 5–10×;对象只能主线程构建 |
| 给 core RPC 开连接池 | 单线程瓶颈不变,多 socket ≠ 多处理能力 |

**根本原因**:只要"业务要完整对象 + API 不变",完整对象的 materialize(CPU + 内存)就删不掉、躲不出主线程。序列化层没有银弹,**解法只在架构隔离层**。

## 14. 相关的独立改进项(与本方案正交,可先做)

- **✅ #3 优雅停机(drain)**:`destroy()` 已改为 `drain()` + `close()` 兜底,滚动升级不切断 in-flight(测试 `test/integration/drain.test.ts`)
- **✅ #2 超时默认值**:`invoke` 默认已从 1 小时改为 **10 分钟**(可显式覆盖;慢操作显式传更长值)
- **✅ #7 NoResponders 快速失败(已有)**:`request` 收到 503 立即抛 `NatsNoRespondersAvailableException`,不等超时——故障立即暴露,使 #2 的 10 分钟默认只兜底"处理慢"(测试 `errors.test.ts`)
- **✅ #7 NoResponders 安全重试**:`invoke` 只对 NoResponders(对侧确定没处理)自动重试(默认 3 次、间隔 100ms,均可配);**超时/业务异常一律不重试**,避免"对侧已处理但响应丢失"时重复执行非幂等操作(测试 `retry.test.ts`)
- **#1 背压(待做)**:服务端并发上限(bulk 副本尤其需要)

drain + 10 分钟超时 + NoResponders 立即失败 + NoResponders 安全重试 已齐,**滚动升级韧性完整**;仅剩 #1 背压作为增强。
