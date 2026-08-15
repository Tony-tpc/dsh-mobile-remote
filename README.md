# dsh-mobile-remote

手机远程控制 DeepSeek Harness：在 harness 的 3080 端口提供移动端页面，查看全部会话（含冷会话）的状态、目标、待办、最近动态，并从手机发送提示注入「已挂载」会话。

## 路由

| 路由 | 说明 |
|---|---|
| `GET /m` | 移动端页面 |
| `GET /m/state` | 会话列表；`?session=<id>` 取单会话详情 |
| `POST /m/prompt` | 注入提示，body：`{"sessionId":"...","text":"..."}` |

所有路由都要求 `?t=<token>` 认证。

## 配置

默认 token 为 `mob-9e7c5a3b1f`，可在挂载行用 `config.token` 覆盖：

```yaml
- insert:
    - id: mobile-remote
      name: dsh-mobile-remote
      config:
        token: 你的token
```

## 接入 host composition（安装步骤）

1. 在 profile（`C:\Users\<你>\.dsh\profiles\web`）的 `package.json` 里加依赖：

```json
"dependencies": {
  "dsh-mobile-remote": "file:D:/Yang/deepseek-harness/dsh-mobile-remote"
}
```

2. 在 profile 目录运行 `pnpm install`。
3. 在 `cordis.patch.yml` 里加挂载行（见上文「配置」）。
4. 重启 harness。

> 改动 `D:\Yang\deepseek-harness\dsh-mobile-remote` 源码后，需在 profile 目录重新运行 `pnpm install` 同步（node_modules 里是安装快照，非实时链接）。

## 数据来源

- 会话列表来自 `sessionQuery.listSessions()`（含冷会话）。
- 目标从 `goal/change` 事件折叠，待办从 `todo/write`，动态从 `user/message` / `assistant/message` / `tool/call`；冷会话通过 `sessionQuery.readSession()` 读取持久化日志。
- 发送提示仅对「已挂载（live）」会话有效（走 `agent.followup`）；冷会话需先在电脑 web 端打开才会挂载。

## 网络通路（Tailscale）

harness 默认只监听 `127.0.0.1:3080`，手机远程访问需打通通路（本插件不负责改监听地址）。推荐用已装的 Tailscale（需管理员 PowerShell）：

```powershell
tailscale serve --bg 3080
tailscale serve status
```

手机装 Tailscale 并登录同一账户（同一 tailnet），打开：

```
https://<serve status 给出的地址>/m?t=mob-9e7c5a3b1f
```

`tailscale serve` 默认仅限你的 tailnet 内访问，不会暴露到公网（不要用 `funnel`）。

## 安全

- token 会出现在 URL 中，可能留在浏览器历史里；如需更强可改成 Basic Auth 或 header 认证。
- 只对「已挂载」会话生效；冷会话不会被自动唤醒。
