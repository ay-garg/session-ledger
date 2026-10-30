import { SCHEMA, VERSION, duration, parts, zoneName, zoneOffset } from "./ledger.js"

// Companion view. Markdown cannot blur or layer translucency, so the
// glassmorphism lives here: one self-contained file, no JS, no network.

export const ENTRIES_MARK = "<!-- session-ledger:entries -->"
export const STATS_START = "<!-- session-ledger:stats:start -->"
export const STATS_END = "<!-- session-ledger:stats:end -->"

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const CSS = `
:root{
  --page:#f2f4f7;
  --ink:#111827; --muted:#4b5563;
  --glass:rgba(255,255,255,.58); --stroke:rgba(255,255,255,.85);
  --code:rgba(17,24,39,.05); --shadow:0 20px 48px -28px rgba(15,23,42,.35);
  --ok:#046c4e; --okbg:rgba(5,150,105,.12);
  --fail:#a01b1b; --failbg:rgba(220,38,38,.1);
  --warn:#92400e; --warnbg:rgba(245,158,11,.14);
  --accent:#1e40af;
}
@media (prefers-color-scheme:dark){
  :root{
    --page:#0b0f14;
    --ink:#e5e9f0; --muted:#94a3b8;
    --glass:rgba(23,31,42,.6); --stroke:rgba(148,163,184,.18);
    --code:rgba(226,232,240,.06); --shadow:0 20px 48px -28px rgba(0,0,0,.85);
    --ok:#5eead4; --okbg:rgba(13,148,136,.16);
    --fail:#fca5a5; --failbg:rgba(239,68,68,.14);
    --warn:#fcd34d; --warnbg:rgba(245,158,11,.14);
    --accent:#93b4f5;
  }
}
*{box-sizing:border-box}
body{
  margin:0; min-height:100vh; color:var(--ink); background:var(--page);
  font:15px/1.65 ui-sans-serif,-apple-system,"Segoe UI",Inter,system-ui,sans-serif;
  background-image:
    radial-gradient(50vw 50vw at 6% 0%, #d6dfeb 0%, transparent 62%),
    radial-gradient(44vw 44vw at 96% 6%, #e4e9f1 0%, transparent 64%),
    radial-gradient(54vw 54vw at 32% 88%, #dbe3ed 0%, transparent 62%),
    radial-gradient(46vw 46vw at 92% 96%, #e9edf3 0%, transparent 64%);
  background-attachment:fixed;
}
@media (prefers-color-scheme:dark){
  body{background-image:
    radial-gradient(50vw 50vw at 6% 0%, #1a2432 0%, transparent 62%),
    radial-gradient(44vw 44vw at 96% 6%, #141c28 0%, transparent 64%),
    radial-gradient(54vw 54vw at 32% 88%, #16202c 0%, transparent 62%),
    radial-gradient(46vw 46vw at 92% 96%, #101822 0%, transparent 64%);}
}
.wrap{max-width:1040px;margin:0 auto;padding:44px 20px 72px}
.card{
  background:var(--glass); border:1px solid var(--stroke); border-radius:20px;
  -webkit-backdrop-filter:blur(20px) saturate(180%); backdrop-filter:blur(20px) saturate(180%);
  box-shadow:var(--shadow), inset 0 1px 0 rgba(255,255,255,.25);
  padding:22px 24px; margin:0 0 18px;
}
.kicker{margin:0 0 6px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:600}
h1{margin:0 0 4px;font-size:26px;line-height:1.25;letter-spacing:-.02em}
.sub{margin:0 0 18px;color:var(--muted);font-size:14px}
dl.meta{display:grid;grid-template-columns:auto 1fr;gap:8px 18px;margin:0 0 18px;font-size:13.5px}
dl.meta dt{color:var(--muted);font-weight:600}
dl.meta dd{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;word-break:break-all}
.stats{display:flex;flex-wrap:wrap;gap:8px}
.chip{font-size:12px;font-weight:600;padding:4px 11px;border-radius:999px;border:1px solid var(--stroke);background:var(--code)}
.chip.ok{color:var(--ok);background:var(--okbg)}
.chip.fail{color:var(--fail);background:var(--failbg)}
.entry{position:relative;overflow:hidden}
.entry::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--ok);opacity:.75}
.entry.fail::before{background:var(--fail)}
.entry[data-status=unconfirmed]::before{background:var(--warn)}
.entry.prompt::before{background:var(--accent)}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:14px;font-size:12.5px;color:var(--muted)}
.pill{font-weight:700;padding:3px 10px;border-radius:999px;font-size:11.5px;letter-spacing:.02em}
.pill.ok{color:var(--ok);background:var(--okbg)}
.pill.fail{color:var(--fail);background:var(--failbg)}
.pill.unk{color:var(--warn);background:var(--warnbg)}
.pill.prompt{color:var(--accent);background:var(--code)}
.sep{opacity:.4}
.id{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:2px 8px;border-radius:8px;background:var(--code)}
.lbl{margin:0 0 6px;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700}
pre{
  margin:0 0 14px;padding:14px 16px;border-radius:14px;overflow:auto;
  background:var(--code); border:1px solid var(--stroke);
  font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
}
pre:last-child{margin-bottom:0}
pre.cmd{white-space:pre-wrap;word-break:break-word;border-left:3px solid var(--accent)}
pre.out{max-height:520px}
.empty{color:var(--muted);font-style:italic}
footer{color:var(--muted);font-size:12px;text-align:center;margin-top:28px}
`

