import { clip, textOf } from "../../core/ledger.js"
import { inScope, resolveConfig } from "../../core/config.js"
import { record } from "../../core/store.js"

// OpenCode adapter. Everything harness-specific lives in this file: how to see a
// command start and finish. Formatting and file writing are shared with the
// hook-based adapters (Claude Code, Codex, Cursor) in core/.

const pending = new Map()
const sessions = new Map()

const isShell = (tool) => /^(shell|bash)$/i.test(String(tool ?? ""))
const eventKey = (event) => `${event?.sessionID ?? "unknown"}:${event?.id ?? event?.messageID ?? ""}`

function describe(ctx, sessionID) {
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
        directory: String(ctx?.location?.directory ?? ""),
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

    await ctx.tool.hook("execute.before", (event) => {
      if (!isShell(event?.tool)) return
      const command = event?.input?.command ?? event?.input?.cmd
      if (typeof command !== "string" || !command.trim()) return
      pending.set(eventKey(event), {
        command: command.trim(),
        cwd: String(event?.input?.cwd ?? directory),
        started: Date.now(),
      })
    })

    await ctx.tool.hook("execute.after", (event) => {
      const started = pending.get(eventKey(event))
      if (!started) return
      pending.delete(eventKey(event))

      const config = resolveConfig(ctx?.options ?? {})
      if (!inScope(config, directory)) return

      const failed = event?.status === "error"
      const raw = failed
        ? String(event?.error?.message ?? "") || textOf(event?.result)
        : textOf(event?.result)
      const { body, truncated } = clip(raw.trimEnd(), config.maxOutput)
      const sessionID = String(event?.sessionID ?? "unknown")
      const at = new Date(started.started)

      return describe(ctx, sessionID)
        .then((session) =>
          record(
            { ...session, started: at, timezone: config.timezone },
            {
              id: String(event?.id ?? event?.messageID ?? Date.now()).replace(/^tool[-_]/i, "").slice(-8),
              at,
              durationMs: Date.now() - started.started,
              status: failed ? "failed" : "completed",
              command: started.command,
              cwd: started.cwd,
              output: body,
              truncated,
            },
            config,
          ),
        )
        .catch((error) => console.error("[session-ledger]", error?.message ?? error))
    })
  },
}
