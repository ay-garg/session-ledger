import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { appendFile, mkdtemp, readdir, readFile, rm, truncate, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { CSS } from "../core/html.js"

// End-to-end: feed the CLI the real payload shape each harness sends and check
// what lands on disk. If a harness changes its JSON, one of these fails loudly.

const CLI = fileURLToPath(new URL("../bin/session-ledger.js", import.meta.url))

function run(args, payload) {
  return new Promise((done) => {
    const child = execFile("node", [CLI, "hook", "--tz", "Asia/Kolkata", ...args], (error, stdout, stderr) => {
      done({ code: error?.code ?? 0, stdout, stderr })
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

function cli(args) {
  return new Promise((done) => {
    execFile("node", [CLI, ...args], (error, stdout, stderr) => {
      done({ code: error?.code ?? 0, stdout, stderr })
    })
  })
}

async function sandbox() {
  return mkdtemp(join(tmpdir(), "session-ledger-"))
}

async function readMarkdown(dir) {
  const [file] = (await readdir(dir)).filter((name) => name.endsWith(".md"))
  assert.ok(file, `no markdown written to ${dir}`)
  return { file, text: await readFile(join(dir, file), "utf8") }
}

const claudeStart = {
  session_id: "cc-1",
  transcript_path: "/tmp/x.jsonl",
  cwd: "/work/project",
  permission_mode: "default",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "npm test", description: "Run tests" },
  tool_use_id: "toolu_01ABC",
}

const claudeEnd = {
  ...claudeStart,
  hook_event_name: "PostToolUse",
  tool_response: { stdout: "12 passing", stderr: "", interrupted: false },
  duration_ms: 1420,
}

const cursorStart = {
  conversation_id: "cur-1",
  generation_id: "gen-1",
  hook_event_name: "preToolUse",
  workspace_roots: ["/work/project"],
  tool_name: "Bash",
  tool_input: { command: "ls -la" },
}

test("claude code: pre + post becomes one completed entry", async () => {
  const dir = await sandbox()
  await run(["--dir", dir, "--harness", "Claude Code"], claudeStart)
  await run(["--dir", dir], claudeEnd)

  const { file, text } = await readMarkdown(dir)
  assert.match(file, /^\d{4}-\d{2}-\d{2}-cc-1\.md$/)
  assert.match(text, /Claude Code/)
  assert.match(text, /npm test/)
  assert.match(text, /12 passing/)
  assert.match(text, /^### ✅ \d{2}:\d{2}:\d{2} IST · 1\.42 s/m)
  assert.match(text, /Session.*`cc-1`/)
})

test("claude code: a failure event is marked failed, not completed", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], claudeStart)
  await run(["--dir", dir], {
    ...claudeEnd,
    hook_event_name: "PostToolUseFailure",
    error: "Exit code 1\nCannot find module 'express'",
    tool_response: undefined,
    duration_ms: 4187,
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### ❌ /m)
  assert.match(text, /Cannot find module 'express'/)
  assert.match(text, /4\.19 s/)
})

test("codex: no duration field still yields a measured duration", async () => {
  const dir = await sandbox()
  const base = {
    session_id: "cx-1",
    cwd: "/work/project",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
  }
  await run(["--dir", dir, "--harness", "Codex"], base)
  await run(["--dir", dir, "--harness", "Codex"], {
    ...base,
    hook_event_name: "PostToolUse",
    tool_response: { output: "hi\n", exit_code: 0 },
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### ✅ .* · (?!—)/m)
  assert.match(text, /echo hi/)
  assert.match(text, /Codex/)
})

test("cursor: permission hook answers so the tool is not blocked", async () => {
  const dir = await sandbox()
  const reply = await run(["--dir", dir], cursorStart)
  assert.equal(reply.stdout.trim(), '{"permission":"allow"}')
  assert.equal(reply.code, 0)
})

test("cursor: postToolUse unwraps the JSON string in tool_output", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], cursorStart)
  await run(["--dir", dir], {
    ...cursorStart,
    hook_event_name: "postToolUse",
    tool_output: JSON.stringify({ exitCode: 0, stdout: "total 0\ndrwxr-xr-x", stderr: "" }),
    duration: 63,
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### ✅ .* · 63 ms/m)
  assert.match(text, /total 0/)
  assert.doesNotMatch(text, /exitCode/)
  assert.match(text, /Cursor/)
})

test("cursor: beforeShellExecution carries the command at top level", async () => {
  const dir = await sandbox()
  const base = {
    conversation_id: "cur-2",
    hook_event_name: "beforeShellExecution",
    command: "git status",
    cwd: "/work/project",
  }
  const reply = await run(["--dir", dir], base)
  assert.equal(reply.stdout.trim(), '{"permission":"allow"}')
  await run(["--dir", dir], {
    ...base,
    hook_event_name: "afterShellExecution",
    output: "On branch main",
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /git status/)
  assert.match(text, /On branch main/)
})

test("cursor: postToolUseFailure is marked failed", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], cursorStart)
  await run(["--dir", dir], {
    ...cursorStart,
    hook_event_name: "postToolUseFailure",
    error_message: "permission denied",
    duration: 12,
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### ❌ /m)
  assert.match(text, /permission denied/)
})

test("a non-shell tool is recorded with its name, input and output", async () => {
  const dir = await sandbox()
  const base = {
    ...claudeEnd,
    tool_name: "Read",
    tool_input: { file_path: "/work/project/a.js" },
    tool_use_id: "toolu_read01",
  }
  await run(["--dir", dir], { ...base, hook_event_name: "PreToolUse", tool_response: undefined })
  await run(["--dir", dir], { ...base, tool_response: { type: "text", file: { content: "export const a = 1" } } })

  const { text } = await readMarkdown(dir)
  assert.match(text, /🛠 `Read`/)
  assert.match(text, /"file_path": "\/work\/project\/a\.js"/)
  assert.match(text, /export const a = 1/)
})

test("an MCP tool call is recorded like any other tool", async () => {
  const dir = await sandbox()
  const base = {
    ...claudeEnd,
    tool_name: "mcp__filesystem__read_file",
    tool_input: { path: "/work/project/a.js" },
    tool_use_id: "toolu_mcp01",
  }
  await run(["--dir", dir], { ...base, hook_event_name: "PreToolUse", tool_response: undefined })
  await run(["--dir", dir], { ...base, tool_response: { content: "file body" }, duration_ms: 9 })

  const { text } = await readMarkdown(dir)
  assert.match(text, /🛠 `mcp__filesystem__read_file`/)
  assert.match(text, /file body/)
})

test("claude code: a user prompt is recorded as a prompt entry", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], {
    session_id: "cc-prompt",
    cwd: "/work/project",
    hook_event_name: "UserPromptSubmit",
    prompt: "Fix the failing checkout test",
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### 💬 \d{2}:\d{2}:\d{2} IST · `\d+`$/m)
  assert.match(text, /Fix the failing checkout test/)
  assert.doesNotMatch(text, /✅|❌/)
})

test("cursor: beforeSubmitPrompt is recorded without a permission reply", async () => {
  const dir = await sandbox()
  const result = await run(["--dir", dir], {
    conversation_id: "cur-prompt",
    hook_event_name: "beforeSubmitPrompt",
    prompt: "Add a retry to the uploader",
  })
  assert.equal(result.stdout.trim(), "")

  const { text } = await readMarkdown(dir)
  assert.match(text, /Add a retry to the uploader/)
  assert.match(text, /Cursor/)
})

test("codex: UserPromptSubmit is recorded", async () => {
  const dir = await sandbox()
  await run(["--dir", dir, "--harness", "Codex"], {
    session_id: "cx-prompt",
    cwd: "/work/project",
    hook_event_name: "UserPromptSubmit",
    prompt: "Why is the build slow?",
  })

  const { text } = await readMarkdown(dir)
  assert.match(text, /Why is the build slow\?/)
  assert.match(text, /Codex/)
})

test("prompts, commands and tools share one session file in order", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], { session_id: "mixed", cwd: "/work", hook_event_name: "UserPromptSubmit", prompt: "run tests" })
  await run(["--dir", dir], { ...claudeStart, session_id: "mixed", cwd: "/work" })
  await run(["--dir", dir], { ...claudeEnd, session_id: "mixed", cwd: "/work" })

  const { text } = await readMarkdown(dir)
  const promptAt = text.indexOf("### 💬")
  const commandAt = text.indexOf("### ✅")
  assert.ok(promptAt > 0 && commandAt > promptAt, "prompt must appear before the command it asked for")
})

test("--no-tools keeps shell commands but drops other tools", async () => {
  const dir = await sandbox()
  const base = { ...claudeEnd, tool_name: "Read", tool_input: { file_path: "/work/a.js" }, tool_use_id: "toolu_r2" }
  await run(["--dir", dir, "--no-tools"], { ...base, hook_event_name: "PreToolUse", tool_response: undefined })
  await run(["--dir", dir, "--no-tools"], base)

  assert.deepEqual(await readdir(dir).then((names) => names.filter((n) => n.endsWith(".md"))), [])
})

test("--no-prompts drops prompts but keeps commands", async () => {
  const dir = await sandbox()
  await run(["--dir", dir, "--no-prompts"], {
    session_id: "cc-nop",
    cwd: "/work/project",
    hook_event_name: "UserPromptSubmit",
    prompt: "not recorded",
  })
  assert.deepEqual(await readdir(dir).then((names) => names.filter((n) => n.endsWith(".md"))), [])

  await run(["--dir", dir, "--no-prompts"], claudeStart)
  await run(["--dir", dir, "--no-prompts"], claudeEnd)
  const { text } = await readMarkdown(dir)
  assert.match(text, /npm test/)
})

test("sessions outside the configured scope are skipped", async () => {
  const dir = await sandbox()
  await run(["--dir", dir, "--scope", "/work/other"], claudeStart)
  await run(["--dir", dir, "--scope", "/work/other"], claudeEnd)

  assert.deepEqual(await readdir(dir), [])
})

test("one session writes one file even across many entries", async () => {
  const dir = await sandbox()
  for (let i = 0; i < 3; i++) {
    const start = { ...claudeStart, tool_input: { command: `echo ${i}` } }
    await run(["--dir", dir], start)
    await run(["--dir", dir], { ...claudeEnd, tool_input: { command: `echo ${i}` } })
  }

  const files = (await readdir(dir)).filter((name) => name.endsWith(".md"))
  assert.equal(files.length, 1)
  const text = await readFile(join(dir, files[0]), "utf8")
  assert.equal((text.match(/^# 🗂 Session Ledger$/gm) ?? []).length, 1)
  assert.equal((text.match(/^### ✅ /gm) ?? []).length, 3)
})

test("garbage on stdin is ignored instead of crashing the harness", async () => {
  const dir = await sandbox()
  const result = await new Promise((done) => {
    const child = execFile("node", [CLI, "hook", "--dir", dir], (error, stdout) => done({ code: error?.code ?? 0 }))
    child.stdin.end("not json")
  })

  assert.equal(result.code, 0)
  assert.deepEqual(await readdir(dir), [])
})

test("a call that never reports back is written at turn end, marked unconfirmed", async () => {
  const dir = await sandbox()
  // Codex announces apply_patch, never sends PostToolUse for it, then ends the turn.
  await run(["--dir", dir], {
    session_id: "cx-patch",
    cwd: "/work/project",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "apply_patch <<'PATCH'\n*** Begin Patch\n*** End Patch\nPATCH" },
    tool_use_id: "call_patch1",
  })
  // nothing on disk until the turn ends
  assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".md")), [])

  await run(["--dir", dir], { session_id: "cx-patch", cwd: "/work/project", hook_event_name: "Stop" })

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### ⚠️ \d{2}:\d{2}:\d{2} IST · — · `l_patch1`$/m)
  assert.match(text, /apply_patch/)
  assert.match(text, /no result reported by the harness/)
})

test("a turn end with nothing pending writes nothing and leaves no state", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], { session_id: "cx-quiet", cwd: "/work/project", hook_event_name: "Stop" })
  assert.deepEqual(await readdir(dir), [])
})

test("an unconfirmed call is not flushed into another session's file", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], { ...claudeStart, session_id: "ses-a", tool_use_id: "toolu_a" })
  await run(["--dir", dir], { session_id: "ses-b", cwd: "/work/project", hook_event_name: "Stop" })
  assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".md")), [])
})

