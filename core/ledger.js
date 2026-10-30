// Shared vocabulary for a session ledger. No harness imports and no build step:
// plain ESM so `node`, `bun` and any hook runner can load it as-is.

export const VERSION = "0.2.0"
export const SCHEMA = 1

export const DEFAULT_MAX_OUTPUT = 20_000

/**
 * @typedef {"completed" | "failed"} Status
 *
 * @typedef {object} Entry
 * @property {string} id        Stable, unique within the session. Never reused.
 * @property {Date} at          When the command was requested.
 * @property {number | null} durationMs  null when the harness does not report it.
 * @property {Status} status
 * @property {string} command
 * @property {string} cwd
 * @property {string} output
 * @property {number} truncated  Characters dropped from `output`, 0 if intact.
 *
 * @typedef {object} Session
 * @property {string} id
 * @property {string} [title]
 * @property {string} harness
 * @property {string} [version]
 * @property {string} directory
 * @property {Date} started
 * @property {string} timezone   IANA zone, pinned so a TZ=UTC process cannot skew the record.
 */

const stampers = new Map()

function stamper(timezone) {
  let f = stampers.get(timezone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
    stampers.set(timezone, f)
  }
  return f
}

/** Local date and clock for `at`, in `timezone`. */
export function parts(at, timezone) {
  /** @type {Record<string, string>} */
  const p = {}
  for (const part of stamper(timezone).formatToParts(at)) p[part.type] = part.value
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` }
}

/** "IST", "GMT+1" — whatever the zone is called at that instant. */
export function zoneName(timezone, at) {
  const found = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value
  return found ?? timezone
}

/** "UTC+05:30" — unambiguous, unlike an abbreviation. */
export function zoneOffset(timezone, at) {
  const found = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value
  return (found ?? "").replace("GMT", "UTC") || "UTC+00:00"
}

export function duration(ms) {
  if (ms === null || ms === undefined) return "—"
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${String(s).padStart(2, "0")}s`
}

/** Fence longer than any backtick run inside `body`, so output can never break out. */
export function fence(body, lang) {
  let ticks = "```"
  while (body.includes(ticks)) ticks += "`"
  return `${ticks}${lang}\n${body.replace(/\n+$/, "")}\n${ticks}`
}

export function clip(text, limit = DEFAULT_MAX_OUTPUT) {
  if (text.length <= limit) return { body: text, truncated: 0 }
  return { body: text.slice(0, limit), truncated: text.length - limit }
}

/**
 * Pull readable output out of whatever shape a harness reports. Every harness
 * wraps tool results differently and none of them promise stability, so this is
 * deliberately forgiving: wrong guess means ugly output, not lost output.
 */
export function textOf(value) {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return maybeJson(value)
  if (typeof value !== "object") return String(value)
  if (Array.isArray(value)) return joinParts(value) || dump(value)
  if (typeof value.stdout === "string" || typeof value.stderr === "string") {
    return [value.stdout ?? "", value.stderr ?? ""].filter((s) => s.trim() !== "").join("\n")
  }
  for (const key of ["output", "content", "text", "message", "result"]) {
    const found = value[key]
    if (typeof found === "string" && found !== "") return maybeJson(found)
    if (Array.isArray(found)) {
      const joined = joinParts(found)
      if (joined !== "") return joined
    }
  }
  return dump(value)
} 

const joinParts = (parts) =>
  parts.map((part) => (typeof part === "string" ? part : part?.text ?? "")).filter(Boolean).join("\n")

function dump(value) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function maybeJson(text) {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text
  try {
    return textOf(JSON.parse(trimmed))
  } catch {
    return text
  }
}
