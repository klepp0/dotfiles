---
name: sync-models
description: Discover which models the hai proxy actually serves, then sync the model config of any coding agent on this machine (pi, opencode, Claude Code, and any other agent pointed at the proxy) to match. Adds newly-available models, drops old point releases (keeping newest and one prior per family), and promotes defaults to the newest Opus/Sonnet. Use when the user says "sync models", "update models", "refresh models", "check for new models", or asks whether new models are available. Accepts target flags like --pi, --opencode, --claude, --all.
---

This skill has two phases: **(1) discover** what the hai proxy actually serves (the single source of truth), then **(2) sync** the model configuration of one or more coding agents on this machine to match. It is agent-agnostic — any agent whose config points at the hai proxy can be a target.

## Scope

- The hai proxy is the source of truth. Never invent models; only configure what the proxy actually accepts.
- Targets are coding-agent configs on this machine that route through the proxy. Known targets are listed in the registry below, but discovery must also catch any newly-added agent that references the proxy.
- Updates only model-related keys (provider model lists, default model selections). Never touches MCP config, permissions, auth tokens, or anything else.

## Non-goals

- Does NOT add providers or agents that aren't already configured for the proxy.
- Does NOT bypass the removal policy — it never touches `*-latest` aliases when trimming pinned entries.
- Does NOT touch embedding models (`text-embedding-*`, `gemini-embedding`) — they are not chat models and must never be added to an agent's model list.

## Target selection

The user may scope which agents to update. Resolve the target set in this order:

1. **Explicit flags in the request** — honor them exactly, update nothing else:
   - `--pi` → pi only
   - `--opencode` → opencode only
   - `--claude` → Claude Code only
   - `--all` → every proxy-wired agent discovered on the machine
   - Multiple flags combine (e.g. `--pi --opencode`).
2. **No flags given** — run discovery (phase 1) first so you can show what's new, then **ask the user which agents to update** before writing anything. Present the discovered agents as a checklist and wait for the answer. Do not assume `--all`.
3. If discovery finds an agent pointed at the proxy that is NOT in the registry below, surface it to the user and ask whether to include it.

## Phase 1 — Discover proxy models (always run first)

The hai proxy runs at `http://localhost:6655`. Model-list endpoints:

| API family | List endpoint | Auth |
|---|---|---|
| Anthropic | `GET /anthropic/v1/models` | `Authorization: Bearer $HAI_PROXY_API_KEY` |
| OpenAI | `GET /openai/v1/models` | `Authorization: Bearer $HAI_PROXY_API_KEY` |
| Gemini | `GET /gemini/v1beta/models` | header `x-goog-api-key: $HAI_PROXY_API_KEY` |

