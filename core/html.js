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
  --page:#f5f5f7; --wash:#ffffff;
  --card:#fff; --cardhi:#fff;
  --hair:rgba(0,0,0,.08); --soft:#f2f2f5;
  --ink:#1d1d1f; --muted:#6e6e73;
  --glow:rgba(0,113,227,.10);
  --accent:#0071e3; --accentbg:rgba(0,113,227,.06); --accentline:rgba(0,113,227,.22);
  --ok:#1f8f4e; --okbg:rgba(52,199,89,.14);
  --fail:#d70015; --failbg:rgba(255,59,48,.09); --failline:rgba(215,0,21,.20);
  --warn:#b25000; --warnbg:rgba(255,159,10,.11); --warnline:rgba(178,80,0,.20);
  --shadow:0 1px 2px rgba(0,0,0,.04), 0 12px 32px -20px rgba(0,0,0,.18);
  --shadow-hi:0 1px 2px rgba(0,0,0,.05), 0 20px 44px -22px rgba(0,0,0,.24);
  --term:#12161c; --termink:#e7edf6; --termline:#252b34; --termmute:#8d97a5;
  --chrome:#1e242c; --chromemute:#9aa5b4;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  --sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",Inter,"Segoe UI",system-ui,sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --page:#08080a; --wash:#101014;
    --card:#161617; --cardhi:#1b1b1d;
    --hair:rgba(255,255,255,.09); --soft:#1d1d1f;
    --ink:#f5f5f7; --muted:#98989d;
    --glow:rgba(41,151,255,.16);
    --accent:#2997ff; --accentbg:rgba(41,151,255,.13); --accentline:rgba(41,151,255,.32);
    --ok:#30d158; --okbg:rgba(48,209,88,.16);
    --fail:#ff453a; --failbg:rgba(255,69,58,.12); --failline:rgba(255,69,58,.30);
    --warn:#ff9f0a; --warnbg:rgba(255,159,10,.10); --warnline:rgba(255,159,10,.28);
    --shadow:0 1px 2px rgba(0,0,0,.6), 0 12px 32px -20px rgba(0,0,0,.9);
    --shadow-hi:0 1px 2px rgba(0,0,0,.65), 0 20px 44px -22px rgba(0,0,0,.95);
    --term:#0c1016; --termink:#e7edf6; --termline:#252b34; --termmute:#8b94a2;
    --chrome:#1a212a; --chromemute:#8f9aa9;
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{
  margin:0;min-height:100vh;background:var(--page);color:var(--ink);
  font:15px/1.7 var(--sans);
  background-image:radial-gradient(1100px 520px at 50% -12%, var(--wash) 0%, rgba(255,255,255,0) 62%);
  background-repeat:no-repeat;
}
::selection{background:rgba(0,113,227,.18)}
.wrap{max-width:900px;margin:0 auto;padding:56px 22px 96px}
.card{background:var(--card);border:1px solid var(--hair);border-radius:18px;box-shadow:var(--shadow);margin:0 0 18px}
header.card{position:relative;overflow:hidden;padding:36px 34px 28px;background:linear-gradient(180deg,var(--cardhi),var(--card))}
header.card::before{content:"";position:absolute;inset:-120px -10% auto;height:320px;background:radial-gradient(48% 100% at 50% 0%,var(--glow),rgba(255,255,255,0) 72%);pointer-events:none}
header.card>*{position:relative}
.kicker{margin:0 0 10px;font:600 11px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.kicker::before{content:"";display:inline-block;width:6px;height:6px;margin-right:9px;border-radius:50%;background:var(--accent);vertical-align:1px}
h1{margin:0;font-size:31px;line-height:1.16;font-weight:600;letter-spacing:-.028em}
.sub{margin:10px 0 0;color:var(--muted);font:13px/1.55 var(--mono);letter-spacing:-.01em}
dl.meta{display:grid;grid-template-columns:max-content 1fr;gap:9px 22px;margin:24px 0 0;padding:16px 18px;background:var(--soft);border:1px solid var(--hair);border-radius:13px}
dl.meta dt{font:600 10px/2 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
dl.meta dd{margin:0;font:12px/1.7 var(--mono);word-break:break-all}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0}
.chip{font:500 12px/1 var(--sans);padding:7px 13px;border-radius:999px;border:1px solid var(--hair);background:var(--soft);color:var(--muted)}
.chip.ok{color:var(--ok);background:var(--okbg);border-color:transparent}
.chip.fail{color:var(--fail);background:var(--failbg);border-color:transparent}
.entry{position:relative;overflow:hidden;padding:0 26px 22px;transition:box-shadow .22s ease,transform .22s ease}
.entry:hover{box-shadow:var(--shadow-hi)}
.entry[data-status=failed]{border-color:var(--failline)}
.entry[data-status=unconfirmed]{border-color:var(--warnline)}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 -26px 20px;padding:13px 26px;background:var(--soft);border-bottom:1px solid var(--hair);font:12px/1.5 var(--mono);color:var(--muted)}
.entry[data-status=failed] .row{background:linear-gradient(90deg,var(--failbg),transparent 58%),var(--soft)}
.pill{font:600 10.5px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;padding:5px 10px;border-radius:999px}
.pill.ok{color:var(--ok);background:var(--okbg)}
.pill.fail{color:var(--fail);background:var(--failbg)}
.pill.unk{color:var(--warn);background:var(--warnbg)}
.pill.prompt{color:var(--accent);background:var(--accentbg)}
.sep{opacity:.35}
.id{margin-left:auto;font:10.5px/1 var(--mono);color:var(--muted);padding:3px 8px;border-radius:7px;background:var(--card);border:1px solid var(--hair)}
.lbl{
  position:relative;margin:0;padding:9px 14px 9px 68px;border-radius:12px 12px 0 0;
  background:var(--chrome);border:1px solid var(--termline);border-bottom:0;
  font:600 10.5px/1.35 var(--mono);letter-spacing:.13em;text-transform:uppercase;color:var(--chromemute);
}
.lbl::before{
  content:"";position:absolute;left:14px;top:50%;width:9px;height:9px;margin-top:-4.5px;border-radius:50%;
  background:#ff5f57;box-shadow:15px 0 0 #febc2e,30px 0 0 #28c840;
}
pre{
  margin:0;padding:14px 16px;overflow:auto;
  background:var(--term);color:var(--termink);border:1px solid var(--termline);
  font:12.5px/1.62 var(--mono);tab-size:2;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent;
}
pre::-webkit-scrollbar{height:10px;width:10px}
pre::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:8px}
.lbl + pre{border-radius:0 0 12px 12px;border-top:0}
pre.out{max-height:560px}
pre + .lbl{margin-top:18px}
pre.cmd{white-space:pre-wrap;word-break:break-word}
.entry[data-kind=prompt] .lbl{display:none}
/* A prompt has no duration; the separators around it would be noise. */
.entry[data-kind=prompt] .row>span:nth-of-type(3),.entry[data-kind=prompt] .row>span:nth-of-type(4){display:none}
.entry[data-kind=prompt] pre{
  background:var(--accentbg);color:var(--ink);border:1px solid var(--accentline);border-left:3px solid var(--accent);
  border-radius:12px;padding:16px 18px;font:15px/1.7 var(--sans);white-space:pre-wrap;word-break:break-word;
}
.empty{margin:14px 0 0;color:var(--muted);font:italic 12.5px/1.6 var(--sans)}
.lbl + .empty{
  margin:0;padding:15px 16px;border-radius:0 0 12px 12px;border:1px solid var(--termline);border-top:0;
  background:var(--term);color:var(--termmute);font:italic 12.5px/1.6 var(--mono);
}
.entry[data-kind=prompt] .empty{margin-top:10px}
footer{margin:34px 0 0;color:var(--muted);font:12px/1.6 var(--sans);text-align:center;letter-spacing:.01em}
@media (max-width:680px){
  .wrap{padding:26px 13px 64px}
  header.card{padding:26px 20px 22px;border-radius:16px}
  h1{font-size:23px}
  dl.meta{grid-template-columns:1fr;gap:2px;padding:14px}
  dl.meta dd{margin-bottom:8px}
  .entry{padding:0 15px 18px;border-radius:15px}
  .row{margin:0 -15px 16px;padding:11px 15px}
  .lbl{padding-left:62px;font-size:10px}
  .entry[data-kind=prompt] pre{font-size:14px}
  pre{font-size:12px}
}
@media (prefers-reduced-motion:reduce){
  .entry{transition:none}
  .entry:hover{box-shadow:var(--shadow)}
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
<meta name="color-scheme" content="light dark">
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
      ? `<pre class="cmd prompt"><code>${esc((e.prompt ?? "").replace(/\n+$/, ""))}</code></pre>${note}`
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
