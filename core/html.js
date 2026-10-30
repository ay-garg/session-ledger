import { SCHEMA, VERSION, duration, parts, zoneName, zoneOffset } from "./ledger.js"

// Companion view. Markdown is the record; this is the readable one: a self-contained
// page, no JS, no network. The DOM is deliberately plain — a `render` pass can swap
// the stylesheet of pages written by an older version without touching the entries.

export const ENTRIES_MARK = "<!-- session-ledger:entries -->"
export const STATS_START = "<!-- session-ledger:stats:start -->"
export const STATS_END = "<!-- session-ledger:stats:end -->"

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

export const CSS = `
:root{
  color-scheme:light dark;
  --page:#f6f7f9; --grid:rgba(15,23,42,.045);
  --card:#fff; --stroke:#e4e8ef; --soft:#eef1f6;
  --ink:#0f172a; --muted:#59636f;
  --code:#101820; --codeink:#dce5ef; --codestroke:#1d2937;
  --ok:#0b6b4f; --okbg:rgba(16,185,129,.13); --okdot:#12b886;
  --fail:#b42318; --failbg:rgba(239,68,68,.13); --faildot:#ef4444;
  --warn:#8a5a00; --warnbg:rgba(245,158,11,.18); --warndot:#f0a020;
  --accent:#1d4ed8; --accentbg:rgba(37,99,235,.08); --accentdot:#3b82f6;
  --shadow:0 1px 2px rgba(15,23,42,.05), 0 18px 40px -32px rgba(15,23,42,.45);
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --sans:ui-sans-serif,-apple-system,"Segoe UI",Inter,system-ui,sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --page:#0b0f14; --grid:rgba(148,163,184,.065);
    --card:#111820; --stroke:#222c3a; --soft:#18212c;
    --ink:#e6edf5; --muted:#93a1b3;
    --code:#070b10; --codeink:#dce5ef; --codestroke:#1c2634;
    --ok:#34d399; --okbg:rgba(16,185,129,.14); --okdot:#10b981;
    --fail:#f87171; --failbg:rgba(239,68,68,.14); --faildot:#ef4444;
    --warn:#fbbf24; --warnbg:rgba(245,158,11,.16); --warndot:#f59e0b;
    --accent:#93b4f5; --accentbg:rgba(59,130,246,.14); --accentdot:#60a5fa;
    --shadow:0 1px 2px rgba(0,0,0,.55), 0 18px 40px -30px rgba(0,0,0,.9);
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;min-height:100vh;background:var(--page);color:var(--ink);
  font:15px/1.65 var(--sans);
  background-image:
    linear-gradient(var(--grid) 1px,transparent 1px),
    linear-gradient(90deg,var(--grid) 1px,transparent 1px);
  background-size:36px 36px;
}
.wrap{max-width:980px;margin:0 auto;padding:44px 20px 72px}
.card{background:var(--card);border:1px solid var(--stroke);border-radius:12px;box-shadow:var(--shadow);margin:0 0 16px}
header.card{position:relative;overflow:hidden;padding:26px 24px 22px}
header.card::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,var(--accentdot),rgba(59,130,246,0) 58%)}
.kicker{margin:0 0 8px;font:600 10.5px/1.4 var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
h1{margin:0 0 6px;font-size:25px;line-height:1.25;font-weight:650;letter-spacing:-.015em}
.sub{margin:0;color:var(--muted);font:12.5px/1.6 var(--mono)}
dl.meta{display:grid;grid-template-columns:max-content 1fr;gap:9px 20px;margin:18px 0;padding:15px 0;border-top:1px solid var(--soft);border-bottom:1px solid var(--soft)}
dl.meta dt{font:600 10px/1.9 var(--mono);letter-spacing:.13em;text-transform:uppercase;color:var(--muted)}
dl.meta dd{margin:0;font:12px/1.6 var(--mono);word-break:break-all}
.stats{display:flex;flex-wrap:wrap;gap:7px}
.chip{font:600 10.5px/1 var(--mono);letter-spacing:.05em;text-transform:uppercase;padding:6px 10px;border-radius:6px;border:1px solid var(--stroke);background:var(--soft);color:var(--muted)}
.chip.ok{color:var(--ok);background:var(--okbg);border-color:transparent}
.chip.fail{color:var(--fail);background:var(--failbg);border-color:transparent}
.entry{position:relative;overflow:hidden;padding:0 22px 18px}
.entry::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--okdot)}
.entry.fail::before{background:var(--faildot)}
.entry[data-status=unconfirmed]::before{background:var(--warndot)}
.entry.prompt::before{background:var(--accentdot)}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 -22px 16px;padding:11px 22px;border-bottom:1px solid var(--soft);background:var(--soft);font:11.5px/1.5 var(--mono);color:var(--muted)}
.pill{font:700 10px/1 var(--mono);letter-spacing:.09em;text-transform:uppercase;padding:5px 9px;border-radius:5px}
.pill.ok{color:var(--ok);background:var(--okbg)}
.pill.fail{color:var(--fail);background:var(--failbg)}
.pill.unk{color:var(--warn);background:var(--warnbg)}
.pill.prompt{color:var(--accent);background:var(--accentbg)}
.sep{opacity:.35}
.id{margin-left:auto;font:10.5px/1 var(--mono);color:var(--muted);padding:3px 7px;border-radius:5px;background:var(--card);border:1px solid var(--stroke)}
.lbl{margin:0 0 6px;font:700 10px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
pre{
  margin:0 0 14px;padding:13px 15px;border-radius:8px;overflow:auto;
  background:var(--code);color:var(--codeink);border:1px solid var(--codestroke);
  font:12.5px/1.62 var(--mono);tab-size:2;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent;
}
pre::-webkit-scrollbar{height:10px;width:10px}
pre::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:8px}
pre.cmd{white-space:pre-wrap;word-break:break-word;border-left:3px solid var(--accentdot)}
pre.out{max-height:560px}
pre.prompt{background:var(--accentbg);color:var(--ink);border-color:transparent;border-left:3px solid var(--accentdot);font:14px/1.62 var(--sans);white-space:pre-wrap;word-break:break-word}
pre:last-child{margin-bottom:0}
.empty{margin:0 0 14px;padding:10px 14px;border:1px dashed var(--stroke);border-radius:8px;color:var(--muted);font-size:13px;font-style:italic}
footer{margin:30px 0 0;padding-top:16px;border-top:1px solid var(--stroke);color:var(--muted);font:11px/1.6 var(--mono);text-align:center;letter-spacing:.03em}
@media (max-width:640px){
  .wrap{padding:22px 12px 48px}
  header.card{padding:20px 24px 18px}
  h1{font-size:21px}
  dl.meta{grid-template-columns:1fr;gap:2px}
  dl.meta dd{margin-bottom:9px}
  .entry{padding:0 16px 16px}
  .row{margin:0 -16px 14px;padding:10px 16px}
  pre{font-size:12px}
}
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
<p class="sub">${esc(session.harness)}${session.version ? ` ${esc(session.version)}` : ""} · append-only record of prompts, commands and tool calls</p>
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
