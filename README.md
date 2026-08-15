# dsh-mobile-remote

> 🌐 [中文](README.zh.md) · Repository: <https://github.com/Tony-tpc/dsh-mobile-remote>

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that adds a mobile remote console — view sessions, goals, todos and recent activity, and send prompts to the agent from your phone.

## Features

- 📱 Mobile-first web console served at `/m` on the existing Harness web port.
- 🗂 Lists **all** sessions (live and cold) with titles and status.
- 🎯 Shows the current goal (objective, phase, rounds) and the todo list.
- 🕘 Renders recent activity as Markdown (headings, code blocks, lists, links…).
- 💬 Sends prompts to a live session via `agent.followup`.
- ⚡ Tap a cold session to mount (resume) it and take control.
- 🔐 Token authentication on every route.

## Install

### Via `dsh plugin`

```bash
dsh plugin --profile web add github:Tony-tpc/dsh-mobile-remote
```

The package ships a `dsh.bundle.patch` (`cordis.patch.yml`), so adding it as a bundle self-registers the host row.

### Manual

1. Add the dependency to the profile's `package.json`:

```json
"dependencies": {
  "dsh-mobile-remote": "file:<path-to-this-repo>"
}
```

2. Link it and mount the row (profile dir: `~/.dsh/profiles/web` on Linux/macOS, `%USERPROFILE%\.dsh\profiles\web` on Windows):

```bash
pnpm install
```

```yaml
# cordis.patch.yml
- insert:
    - id: mobile-remote
      name: dsh-mobile-remote
      config:
        token: your-token
```

3. Restart Harness.

## Configuration

| Field | Default | Description |
| --- | --- | --- |
| `token` | `mob-9e7c5a3b1f` | Shared secret required as `?t=` on every route. **Change it.** |

## Usage

Same machine:

```
http://127.0.0.1:3080/m?t=<token>
```

Phone (Tailscale, recommended):

```bash
tailscale serve --bg 3080
tailscale serve status   # prints the https URL
```

```
https://<machine>.<tailnet>.ts.net/m?t=<token>
```

## How it works

- Session list: `sessionQuery.listSessions()` (includes cold sessions) + `readTitleSnapshots()`.
- Goals fold from `goal/change`; todos from `todo/write`; activity from `user/message`, `assistant/message`, `tool/call` events. Cold sessions read via `sessionQuery.readSession()`.
- Prompts: `agent.followup()` — the same path as the web client.
- Mount: `agents.resume()` with the session's agent preset re-mounted.

## Security

- Change the default token before exposing the port.
- `tailscale serve` is tailnet-only. Do **not** use `tailscale funnel` (public internet) without additional auth.
- Cold sessions are never resumed automatically — you must tap them first.

## Requirements

- Node.js (ESM)
- DeepSeek Harness (provides `webServer`, `agents`, `sessionQuery`, `agentPresets`)

## License

MIT
