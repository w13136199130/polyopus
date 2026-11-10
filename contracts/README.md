# PolyOpus Contracts

可执行的接口契约：**61 类事件** + **188 个已实现操作（docs/29 共 242，54 个 backlog）**。

```
contracts/
├─ spec/
│  ├─ events.py          # 作者源：61 个事件与共享对象
│  └─ api.py             # 作者源：API 模型与 188 个操作
├─ generate.py           # 生成器（纯 stdlib）
├─ check.py              # 校验器（纯 stdlib）
├─ runtime_check.py      # Pydantic 运行时校验（需 pydantic）
├─ examples/             # 手写样例，CI 用它验证契约
└─ README.md

schemas/                 # 生成物（对外发布的 JSON Schema）
├─ events/
│  ├─ common.schema.json
│  ├─ envelope.schema.json
│  ├─ index.json         # 61 条目录
│  ├─ conv/*.schema.json
│  ├─ intake/*.schema.json
│  ├─ ticket/*.schema.json
│  ├─ user/*.schema.json
│  └─ sys/*.schema.json
└─ api/
   └─ openapi.json       # OpenAPI 3.1（148 paths / 188 ops / 229 schemas）

generated/
├─ py/poly_contracts/    # Pydantic v2 模型
│  ├─ events.py          # EventBase + 61 payload + 61 event + PolyEvent
│  └─ api_models.py
└─ ts/src/               # TypeScript 类型
   ├─ events.gen.ts      # 信封、共享对象、61 事件、联合类型
   └─ api.gen.ts
```

## 为什么这样分层

- **`contracts/spec/*.py` 是作者源**：字段、必填、枚举只写一次，避免"文档 / JSON / TS / Pydantic"四处漂移。
- **`schemas/**` 是发布契约**：外部消费者（其他语言、网关、测试）只看 JSON Schema，不需要 Python。
- **`generated/**` 是构建产物**：应用与前端直接 import，不手写类型。

> 与 `docs/11-事件Schema.md` 的关系：文档解释"为什么"，这里定义"是什么"。字段变更先改 spec，再重生成，再更新文档表格。

## 命令

```bash
python -m contracts.generate          # 写生成物
python -m contracts.check             # 生成物是否同步 + schema/示例/OpenAPI 校验
python -m contracts.coverage_check    # 需求→契约→表/事件覆盖门禁（报告）
python -m contracts.coverage_check --strict  # 有硬缺口即失败
python -m contracts.coverage_check --write-allowlist  # 记录当前 docs/29 backlog
pip install pydantic                  # 可选
python -m contracts.runtime_check     # 用真实 Pydantic 解析示例
```

**覆盖门禁**：`contracts/coverage_allowlist.json` 记录“docs/29 已列、契约尚未实现”的端点与需求。
新增缺口会报 `HARD`；只有 allowlist 里的旧缺口进 `ALLOWED`。实现后请从 allowlist 删除，避免永久豁免。

Windows（PowerShell）运行 runtime check 需要把生成目录加入路径：

```powershell
$env:PYTHONPATH="$PWD\generated\py"
python -m contracts.runtime_check
```

## 前端用法

```ts
import type { PolyEvent, MessageDeltaEvent } from "./generated/ts/src/events.gen";

function apply(ev: PolyEvent) {
  switch (ev.type) {
    case "message.delta":
      // ev 被收窄为 MessageDeltaEvent
      append(ev.payload.message_id, ev.payload.text);
      break;
    case "attention.requested":
      inbox.push(ev.payload.attention_id);
      break;
  }
}
```

未知类型不要 `throw`：服务端可能先上线新事件，前端应忽略并上报（`console.debug` + 计数）。

## 后端用法

```python
from poly_contracts import parse_event, EVENT_MODELS

event = parse_event(raw_json)          # 按 type 判别，校验 payload
if event.type == "assignment.reported":
    ...                                # event 已收窄
```

`parse_event` 对未知 `type`、缺失必填、多余字段都会抛 `ValidationError`（`additionalProperties: false`）。

## OpenAPI 用法

```bash
npx openapi-typescript schemas/api/openapi.json -o web/src/api/schema.d.ts
```

- `servers: /api/v1`；错误统一 `ErrorEnvelope`。
- 所有写操作返回更新后的资源，便于前端直接用响应替换本地状态。
- `POST /tickets/{id}/stop` 需要 `task:stop` 权限，返回 `409` 表示状态冲突（已结束）。

## 新增/修改一个事件

1. 在 `contracts/spec/events.py` 里加 `ev(...)`（或改字段）。
2. 如果加了共享对象，在 `COMMON` 里定义。
3. `python -m contracts.generate`。
4. 在 `contracts/examples/` 加一条样例。
5. `python -m contracts.check`（会校验 56 → 57 的计数断言，记得同步改 `validate_spec` 的期望值）。
6. 更新 `docs/11-事件Schema.md` 的目录与字段表。
7. 破坏性变更：新增 `v=2` 或新 type，双发一个版本周期；不得删已发布必填字段。

## CI 门禁

```yaml
- run: python -m contracts.generate --check   # 生成物与 spec 一致
- run: python -m contracts.check              # schema / 示例 / OpenAPI
- run: pip install pydantic && python -m contracts.runtime_check
```

`generate --check` 会在生成物过期时列出文件并返回 1；`check` 会验证示例、OpenAPI 引用、TS 联合类型数量。

## 已知边界

- JSON Schema 用 `x-id-prefix` 表达 ID 前缀（如 `tk_`），**不强制** ULID 正则；运行时由服务端保证。
- 时间统一 RFC3339（`format: date-time`）；DB 存 epoch ms，由序列化层转换。
- 可选字段用"缺省"而非 `null`；OpenAPI 不生成 `nullable`，避免客户端二义性。
- `Error` 作为共享对象与事件同名冲突，事件类统一加 `Event` 后缀（`ErrorEvent`、`UsageEvent`）。
- 目前只生成类型，不生成客户端 SDK；后续可用 OpenAPI Generator 产出。