const stop = {
  session_id: "cc-reply",
  cwd: "/work/project",
  hook_event_name: "Stop",
  stop_hook_active: false,
  last_assistant_message: "Here are the git commands",
}

test("claude code: the turn's final reply is recorded at Stop", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], stop)

  const { text } = await readMarkdown(dir)
  assert.match(text, /^### 🤖 \d{2}:\d{2}:\d{2} IST · `\d+`$/m)
  assert.match(text, /Here are the git commands/)
})

test("--no-replies drops the reply but still flushes unfinished calls", async () => {
  const dir = await sandbox()
  await run(["--dir", dir, "--no-replies"], stop)
  assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".md")), [])

  await run(["--dir", dir, "--no-replies"], { ...claudeStart, session_id: "cc-reply" })
  await run(["--dir", dir, "--no-replies"], stop)
  const { text } = await readMarkdown(dir)
  assert.match(text, /^### ⚠️ /m)
  assert.doesNotMatch(text, /Here are the git commands/)
})

async function seededPage(dir) {
  await run(["--dir", dir], claudeStart)
  await run(["--dir", dir], claudeEnd)
  const [name] = (await readdir(dir)).filter((n) => n.endsWith(".html"))
  return join(dir, name)
}

const nextCall = { ...claudeEnd, tool_use_id: "toolu_02DEF" }
const cards = async (page) => ((await readFile(page, "utf8")).match(/<section class="card entry/g) ?? []).length
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

test("an append leaves every earlier byte of the page untouched", async () => {
  const dir = await sandbox()
  const page = await seededPage(dir)
  // A byte that is not valid UTF-8: reading and rewriting the page would change it.
  const original = await readFile(page)
  const at = original.indexOf("</header>")
  const poisoned = Buffer.concat([original.subarray(0, at), Buffer.from([0xff]), original.subarray(at)])
  await writeFile(page, poisoned)
  const before = poisoned.subarray(0, poisoned.indexOf("<!-- session-ledger:entries -->"))

  await run(["--dir", dir], nextCall)

  assert.deepEqual((await readFile(page)).subarray(0, before.length), before)
  assert.equal(await cards(page), 2)
})

test("a page cut off mid-card keeps its earlier cards and carries on", async () => {
  const dir = await sandbox()
  const page = await seededPage(dir)
  await run(["--dir", dir], nextCall)
  const html = await readFile(page)
  await truncate(page, html.lastIndexOf("</section>") - 20)

  const { code, stderr } = await run(["--dir", dir], { ...nextCall, tool_use_id: "toolu_03GHI" })

  assert.equal(code, 0)
  assert.match(stderr, /cut short/)
  const fixed = await readFile(page, "utf8")
  assert.equal(await cards(page), 2)
  assert.match(fixed, /2 commands/)
  assert.match(fixed, /<\/html>\n$/)
})

test("a page in the old layout is moved to the new one on its next entry", async () => {
  const dir = await sandbox()
  const page = await seededPage(dir)
  const old = (await readFile(page, "utf8"))
    .replace(/<div class="stats">[\s\S]*?<\/div>\n/, "")
    .replace(
      "<main>",
      '<div class="stats"><!-- session-ledger:stats:start --><span class="chip ok">1 command</span><!-- session-ledger:stats:end --></div>\n<main>',
    )
  await writeFile(page, old)

  await run(["--dir", dir], nextCall)

  const fresh = await readFile(page, "utf8")
  assert.equal(await cards(page), 2)
  assert.match(fresh, /2 commands/)
  assert.equal((fresh.match(/class="stats"/g) ?? []).length, 1)
  assert.ok(fresh.indexOf('class="stats"') > fresh.indexOf("</main>"), "stats belong after the cards")
})

test("a page that lost its entries marker fails loudly and the markdown keeps the entry", async () => {
  const dir = await sandbox()
  const page = await seededPage(dir)
  await truncate(page, 1000)

  const { code, stderr } = await run(["--dir", dir], nextCall)

  assert.equal(code, 1)
  assert.match(stderr, /entries marker/)
  assert.ok(stderr.includes(page), "the error must name the page")
  const { text } = await readMarkdown(dir)
  assert.equal((text.match(/^### ✅ /gm) ?? []).length, 2)
})

test("a held lock is waited out, never written through", async () => {
  const dir = await sandbox()
  const page = await seededPage(dir)
  await writeFile(`${page}.lock`, String(process.pid))

  const pending = run(["--dir", dir], nextCall)
  await sleep(1500)
  assert.equal(await cards(page), 1)

  await rm(`${page}.lock`)
  await pending
  assert.equal(await cards(page), 2)
})

test("a lock whose owner is dead is cleared at once", async () => {
  const dir = await sandbox()
  const page = await seededPage(dir)
  const dead = await new Promise((done) => {
    const child = execFile("node", ["-e", ""], () => done(child.pid))
  })
  await writeFile(`${page}.lock`, String(dead))

  const started = Date.now()
  await run(["--dir", dir], nextCall)

  assert.ok(Date.now() - started < 3000, "no reason to wait for a dead process")
  assert.equal(await cards(page), 2)
  assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".lock")), [])
})

test("a lock left by a killed process is cleared, not kept forever", async () => {
  const dir = await sandbox()
  const page = await seededPage(dir)
  await writeFile(`${page}.lock`, "")
  const longAgo = new Date(Date.now() - 60_000)
  await utimes(`${page}.lock`, longAgo, longAgo)

  await run(["--dir", dir], nextCall)

  assert.equal(await cards(page), 2)
  assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".lock")), [])
})