- Resolve `$HAI_PROXY_API_KEY` from the environment. If absent (common — agents load it via the user's shell, not ours), source `~/.config/custom-zshrc/secrets.sh` first. **Preserve `PATH`** around the source call (the secrets file has been observed to clobber it; use absolute paths like `/usr/bin/curl` if needed).
- **If the proxy is unreachable, stop. Modify nothing.** Report the error.

### Derive request IDs by probing

The `/models` endpoints return display IDs (e.g. `anthropic--claude-4.8-opus`, `models/gemini-3.5-flash`) that are NOT the request IDs used in calls (e.g. `claude-opus-4-8`, `gemini-3.5-flash`). Do not attempt a mechanical transform for Anthropic — it's fragile. Instead generate a small set of candidate request IDs per listed model and probe each with a minimal request; HTTP 200 = valid, `400 INVALID_MODEL` = not.

Probe endpoints:

| API family | Probe endpoint | Minimal body |
|---|---|---|
| Anthropic | `POST /anthropic/v1/messages` | `{"model":"<id>","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}` |
| OpenAI (responses) | `POST /openai/v1/responses` | `{"model":"<id>","max_output_tokens":16,"input":"hi"}` |
| OpenAI (completions) | `POST /openai/v1/chat/completions` | `{"model":"<id>","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}` |
| Gemini | `POST /gemini/v1beta/models/<id>:generateContent` | `{"contents":[{"parts":[{"text":"hi"}]}]}` |

Candidate patterns for an Anthropic listed ID like `anthropic--claude-4.8-opus`: `claude-opus-4-8` (family-first, dashed), `claude-4-8-opus` (version-first), and the prefix-stripped `.`→`-` form. Cache the winning pattern per family. Also probe the `-latest` aliases (`claude-opus-latest`, `claude-sonnet-latest`, `claude-haiku-latest`) — they aren't listed but the proxy accepts them. For OpenAI/Gemini the listed IDs are usually already the request IDs; probe to confirm.

### Compute the desired set per family

Per family (Opus/Sonnet/Haiku, gpt-4.1/gpt-5, gemini families), sort valid pinned request IDs by version descending and keep:
- the newest pinned version,
- the next-newest pinned version (one prior),
- the `<family>-latest` alias if the proxy accepts it.

Drop everything else in the family. Never drop entries that are not point releases (custom/experimental IDs the user added) — flag them and ask before removing. Exclude all embedding models.

## Phase 2 — Sync the selected agents

### Agent registry

| Agent | Flag | Config path (edit here) | Notes |
|---|---|---|---|
| pi | `--pi` | `/Users/I753239/dev/dotfiles/.pi/agent/models.json` | `~/.pi` symlinks to the repo. Version-controlled. |
| opencode | `--opencode` | `/Users/I753239/dev/dotfiles/.config/opencode/opencode.json` | `~/.config/opencode/opencode.json` symlinks to the repo. Version-controlled. |
| Claude Code | `--claude` | `~/.claude/settings.json` | **Not** in the dotfiles repo — edit in place and warn it is not version-controlled. |

To catch agents not in this table, grep for `6655` / `HAI_PROXY` across `~/.config`, `~`, and the dotfiles repo. Report any new hit and ask the user before editing it.

### Per-agent sync rules

**pi** (`models.json`) — has four proxy providers; reconcile each provider's `models[]` against the proxy models valid on that provider's `api`:
- `anthropic` (api `anthropic-messages`) ← Anthropic listing: Opus/Sonnet/Haiku, newest + one prior + `-latest` per family.
- `hai-openai` (api `openai-completions`) ← the `gpt-4.1` family.
- `hai-openai-responses` (api `openai-responses`) ← the `gpt-5` family.
- `hai-gemini` (api `google-generative-ai`) ← the gemini chat models.
- Preserve each existing entry's extra fields (`name`, `reasoning`, `input`, `contextWindow`, `maxTokens`, `compat`, `thinkingLevelMap`). Only add/remove `id`s; when adding, mirror the field shape of a sibling in the same family. Keep the compact single-line entry formatting.

**opencode** (`opencode.json`) — only configures the `anthropic` provider:
- Reconcile `provider.anthropic.models` (Opus/Sonnet/Haiku, newest + prior + `-latest`).
- Set `model` → `anthropic/<newest-Opus-pinned>`, `small_model` → `anthropic/<newest-Sonnet-pinned>`.
- Preserve key order: `$schema`, `share`, `permission`, `model`, `small_model`, `provider`, `mcp`. 2-space indent, no trailing commas.

**Claude Code** (`settings.json`) — selects models via `env` using `-latest` aliases:
- Verify `env.ANTHROPIC_DEFAULT_OPUS_MODEL`, `..._SONNET_MODEL`, `..._HAIKU_MODEL`, and `env.ANTHROPIC_MODEL` still resolve (probe 200). Because they use aliases, no per-version edit is normally needed.
- Only change values if an alias broke, or the user explicitly wants pinned versions. If pinning, use the newest pinned request ID per family.
- Do not touch `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, or any non-model key.

## Show diff and apply

- Show a compact **per-agent** diff (model lists + default selections only) for the selected targets.
- Apply only after the user confirms.
- If a selected agent is already up to date, report "up to date" for it and make no edit.
- If no target is up to date and nothing changes anywhere, report "all selected configs up to date" and exit without editing.

## Verification

After applying, re-probe the newest model referenced by each updated default (pi has no single default; opencode `model`/`small_model`; Claude Code env models). If any fails, revert that file's edit and ask how to proceed.

## Restart reminders

- pi and opencode read their config at startup — remind the user to restart them.
- Claude Code reads `settings.json` at startup — remind the user to restart it if it was updated.

## Rules

- Proxy unreachable → modify nothing, report, stop.
- Edit version-controlled files only through the dotfiles repo paths (never through the `~` symlink, never both in one session). `~/.claude/settings.json` is not in the repo — edit in place and warn.
- Never trim `*-latest` aliases; never add embedding models.
- Preserve each file's formatting and top-level key order.
- Flag prominently any family a config claims but the proxy now rejects (a default may be broken).
- When no flags are given, always discover first, then ask which agents to update before writing.
