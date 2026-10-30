#!/usr/bin/env node
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { VERSION } from "../core/ledger.js"
import { upgrade } from "../core/html.js"
import { describeConfig, inScope, resolveConfig } from "../core/config.js"
import { needsPermissionReply, normalize, transcriptReplies } from "../core/normalize.js"
import { record, replaceFile, withLock } from "../core/store.js"

// The single entry point every harness calls. It only ever reads a JSON event on
// stdin, so a harness needs no SDK, no plugin API and no shared process — just the
// ability to run a command and pipe JSON into it.

const HELP = `session-ledger ${VERSION}

  session-ledger hook [options]   read one hook event on stdin, append it (never blocks)
  session-ledger render           restyle every .html page in the output directory
  session-ledger show-config      print the resolved configuration and where each value came from
  session-ledger help             this text

Options (also honoured by show-config):
  --dir <path>          where the .md/.html files go        env SESSION_LEDGER_DIR
  --tz <iana-zone>      timezone for every timestamp        env SESSION_LEDGER_TZ
  --scope <path>        only record sessions under <path>   env SESSION_LEDGER_SCOPE
  --max-output <chars>  text kept per prompt/input/output     env SESSION_LEDGER_MAX_OUTPUT
  --harness <name>      label shown in the header (claude|codex|cursor|...)
  --no-prompts          do not record user prompts           env SESSION_LEDGER_PROMPTS
  --no-replies          do not record the agent's replies    env SESSION_LEDGER_REPLIES
  --no-tools            record shell only, not other tools   env SESSION_LEDGER_TOOLS
  --no-html             skip the HTML page                  env SESSION_LEDGER_HTML
  --config <path>       alternate config file

Config file: ~/.config/session-ledger/config.json
  { "dir": "~/logs", "timezone": "Europe/Berlin", "scope": "~/code",
    "maxOutput": 20000, "prompts": true, "replies": true, "tools": true, "html": true }
`

const main = async () => {
  const [command = "help", ...rest] = process.argv.slice(2)
  if (command === "--version" || command === "-v" || command === "version") return log(VERSION)
  if (command === "help" || command === "--help" || command === "-h") return log(HELP)

  const options = parseFlags(rest)
  const config = resolveConfig(options)

  if (command === "show-config") {
    const { config: path, rows } = describeConfig(config)
    log(`config file: ${path}`)
    for (const row of rows) log(`  ${row.key.padEnd(10)} ${row.value}  (${row.source})`)
    return
  }

  if (command === "render") {
    const count = await restyle(config.dir)
    return log(`restyled ${count} page${count === 1 ? "" : "s"} in ${config.dir}`)
  }

  if (command === "hook") {
    const raw = await readStdin()
    const payload = parse(raw)
    if (!payload) return log("session-ledger: no JSON event on stdin", true)

    // Cursor blocks a tool call unless a permission hook answers with valid JSON,
    // so answer first and do the bookkeeping afterwards.
    if (needsPermissionReply(payload)) process.stdout.write(JSON.stringify({ permission: "allow" }) + "\n")

    const result = normalize(payload, {
      maxOutput: config.maxOutput,
      timezone: config.timezone,
      harness: options.harness,
    })

    if (result.kind === "start") {
      // Out-of-scope sessions never even get a pending file.
      if (!inScope(config, result.session.directory)) return
      await remember(config, result)
      await recordReplies(config, result.session)
      return
    }
    if (result.kind === "ignore") return

    if (result.kind === "flush") {
      if (!inScope(config, result.session.directory)) return
      await flushPending(config, result.session)
      await recordReplies(config, result.session, result.reply)
      return
    }

    if (result.kind === "prompt") {
      if (!inScope(config, result.session.directory)) return
      await recordReplies(config, result.session)
      if (config.prompts) await record(result.session, result.entry, config)
      return
    }

    const pending = await forget(config, result.key)
    if (pending) {
      result.entry.at = new Date(pending.started)
      if (result.entry.durationMs === null) result.entry.durationMs = Date.now() - pending.started
      // The label is normally on every event, but keep the one from the start
      // event so a config that sets it once still gets it right.
      if (pending.harness && !options.harness) result.session.harness = pending.harness
    }
    if (!inScope(config, result.session.directory)) return
    // The transcript can lag the tool's start, and this entry is the one it should precede.
    await recordReplies(config, result.session)
    if (result.entry.kind === "tool" && !config.tools) return

    result.session.started = new Date(pending?.started ?? result.entry.at)
    await record(result.session, result.entry, config)
    return
  }

  log(`session-ledger: unknown command "${command}"\n`, true)
  log(HELP)
  process.exitCode = 2
}

// The page markup is stable, so a new stylesheet can be applied to pages written by
// an older version without rereading the markdown.
async function restyle(dir) {
  let count = 0
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.endsWith(".html")) continue
    const file = join(dir, name)
    // Same lock the hooks take, so a live session cannot lose an entry to this.
    const changed = await withLock(file, async () => {
      const html = await readFile(file, "utf8")
      const next = upgrade(html)
      if (next === html) return false
      await replaceFile(file, next)
      return true
    })
    if (changed) count++
  }
  return count
}