const said = (text, extra = {}) =>
  `${JSON.stringify({ type: "assistant", uuid: `uuid-${text}`, timestamp: "2026-10-30T15:30:00Z", message: { content: [{ type: "text", text }] }, ...extra })}\n`

async function talking(session) {
  const dir = await sandbox()
  const transcript = join(dir, "transcript.jsonl")
  await writeFile(transcript, "")
  return { dir, transcript, base: { session_id: session, cwd: "/work/project", transcript_path: transcript } }
}

const replies = (text) => (text.match(/^### 🤖 /gm) ?? []).length

test("text between tool calls lands before the tool it led to", async () => {
  const { dir, transcript, base } = await talking("cc-talk")
  await run(["--dir", dir], { ...base, hook_event_name: "UserPromptSubmit", prompt: "run the tests" })
  await appendFile(transcript, said("Looking at the tests first"))
  await run(["--dir", dir], { ...claudeStart, ...base })
  await run(["--dir", dir], { ...claudeEnd, ...base })
  await appendFile(transcript, said("All done"))
  await run(["--dir", dir], { ...base, hook_event_name: "Stop", last_assistant_message: "All done" })

  const { text } = await readMarkdown(dir)
  assert.equal(replies(text), 2)
  const order = ["run the tests", "Looking at the tests first", "npm test", "All done"].map((part) => text.indexOf(part))
  assert.deepEqual([...order].sort((a, b) => a - b), order)
})

test("text that reaches the transcript after its tool started still lands before it", async () => {
  const { dir, transcript, base } = await talking("cc-lag")
  await run(["--dir", dir], { ...base, hook_event_name: "UserPromptSubmit", prompt: "go" })
  await run(["--dir", dir], { ...claudeStart, ...base })
  await appendFile(transcript, said("Checking the date"))
  await run(["--dir", dir], { ...claudeEnd, ...base })

  const { text } = await readMarkdown(dir)
  assert.ok(text.indexOf("Checking the date") > 0, "the reply is missing")
  assert.ok(text.indexOf("Checking the date") < text.indexOf("npm test"), "the reply belongs before its tool")
})

test("a final reply that reaches the transcript late is not recorded twice", async () => {
  const { dir, transcript, base } = await talking("cc-late")
  await run(["--dir", dir], { ...base, hook_event_name: "UserPromptSubmit", prompt: "hi" })
  await run(["--dir", dir], { ...base, hook_event_name: "Stop", last_assistant_message: "Hello" })
  await appendFile(transcript, said("Hello"))
  await run(["--dir", dir], { ...base, hook_event_name: "UserPromptSubmit", prompt: "again" })

  const { text } = await readMarkdown(dir)
  assert.equal(replies(text), 1)
})

test("a session already running does not dump its old replies", async () => {
  const { dir, transcript, base } = await talking("cc-midway")
  await appendFile(transcript, said("From before the hook existed"))
  await run(["--dir", dir], { ...claudeStart, ...base })
  await appendFile(transcript, said("From after"))
  await run(["--dir", dir], { ...claudeEnd, ...base })
  await run(["--dir", dir], { ...claudeStart, ...base, tool_use_id: "toolu_later" })

  const { text } = await readMarkdown(dir)
  assert.doesNotMatch(text, /From before the hook existed/)
  assert.match(text, /From after/)
})

test("only the main agent's text is a reply", async () => {
  const { dir, transcript, base } = await talking("cc-side")
  await run(["--dir", dir], { ...base, hook_event_name: "UserPromptSubmit", prompt: "hi" })
  await appendFile(transcript, said("Subagent chatter", { isSidechain: true }))
  await appendFile(transcript, said("Not the agent", { type: "user" }))
  await appendFile(transcript, `${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } })}\nnot json\n`)
  await run(["--dir", dir], { ...claudeStart, ...base })

  assert.deepEqual(await readdir(dir).then((names) => names.filter((n) => n.endsWith(".md") && !n.startsWith("transcript"))).then(async ([name]) => replies(await readFile(join(dir, name), "utf8"))), 0)
})

test("a half-written transcript line waits for the rest of it", async () => {
  const { dir, transcript, base } = await talking("cc-half")
  await run(["--dir", dir], { ...base, hook_event_name: "UserPromptSubmit", prompt: "hi" })
  const line = said("Working on it")
  await appendFile(transcript, line.slice(0, 20))
  await run(["--dir", dir], { ...claudeStart, ...base })
  await appendFile(transcript, line.slice(20))
  await run(["--dir", dir], { ...claudeEnd, ...base })
  await run(["--dir", dir], { ...claudeStart, ...base, tool_use_id: "toolu_next" })

  const { text } = await readMarkdown(dir)
  assert.equal(replies(text), 1)
})

test("parallel tool calls read each transcript line once", async () => {
  const { dir, transcript, base } = await talking("cc-parallel")
  await run(["--dir", dir], { ...base, hook_event_name: "UserPromptSubmit", prompt: "hi" })
  await appendFile(transcript, said("Running these together"))
  await Promise.all(
    Array.from({ length: 6 }, (_, i) => run(["--dir", dir], { ...claudeStart, ...base, tool_use_id: `toolu_p${i}` })),
  )

  const { text } = await readMarkdown(dir)
  assert.equal(replies(text), 1)
})

test("--no-replies skips transcript text too", async () => {
  const { dir, transcript, base } = await talking("cc-quiet")
  await run(["--dir", dir, "--no-replies"], { ...base, hook_event_name: "UserPromptSubmit", prompt: "hi" })
  await appendFile(transcript, said("Should stay out"))
  await run(["--dir", dir, "--no-replies"], { ...claudeStart, ...base })
  await run(["--dir", dir, "--no-replies"], { ...claudeEnd, ...base })

  const { text } = await readMarkdown(dir)
  assert.doesNotMatch(text, /Should stay out/)
})

test("render replaces an old page's stylesheet and leaves its entries alone", async () => {
  const dir = await sandbox()
  await run(["--dir", dir], claudeStart)
  await run(["--dir", dir], claudeEnd)
  const [name] = (await readdir(dir)).filter((n) => n.endsWith(".html"))
  const page = join(dir, name)

  const stale = (await readFile(page, "utf8")).replace(/<style>[\s\S]*?<\/style>/, "<style>old{}</style>")
  await writeFile(page, stale, "utf8")

  const { code, stdout } = await cli(["render", "--dir", dir])
  assert.equal(code, 0)
  assert.match(stdout, /restyled 1 page/)

  const fresh = await readFile(page, "utf8")
  assert.ok(fresh.includes(CSS), "stylesheet is not the current one")
  assert.doesNotMatch(fresh, /old\{\}/)
  assert.match(fresh, /data-kind="command"/)
  // The page is dark, always — no light palette and nothing keyed to the OS theme.
  assert.match(fresh, /data-theme="dark"/)
  assert.match(fresh, /<meta name="color-scheme" content="dark">/)
  assert.doesNotMatch(fresh, /prefers-color-scheme|--page:#f5f5f7/)
})
