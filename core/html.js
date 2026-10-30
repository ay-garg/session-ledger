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
  --page:#e7ecff;
  --ink:#0f172a; --muted:#475569;
  --glass:rgba(255,255,255,.42); --stroke:rgba(255,255,255,.7);
  --code:rgba(15,23,42,.06); --shadow:0 22px 60px -24px rgba(15,23,42,.5);
  --ok:#047857; --okbg:rgba(16,185,129,.18);
  --fail:#b91c1c; --failbg:rgba(239,68,68,.18);
  --accent:#4f46e5;
}
@media (prefers-color-scheme:dark){
  :root{
    --page:#080c18;
    --ink:#e6ecf7; --muted:#93a1b8;
    --glass:rgba(30,41,59,.42); --stroke:rgba(148,163,184,.24);
    --code:rgba(226,232,240,.07); --shadow:0 22px 60px -24px rgba(0,0,0,.9);
    --ok:#6ee7b7; --okbg:rgba(16,185,129,.15);
    --fail:#fca5a5; --failbg:rgba(239,68,68,.16);
    --accent:#a5b4fc;
  }
}
*{box-sizing:border-box}
body{
  margin:0; min-height:100vh; color:var(--ink); background:var(--page);
  font:15px/1.65 ui-sans-serif,-apple-system,"Segoe UI",Inter,system-ui,sans-serif;
  background-image:
    radial-gradient(42vw 42vw at 6% 4%, #818cf8 0%, transparent 62%),
    radial-gradient(38vw 38vw at 92% 14%, #f472b6 0%, transparent 60%),
    radial-gradient(46vw 46vw at 30% 78%, #34d399 0%, transparent 62%),
    radial-gradient(40vw 40vw at 88% 92%, #38bdf8 0%, transparent 62%);
  background-attachment:fixed;
}
@media (prefers-color-scheme:dark){
  body{background-image:
    radial-gradient(42vw 42vw at 6% 4%, #4f46e5 0%, transparent 62%),
    radial-gradient(38vw 38vw at 92% 14%, #a21caf 0%, transparent 60%),
    radial-gradient(46vw 46vw at 30% 78%, #0f766e 0%, transparent 62%),
    radial-gradient(40vw 40vw at 88% 92%, #1d4ed8 0%, transparent 62%);}
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
.entry.prompt::before{background:var(--accent)}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:14px;font-size:12.5px;color:var(--muted)}
.pill{font-weight:700;padding:3px 10px;border-radius:999px;font-size:11.5px;letter-spacing:.02em}
.pill.ok{color:var(--ok);background:var(--okbg)}
.pill.fail{color:var(--fail);background:var(--failbg)}
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
  const at = parts(e.at, session.timezone)
  const tz = zoneName(session.timezone, e.at)
  const elsewhere = e.cwd && e.cwd !== session.directory
  const kind = e.kind ?? "command"
  const label = kind === "prompt" ? "prompt" : kind === "tool" ? e.tool ?? "tool" : "command"

  const output =
    e.output.trim() === "" ? `<p class="empty">(no output)</p>` : `<pre class="out"><code>${esc(e.output.replace(/\n+$/, ""))}</code></pre>`
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
      : `<span class="pill ${failed ? "fail" : "ok"}">${failed ? "✕ failed" : "✓ completed"}</span>`

  return `<section class="card entry${failed ? " fail" : ""}${kind === "prompt" ? " prompt" : ""}" data-kind="${kind}" data-status="${failed ? "failed" : "completed"}" id="e-${esc(e.id)}">
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
  const total = commands + tools + prompts
  return [
    `<span class="chip">${total} event${total === 1 ? "" : "s"}</span>`,
    prompts > 0 ? `<span class="chip">${prompts} prompt${prompts === 1 ? "" : "s"}</span>` : "",
    commands > 0 ? `<span class="chip ok">${commands} command${commands === 1 ? "" : "s"}</span>` : "",
    tools > 0 ? `<span class="chip">${tools} tool call${tools === 1 ? "" : "s"}</span>` : "",
    failed > 0 ? `<span class="chip fail">${failed} failed</span>` : "",
  ]
    .filter(Boolean)
    .join("")
}