function parseFlags(args) {
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = () => args[++i]
    if (arg === "--dir") out.dir = next()
    else if (arg === "--tz" || arg === "--timezone") out.timezone = next()
    else if (arg === "--scope") out.scope = next()
    else if (arg === "--max-output") out.maxOutput = Number(next())
    else if (arg === "--harness") out.harness = next()
    else if (arg === "--config") process.env.SESSION_LEDGER_CONFIG = next()
    else if (arg === "--no-html") out.html = false
    else if (arg === "--no-prompts") out.prompts = false
    else if (arg === "--no-replies") out.replies = false
    else if (arg === "--no-tools") out.tools = false
  }
  return out
}

// fs.promises.readFile does not take a file descriptor, and /dev/stdin is not
// portable, so read the stream directly.
async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

const parse = (text) => {
  try {
    const value = JSON.parse(text)
    return value && typeof value === "object" ? value : null
  } catch {
    return null
  }
}

const stateDir = (config) => join(config.dir, ".state", "pending")
const slot = (key) => key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120)

// Stop reports only a turn's last message and can beat that message to the transcript,
// so the transcript fills in what came before it and `last` stops it being written twice.
async function recordReplies(config, session, final = null) {
  if (!config.replies) return
  if (!session.transcript) {
    if (final) await record(session, final, config)
    return
  }
  const dir = join(config.dir, ".state", "replies")
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${slot(session.id)}.json`)
  // Parallel tool calls land together; the lock lets each transcript line be read once.
  await withLock(file, async () => {
    const seen = JSON.parse(await readFile(file, "utf8").catch(() => "null"))
    const { lines, offset } = await newLines(session.transcript, seen)
    for (const reply of transcriptReplies(lines, session, config.maxOutput)) {
      if (reply.reply !== seen?.last && reply.reply !== final?.reply) await record(session, reply, config)
    }
    if (final) await record(session, final, config)
    await replaceFile(file, JSON.stringify({ path: session.transcript, offset, last: final?.reply ?? seen?.last }))
  })
  await sweep(dir)
}

// Only what was added since last time, so a long session costs no more than a short
// one. A session first seen part-way through starts here and now: its older replies
// have no place in a file that is append-only.
async function newLines(path, seen) {
  const handle = await open(path, "r").catch(() => null)
  if (!handle) return { lines: "", offset: 0 }
  try {
    const { size } = await handle.stat()
    const start = seen?.path === path && seen.offset <= size ? seen.offset : size
    const { buffer } = await handle.read(Buffer.alloc(size - start), 0, size - start, start)
    // A line still being written is picked up next time.
    const end = buffer.lastIndexOf("\n") + 1
    return { lines: buffer.toString("utf8", 0, end), offset: start + end }
  } finally {
    await handle.close()
  }
}

async function remember(config, result) {
  const dir = stateDir(config)
  await mkdir(dir, { recursive: true })
  const pending = { started: +result.started, harness: result.session.harness, ...result.pending }
  await writeFile(join(dir, `${slot(result.key)}.json`), JSON.stringify(pending), "utf8")
  await sweep(dir)
}

async function forget(config, key) {
  const file = join(stateDir(config), `${slot(key)}.json`)
  try {
    const pending = JSON.parse(await readFile(file, "utf8"))
    await rm(file, { force: true })
    return pending
  } catch {
    return null
  }
}

// Some harnesses start a tool, never report its result, then end the turn — Codex
// does this for apply_patch. Write what we saw rather than lose the call.
async function flushPending(config, session) {
  const dir = stateDir(config)
  for (const name of await readdir(dir).catch(() => [])) {
    const file = join(dir, name)
    let pending
    try {
      pending = JSON.parse(await readFile(file, "utf8"))
    } catch {
      continue
    }
    if (pending.sessionId !== session.id) continue
    await rm(file, { force: true })
    if (pending.tool && !config.tools) continue

    await record(
      { ...session, started: new Date(pending.started), harness: pending.harness ?? session.harness },
      {
        kind: pending.command ? "command" : "tool",
        id: pending.id ?? String(pending.started).slice(-8),
        at: new Date(pending.started),
        durationMs: null,
        status: "unconfirmed",
        command: pending.command ?? "",
        tool: pending.tool,
        input: pending.input,
        inputTruncated: pending.inputTruncated,
        cwd: pending.cwd ?? session.directory,
        output: "",
        truncated: 0,
      },
      config,
    ).catch((error) => process.stderr.write(`[session-ledger] ${error?.message ?? error}\n`))
  }
}

// A tool that never completes (denied, interrupted) leaves a pending file behind.
const DAY = 24 * 60 * 60 * 1000
async function sweep(dir) {
  try {
    const now = Date.now()
    for (const name of await readdir(dir)) {
      const file = join(dir, name)
      const info = await stat(file).catch(() => null)
      if (info && now - info.mtimeMs > DAY) await rm(file, { force: true })
    }
  } catch {
    // housekeeping only
  }
}

function log(text, toStderr = false) {
  const stream = toStderr ? process.stderr : process.stdout
  stream.write(`${text}\n`)
}

const fail = (error) => {
  process.stderr.write(`[session-ledger] ${error?.message ?? error}\n`)
  process.exitCode = 1
}

main().catch(fail)
