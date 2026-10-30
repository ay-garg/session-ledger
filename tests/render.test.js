import assert from "node:assert/strict"
import test from "node:test"
import { clip, duration, fence, parts, textOf, zoneName, zoneOffset } from "../core/ledger.js"
import { entry as markdownEntry, header } from "../core/markdown.js"
import { card, stats } from "../core/html.js"

const session = {
  id: "ses_test",
  title: "demo",
  harness: "OpenCode",
  version: "2.2.3",
  directory: "/work",
  started: new Date("2026-10-30T15:30:00Z"),
  timezone: "Asia/Kolkata",
}

const entry = {
  kind: "command",
  id: "a1b2c3d4",
  at: new Date("2026-10-30T15:30:05Z"),
  durationMs: 1780,
  status: "completed",
  command: "echo hi",
  cwd: "/work",
  output: "hi\n",
  truncated: 0,
}

test("pins the zone, not the host clock", () => {
  assert.equal(parts(new Date("2026-10-30T15:30:00Z"), "Asia/Kolkata").time, "21:00:00")
  assert.equal(zoneName("Asia/Kolkata", session.started), "IST")
  assert.equal(zoneOffset("Asia/Kolkata", session.started), "UTC+05:30")
})

test("entry names the zone and the duration", () => {
  const md = markdownEntry(entry, session)
  assert.match(md, /^### ✅ 21:00:05 IST · 1\.78 s · `a1b2c3d4`/m)
  assert.match(md, /```bash\necho hi\n```/)
  assert.match(md, /```text\nhi\n```/)
})

test("failed entries are marked and keep the error text", () => {
  const md = markdownEntry({ ...entry, status: "failed", output: "boom", durationMs: 42 }, session)
  assert.match(md, /^### ❌ /m)
  assert.match(md, /boom/)
  assert.match(md, /42 ms/)
})

test("unknown duration reads as unknown, not as zero", () => {
  assert.match(markdownEntry({ ...entry, durationMs: null }, session), /· — ·/)
  assert.equal(duration(null), "—")
})

test("empty output is stated, not left blank", () => {
  assert.match(markdownEntry({ ...entry, output: "" }, session), /\(no output\)/)
})

test("a command containing backticks cannot break out of its fence", () => {
  const md = markdownEntry({ ...entry, command: "echo ```nested```" }, session)
  assert.match(md, /^````bash$/m)
})

test("truncation is disclosed", () => {
  const { body, truncated } = clip("x".repeat(120), 100)
  assert.equal(body.length, 100)
  assert.equal(truncated, 20)
  assert.match(markdownEntry({ ...entry, output: body, truncated }, session), /20 characters truncated/)
})

test("strings are escaped in html", () => {
  const html = card({ ...entry, command: "echo <b>&" }, session)
  assert.match(html, /echo &lt;b&gt;&amp;/)
  assert.doesNotMatch(html, /<b>/)
})

test("stats count the cards actually present", () => {
  const html =
    card(entry, session) +
    card({ ...entry, id: "deadbeef", status: "failed" }, session) +
    card({ kind: "prompt", id: "cafe0001", at: entry.at, durationMs: null, status: "completed", prompt: "hi", cwd: "/work", output: "" }, session)
  assert.match(stats(html), /3 events/)
  assert.match(stats(html), /2 commands/)
  assert.match(stats(html), /1 prompt/)
  assert.match(stats(html), /1 failed/)
})

test("a prompt gets its own card, with no status mark", () => {
  const md = markdownEntry(
    { kind: "prompt", id: "cafe0001", at: entry.at, durationMs: null, status: "completed", prompt: "Fix the test", cwd: "/work", output: "" },
    session,
  )
  assert.match(md, /^### 💬 21:00:05 IST · `cafe0001`$/m)
  assert.match(md, /```text\nFix the test\n```/)
})

test("a tool call shows its name, input and output", () => {
  const md = markdownEntry(
    {
      ...entry,
      kind: "tool",
      tool: "mcp__filesystem__read_file",
      command: "",
      input: '{\n  "path": "/work/a.js"\n}',
      output: "contents",
    },
    session,
  )
  assert.match(md, /^### ✅ 21:00:05 IST · 1\.78 s · 🛠 `mcp__filesystem__read_file`/m)
  assert.match(md, /```json\n\{\n  "path": "\/work\/a\.js"\n\}\n```/)
  assert.match(md, /\*\*Output\*\*/)
  assert.match(md, /contents/)
})

test("a failed tool call is marked failed", () => {
  const md = markdownEntry({ ...entry, kind: "tool", tool: "Read", command: "", status: "failed", input: "{}" }, session)
  assert.match(md, /^### ❌ /m)
})

test("truncated tool input is disclosed", () => {
  const md = markdownEntry({ ...entry, kind: "tool", tool: "Write", command: "", input: "x", inputTruncated: 42 }, session)
  assert.match(md, /42 characters truncated/)
})

test("the html card carries the entry kind", () => {
  assert.match(card({ ...entry, kind: "tool", tool: "Read", input: "{}" }, session), /data-kind="tool"/)
  assert.match(card({ ...entry, kind: "prompt", prompt: "hi" }, session), /data-kind="prompt"/)
})

test("header states the format version and zone", () => {
  const md = header(session)
  assert.match(md, /schema 1/)
  assert.match(md, /Asia\/Kolkata/)
  assert.match(md, /2026-10-30 21:00:00 IST/)
})

test("duration reads well at every scale", () => {
  assert.equal(duration(42), "42 ms")
  assert.equal(duration(1780), "1.78 s")
  assert.equal(duration(125_000), "2m 05s")
})

test("output shapes from different harnesses are unwrapped", () => {
  assert.equal(textOf({ stdout: "out", stderr: "err" }), "out\nerr")
  assert.equal(textOf({ stdout: "out", stderr: "" }), "out")
  assert.equal(textOf('{"exitCode":0,"stdout":"passed","stderr":""}'), "passed")
  assert.equal(textOf({ output: "plain" }), "plain")
  assert.equal(textOf([{ text: "a" }, { text: "b" }]), "a\nb")
  assert.equal(textOf(undefined), "")
})

test("fence grows past the longest backtick run", () => {
  assert.match(fence("see ``` and ````", "text"), /^`````text\n/)
})

test("output containing $& or $' cannot duplicate the html document", async () => {
  const { mkdtemp, readFile } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { record } = await import("../core/store.js")

  const dir = await mkdtemp(join(tmpdir(), "session-ledger-html-"))
  const config = { dir, timezone: "Asia/Kolkata", html: true, maxOutput: 20000 }
  const subject = { ...session, id: "html-escape", directory: "/work" }
  const tricky = { ...entry, id: "e1", output: "echo $& $' $` $1 <!-- session-ledger:entries --> <html>" }

  await record(subject, tricky, config)
  await record(subject, { ...tricky, id: "e2" }, config)

  const html = await readFile(join(dir, `${parts(subject.started, config.timezone).date}-html-escape.html`), "utf8")
  assert.equal((html.match(/<!doctype html>/gi) ?? []).length, 1)
  assert.equal((html.match(/<!-- session-ledger:entries -->/g) ?? []).length, 1)
  assert.match(html, /echo \$&amp; \$'/) // still escaped, still shown
})
