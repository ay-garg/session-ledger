import { clip, pretty, textOf } from "../../core/ledger.js"
import { inScope, resolveConfig } from "../../core/config.js"
import { record } from "../../core/store.js"

// OpenCode adapter. Everything harness-specific lives in this file: how to see a
// prompt or a tool call start and finish. Formatting and file writing are shared
// with the hook-based adapters (Claude Code, Codex, Cursor) in core/.

const pending = new Map()
const sessions = new Map()

const isShell = (tool) => /^(shell|bash|exec_command|exec|terminal)$/i.test(String(tool ?? ""))
const eventKey = (event) => `${event?.sessionID ?? "unknown"}:${event?.id ?? event?.messageID ?? ""}`
const shortID = (value) => String(value ?? Date.now()).replace(/^tool[-_]/i, "").slice(-8)

function describe(ctx, sessionID, fallbackDirectory) {
  let known = sessions.get(sessionID)
  if (!known) {
    known = (async () => {
      let title = ""
      try {
        title = (await ctx.session.get({ sessionID }))?.title ?? ""
      } catch {
        // a session we cannot name is still worth recording
      }
      return {
        id: sessionID,
        title,
        harness: "OpenCode",
        version: String(ctx?.app?.version ?? "") || undefined,
        directory: String(ctx?.location?.directory ?? fallbackDirectory ?? ""),
      }
    })()
    sessions.set(sessionID, known)
  }
  return known
}

export default {
  id: "session-ledger",

  async setup(ctx) {
    const directory = String(ctx?.location?.directory ?? "")
    if (!directory) return

    // User prompts, captured at admission so the ledger holds what was asked,
    // not a paraphrase of it.
    await ctx.session.hook("prompt", async (event) => {
      const config = resolveConfig(ctx?.options ?? {})
      if (!config.prompts || !inScope(config, directory)) return

      const text = String(event?.prompt?.text ?? "")
      if (text.trim() === "") return

      const { body, truncated } = clip(text.trimEnd(), config.maxOutput)
      const at = new Date()
      const sessionID = String(event?.sessionID ?? "unknown")

      try {
        const session = await describe(ctx, sessionID, directory)
        await record(
          { ...session, started: at, timezone: config.timezone },
          {
            kind: "prompt",
            id: shortID(event?.messageID),
            at,
            durationMs: null,
            status: "completed",
            prompt: body,
            cwd: directory,
            output: "",
            truncated,
          },
          config,
        )
      } catch (error) {
        console.error("[session-ledger]", error?.message ?? error)
      }
    })

    await ctx.tool.hook("execute.before", (event) => {
      const tool = String(event?.tool ?? "")
      if (!tool) return
      pending.set(eventKey(event), {
        tool,
        input: event?.input,
        started: Date.now(),
      })
    })

    await ctx.tool.hook("execute.after", (event) => {
      const started = pending.get(eventKey(event))
      if (!started) return
      pending.delete(eventKey(event))

      const config = resolveConfig(ctx?.options ?? {})
      if (!inScope(config, directory)) return

      const shell = isShell(started.tool)
      if (!shell && !config.tools) return

      const input = started.input && typeof started.input === "object" ? started.input : {}
      const command = typeof input.command === "string" ? input.command.trim() : ""
      if (shell && command === "") return

      const failed = event?.status === "error"
      const raw = failed ? String(event?.error?.message ?? "") || textOf(event?.result) : textOf(event?.result)
      const output = clip(raw.trimEnd(), config.maxOutput)
      const args = shell ? null : clip(pretty(started.input ?? {}), config.maxOutput)
      const sessionID = String(event?.sessionID ?? "unknown")
      const at = new Date(started.started)

      return describe(ctx, sessionID, directory)
        .then((session) =>
          record(
            { ...session, started: at, timezone: config.timezone },
            {
              kind: shell ? "command" : "tool",
              id: shortID(event?.id ?? event?.messageID),
              at,
              durationMs: Date.now() - started.started,
              status: failed ? "failed" : "completed",
              command: shell ? command : "",
              tool: shell ? undefined : started.tool,
              input: args?.body,
              inputTruncated: args?.truncated,
              cwd: String(input.cwd ?? directory),
              output: output.body,
              truncated: output.truncated,
            },
            config,
          ),
        )
        .catch((error) => console.error("[session-ledger]", error?.message ?? error))
    })
  },
}