export function skeleton(session) {
  const starts = parts(session.started, session.timezone)
  const tz = zoneName(session.timezone, session.started)
  const title = session.title || session.directory.split("/").filter(Boolean).pop() || session.id

  return `<!doctype html>
<html lang="en" data-tz="${esc(session.timezone)}" data-schema="${SCHEMA}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Session Ledger · ${esc(session.id)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header class="card">
<p class="kicker">Session Ledger</p>
<h1>${esc(title)}</h1>
<p class="sub">${esc(session.harness)}${session.version ? ` ${esc(session.version)}` : ""} · append-only command record</p>
<dl class="meta">
<dt>Session</dt><dd>${esc(session.id)}</dd>
<dt>Directory</dt><dd>${esc(session.directory)}</dd>
<dt>Started</dt><dd>${esc(`${starts.date} ${starts.time} ${tz}`)}</dd>
<dt>Timezone</dt><dd>${esc(`${session.timezone} · ${zoneOffset(session.timezone, session.started)}`)}</dd>
<dt>Format</dt><dd>session-ledger ${VERSION} · schema ${SCHEMA}</dd>
</dl>
<div class="stats">${STATS_START}<span class="chip">0 commands</span>${STATS_END}</div>
</header>
<main>
${ENTRIES_MARK}
</main>
<footer>generated by session-ledger ${VERSION} · timestamps in ${esc(zoneName(session.timezone, session.started))}</footer>
</div>
</body>
</html>
`
}

export function card(e, session) {
  const failed = e.status === "failed"
  const unconfirmed = e.status === "unconfirmed"
  const at = parts(e.at, session.timezone)
  const tz = zoneName(session.timezone, e.at)
  const elsewhere = e.cwd && e.cwd !== session.directory
  const kind = e.kind ?? "command"
  const label = kind === "prompt" ? "prompt" : kind === "tool" ? e.tool ?? "tool" : "command"

  const output = unconfirmed
    ? `<p class="empty">no result reported by the harness — the turn ended before this call finished</p>`
    : e.output.trim() === ""
      ? `<p class="empty">(no output)</p>`
      : `<pre class="out"><code>${esc(e.output.replace(/\n+$/, ""))}</code></pre>`
  const note = e.truncated > 0 ? `<p class="empty">… ${e.truncated.toLocaleString("en-US")} characters truncated</p>` : ""

  const body =
    kind === "prompt"
      ? `<p class="lbl">prompt</p>
<pre class="cmd prompt"><code>${esc((e.prompt ?? "").replace(/\n+$/, ""))}</code></pre>${note}`
      : `<p class="lbl">${kind === "tool" ? "input" : "command"}</p>
<pre class="cmd"><code>${esc(kind === "tool" ? e.input ?? "(no input)" : e.command)}</code></pre>
<p class="lbl">output</p>
${output}${note}`

  const pill =
    kind === "prompt"
      ? `<span class="pill prompt">💬 prompt</span>`
      : unconfirmed
        ? `<span class="pill unk">⚠ unconfirmed</span>`
        : `<span class="pill ${failed ? "fail" : "ok"}">${failed ? "✕ failed" : "✓ completed"}</span>`

  return `<section class="card entry${failed ? " fail" : ""}${kind === "prompt" ? " prompt" : ""}" data-kind="${kind}" data-status="${e.status}" id="e-${esc(e.id)}">
<div class="row">
${pill}
<span>${esc(at.time)} ${esc(tz)}</span>
<span class="sep">·</span><span>${esc(duration(e.durationMs))}</span>
${kind === "tool" ? `<span class="sep">·</span><span>🛠 ${esc(label)}</span>` : ""}
${elsewhere ? `<span class="sep">·</span><span>${esc(e.cwd)}</span>` : ""}
<code class="id">${esc(e.id)}</code>
</div>
${body}
</section>
`
}

export function stats(html) {
  const count = (kind) => (html.match(new RegExp(`data-kind="${kind}"`, "g")) ?? []).length
  const commands = count("command")
  const tools = count("tool")
  const prompts = count("prompt")
  const failed = (html.match(/data-status="failed"/g) ?? []).length
  const unconfirmed = (html.match(/data-status="unconfirmed"/g) ?? []).length
  const total = commands + tools + prompts
  return [
    `<span class="chip">${total} event${total === 1 ? "" : "s"}</span>`,
    prompts > 0 ? `<span class="chip">${prompts} prompt${prompts === 1 ? "" : "s"}</span>` : "",
    commands > 0 ? `<span class="chip ok">${commands} command${commands === 1 ? "" : "s"}</span>` : "",
    tools > 0 ? `<span class="chip">${tools} tool call${tools === 1 ? "" : "s"}</span>` : "",
    failed > 0 ? `<span class="chip fail">${failed} failed</span>` : "",
    unconfirmed > 0 ? `<span class="chip">${unconfirmed} unconfirmed</span>` : "",
  ]
    .filter(Boolean)
    .join("")
}
