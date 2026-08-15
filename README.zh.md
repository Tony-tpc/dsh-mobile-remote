# dsh-mobile-remote

> 🌐 [English](README.md) · 仓库：<https://github.com/Tony-tpc/dsh-mobile-remote>

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 手机远程控制插件：在手机上查看会话、目标、待办、最近动态，并向 agent 发送提示。

## 特性

- 📱 在 Harness 现有 web 端口上提供移动端控制台 `/m`。
- 🗂 列出**全部**会话（含冷会话），带标题与状态。
- 🎯 显示当前目标（objective / 阶段 / 轮次）与待办列表。
- 🕘 最近动态以 Markdown 渲染（标题、代码块、列表、链接…）。
- 💬 通过 `agent.followup` 向已挂载会话发送提示。
- ⚡ 点击冷会话即可挂载（恢复）并接管控制。
- 🔐 所有路由都要求 token 认证。

## 安装

### 通过 `dsh plugin`

```bash
dsh plugin --profile web add github:Tony-tpc/dsh-mobile-remote
```

包内自带 `dsh.bundle.patch`（`cordis.patch.yml`），作为 bundle 添加时自动注册宿主行。

### 手动

1. 在 profile 的 `package.json` 加依赖：

```json
"dependencies": {
  "dsh-mobile-remote": "file:<本仓库路径>"
}
```

2. 链接并挂载（profile 目录：Linux/macOS 为 `~/.dsh/profiles/web`，Windows 为 `%USERPROFILE%\.dsh\profiles\web`）：

```bash
pnpm install
```

```yaml
# cordis.patch.yml
- insert:
    - id: mobile-remote
      name: dsh-mobile-remote
      config:
        token: 你的token
```

3. 重启 Harness。

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `token` | `mob-9e7c5a3b1f` | 每个路由都要求的 `?t=` 密钥。**请修改。** |

## 使用

本机：

```
http://127.0.0.1:3080/m?t=<token>
```

手机（推荐 Tailscale）：

```bash
tailscale serve --bg 3080
tailscale serve status   # 打印 https 地址
```

```
https://<机器名>.<tailnet>.ts.net/m?t=<token>
```

## 实现原理

- 会话列表：`sessionQuery.listSessions()`（含冷会话）+ `readTitleSnapshots()`。
- 目标折叠自 `goal/change`；待办来自 `todo/write`；动态来自 `user/message`、`assistant/message`、`tool/call` 事件。冷会话通过 `sessionQuery.readSession()` 读取。
- 提示：`agent.followup()`（与 web 端同一路径）。
- 挂载：`agents.resume()` 并重新挂载该会话的 agent 预设。

## 安全

- 暴露端口前请修改默认 token。
- `tailscale serve` 仅限 tailnet 内；**不要**用 `tailscale funnel`（公网）除非有额外认证。
- 冷会话不会被自动恢复，需手动点击。

## 依赖

- Node.js（ESM）
- DeepSeek Harness（提供 `webServer`、`agents`、`sessionQuery`、`agentPresets`）

## 许可证

MIT
