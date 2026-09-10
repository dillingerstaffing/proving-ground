/* ================= RISC-V LAB (shared module) =================
   The RISC-V Playground lab, extracted from the Proving Ground bench
   bundle (formerly Bench 08) into one shared file, so the lab and the
   standalone riscv-playground site stay in sync with zero manual sync.

   Usage:
     <script src="riscv-lab.js"></script>
     RiscvLab.mount(document.getElementById("lab"), { chrome: "page" });

   chrome "overlay": dialog over the host page (Proving Ground; the
   launcher button is owned by the PG adapter in features.js).
   chrome "page": the lab renders inline in the given host element,
   no overlay, no close button (standalone riscv-playground site).

   Needs the RV32I core globals (rvcore.js: rvAssemble, rvCpu, rvStep,
   rvRun, rvDis, RV_REGNAMES) and the curriculum data (rvdata.js:
   RV_LESSONS, RV_CHALLENGES, RV_ISAREF), plus the PG design tokens
   (--ember, --panel, --paper, --steel, --ink, --mint, --bad, --amber,
   --ice, --font-m) on the host page.

   BENCH LOGIC IS FROZEN: assembler, interpreter, lessons, trials, and
   grading are untouched by this extraction. Only the mount/entry
   changed. */

(function () {
  "use strict";

  var RV_CSS = [
    ".rv-overlay{position:fixed;inset:0;z-index:9995;background:rgba(5,8,10,.94);display:none;}",
    ".rv-overlay.open{display:flex;}",
    ".rv-panel{flex:1;min-height:0;width:100%;max-width:1200px;margin:0 auto;display:flex;flex-direction:column;background:#0a0c0e;border:1px solid rgba(242,237,227,.14);}",
    "@media(min-width:700px){.rv-panel{border-radius:4px;overflow:hidden;}}",
    ".rv-bar{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid rgba(242,237,227,.13);flex:none;flex-wrap:wrap;background:var(--panel);}",
    ".rv-title{font-family:\"Space Grotesk\",system-ui,sans-serif;font-size:14px;font-weight:600;letter-spacing:.12em;color:var(--paper);white-space:nowrap;}",
    ".rv-title .rv-num{font-family:\"IBM Plex Mono\",monospace;font-size:11px;color:var(--steel);letter-spacing:.2em;margin-right:10px;font-weight:400;}",
    ".rv-tabs{display:flex;gap:2px;flex:1;flex-wrap:wrap;background:var(--ink);border:1px solid rgba(242,237,227,.1);border-radius:4px;padding:3px;min-width:200px;}",
    ".rv-tab{font-family:\"Space Grotesk\",system-ui,sans-serif;font-size:11.5px;font-weight:600;letter-spacing:.1em;padding:12px 16px;min-height:44px;border:0;background:none;color:var(--steel);cursor:pointer;border-radius:4px;}",
    ".rv-tab.on{color:var(--paper);background:var(--panel);}",
    ".rv-tab:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
    ".rv-close{font-family:\"Space Grotesk\",system-ui,sans-serif;font-size:12px;font-weight:600;letter-spacing:.1em;min-height:44px;padding:10px 18px;border-radius:4px;border:1px solid rgba(242,237,227,.22);background:transparent;color:var(--paper);cursor:pointer;}",
    ".rv-close:hover{border-color:var(--ember);color:var(--ember);}.rv-close:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
    ".rv-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;}",
    "@media(min-width:700px){.rv-body{padding:22px;}}",
    ".rv-toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;align-items:center;}",
    ".rv-tgroup{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}",
    ".rv-tsep{width:1px;height:28px;background:rgba(242,237,227,.14);margin:0 4px;}",
    ".rv-btn{font-family:\"Space Grotesk\",system-ui,sans-serif;font-size:12px;font-weight:600;letter-spacing:.1em;min-height:48px;padding:12px 20px;border-radius:4px;border:1px solid rgba(242,237,227,.2);background:transparent;color:var(--steel);cursor:pointer;}",
    ".rv-btn:hover{border-color:rgba(242,237,227,.45);color:var(--paper);}",
    ".rv-btn:active{transform:scale(.97);}",
    ".rv-btn:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
    ".rv-btn.pri{background:var(--ember);border-color:var(--ember);color:#0a0c0e;}",
    ".rv-btn.pri:hover{background:var(--ember);border-color:var(--ember);color:#0a0c0e;}",
    ".rv-btn.sec{background:var(--panel);border-color:var(--panel);color:var(--paper);}",
    ".rv-btn.sec:hover{background:var(--panel);border-color:var(--panel);color:var(--paper);}",
    ".rv-btn:disabled{opacity:.4;cursor:default;}",
    ".rv-status{font-family:\"IBM Plex Mono\",monospace;font-size:12.5px;letter-spacing:.02em;color:var(--steel);margin:0 0 14px;min-height:18px;line-height:1.6;}",
    ".rv-status.ok{color:var(--mint);}",
    ".rv-status.err{color:var(--bad);}",
    ".rv-grid{display:grid;grid-template-columns:1fr;gap:14px;}",
    "@media(min-width:960px){.rv-grid{grid-template-columns:1.15fr .85fr;}}",
    ".rv-edwrap{display:flex;background:var(--ink);border:1px solid rgba(242,237,227,.16);border-radius:4px;overflow:hidden;}",
    ".rv-edwrap:focus-within{border-color:rgba(255,90,31,.55);box-shadow:0 0 0 2px rgba(255,90,31,.18);}",
    ".rv-gutter{flex:none;width:48px;padding:14px 10px 14px 0;text-align:right;font-family:\"IBM Plex Mono\",monospace;font-size:13px;line-height:1.7;color:var(--steel);border-right:1px solid rgba(242,237,227,.08);overflow:hidden;user-select:none;background:#080b0d;white-space:pre;}",
    ".rv-gutter .cur{color:var(--ember);font-weight:600;}",
    ".rv-ed{flex:1;min-width:0;min-height:340px;background:transparent;border:0;color:var(--paper);font-family:\"IBM Plex Mono\",monospace;font-size:13px;line-height:1.7;padding:14px 14px 14px 12px;resize:vertical;tab-size:4;}",
    ".rv-ed:focus{outline:none;}",
    ".rv-pane{border:1px solid rgba(242,237,227,.12);border-radius:4px;background:var(--panel);overflow:hidden;}",
    ".rv-pane h4{margin:0;padding:12px 16px;font-family:\"Space Grotesk\",system-ui,sans-serif;font-size:11px;letter-spacing:.18em;color:var(--steel);border-bottom:1px solid rgba(242,237,227,.09);font-weight:600;}",
    ".rv-regs{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:rgba(242,237,227,.06);max-height:336px;overflow-y:auto;}",
    "@media(min-width:520px){.rv-regs{grid-template-columns:repeat(4,1fr);}}",
    ".rv-reg{background:var(--panel);padding:10px 12px;font-family:\"IBM Plex Mono\",monospace;font-variant-numeric:tabular-nums;}",
    ".rv-reg .rn{color:var(--steel);display:block;font-size:10px;letter-spacing:.08em;margin-bottom:3px;}",
    ".rv-reg .rv{color:var(--paper);font-size:12.5px;word-break:break-all;}",
    ".rv-reg.chg .rv{color:var(--amber);font-weight:600;}",
    ".rv-reg.chg{background:rgba(255,190,77,.06);}",
    ".rv-con{font-family:\"IBM Plex Mono\",monospace;font-size:12.5px;color:var(--mint);white-space:pre-wrap;word-break:break-word;padding:14px 16px;min-height:72px;max-height:200px;overflow-y:auto;background:var(--ink);line-height:1.7;}",
    ".rv-mc{font-family:\"IBM Plex Mono\",monospace;font-size:12px;max-height:280px;overflow-y:auto;font-variant-numeric:tabular-nums;}",
    ".rv-mc .mrow{display:flex;gap:12px;padding:6px 16px;border-bottom:1px solid rgba(242,237,227,.05);}",
    ".rv-mc .ma{color:var(--steel);flex:none;width:70px;}",
    ".rv-mc .mw{color:var(--ice);flex:none;width:84px;}",
    ".rv-mc .md{color:var(--steel);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".rv-mc .mrow.cur{background:rgba(255,90,31,.1);}",
    ".rv-mc .mrow.cur .md{color:var(--ember);font-weight:600;}",
    ".rv-cards{display:grid;grid-template-columns:1fr;gap:12px;}",
    "@media(min-width:700px){.rv-cards{grid-template-columns:1fr 1fr;}}",
    ".rv-card{border:1px solid rgba(242,237,227,.12);border-radius:4px;padding:18px;background:var(--panel);}",
    ".rv-card h5{margin:0 0 10px;font-size:15px;font-weight:600;color:var(--paper);font-family:\"Space Grotesk\",system-ui,sans-serif;letter-spacing:-.01em;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
    ".rv-card .bd{font-size:13.5px;color:var(--steel);line-height:1.65;margin:0 0 14px;font-family:\"Space Grotesk\",system-ui,sans-serif;}",
    ".rv-card .bd code{color:var(--amber);font-family:\"IBM Plex Mono\",monospace;font-size:12px;}",
    ".rv-card .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}",
    ".rv-mini{font-family:\"Space Grotesk\",system-ui,sans-serif;font-size:11.5px;font-weight:600;letter-spacing:.08em;min-height:44px;padding:10px 16px;border-radius:4px;border:1px solid rgba(242,237,227,.2);background:transparent;color:var(--steel);cursor:pointer;}",
    ".rv-mini:hover{border-color:rgba(242,237,227,.45);color:var(--paper);}",
    ".rv-mini.go{background:var(--ember);border-color:var(--ember);color:#0a0c0e;}",
    ".rv-mini.go:hover{background:var(--ember);border-color:var(--ember);color:#0a0c0e;}.rv-mini:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
    ".rv-hint{display:none;font-size:13px;color:var(--ice);margin:12px 0 0;line-height:1.65;font-family:\"Space Grotesk\",system-ui,sans-serif;}",
    ".rv-hint.show{display:block;}",
    ".rv-res{font-family:\"IBM Plex Mono\",monospace;font-size:12px;margin:12px 0 0;line-height:1.7;}",
    ".rv-done{color:var(--mint);font-weight:600;font-size:11px;letter-spacing:.14em;}",
    ".rv-diff{font-size:10px;font-weight:600;letter-spacing:.16em;}",
    ".rv-diff.easy{color:var(--mint);}",
    ".rv-diff.med{color:var(--amber);}",
    ".rv-isa{width:100%;border-collapse:collapse;font-family:\"IBM Plex Mono\",monospace;font-size:12.5px;}",
    ".rv-isa td{padding:9px 12px;border-bottom:1px solid rgba(242,237,227,.07);vertical-align:top;line-height:1.6;}",
    ".rv-isa td:first-child{color:var(--amber);white-space:nowrap;}",
    ".rv-isa td:last-child{color:var(--steel);}",
    ".rv-win{border:1px solid rgba(125,224,168,.4);background:rgba(125,224,168,.06);border-radius:4px;padding:16px 18px;margin-bottom:14px;font-family:\"Space Grotesk\",system-ui,sans-serif;color:var(--mint);font-size:13.5px;letter-spacing:.02em;line-height:1.65;}",
    ".rv-lesson-banner{border:1px solid rgba(242,237,227,.14);background:var(--panel);border-radius:4px;padding:14px 16px;margin-bottom:14px;font-size:13.5px;color:var(--steel);line-height:1.65;font-family:\"Space Grotesk\",system-ui,sans-serif;}",
    ".rv-lesson-banner code{color:var(--amber);font-family:\"IBM Plex Mono\",monospace;font-size:12.5px;}",
    ".rv-keys{display:block;width:100%;margin-top:8px;font-family:var(--font-m);font-size:10.5px;letter-spacing:.08em;color:var(--dim);}",
    ".rv-panel.rv-page{max-width:none;margin:0;}",
    ".rv-page .rv-close{display:none;}",
    ".rv-readout{font-family:var(--font-m);font-size:11.5px;letter-spacing:.06em;color:var(--steel);margin:0 0 12px;font-variant-numeric:tabular-nums;}",
    ".rv-btn:focus-visible,.rv-tab:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
    ".rv-ed:focus-visible{outline:2px solid var(--ember);outline-offset:-2px;}",
    "@media (prefers-reduced-motion: reduce){.rv-btn:active{transform:none;}}",
  ].join("\n");

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function hex(n, w) {
    var s = (n >>> 0).toString(16);
    while (s.length < (w || 8)) s = "0" + s;
    return "0x" + s;
  }
  function store(k, v) {
    try {
      if (v === undefined) return window.localStorage.getItem(k);
      window.localStorage.setItem(k, v);
    } catch (e) { return null; }
  }

  var S = {
    asm: null, cpu: null, prevR: null, tab: "bench",
    chalsDone: []
  };
  try { S.chalsDone = JSON.parse(store("rvbench.done") || "[]"); } catch (e) { S.chalsDone = []; }
  if (!Array.isArray(S.chalsDone)) S.chalsDone = [];
  function saveDone() { try { store("rvbench.done", JSON.stringify(S.chalsDone)); } catch (e) {} }

  function renderOut(items) {
    var s = "";
    (items || []).slice(0, 4000).forEach(function (o) {
      s += o.t === "char" ? String.fromCharCode(o.v) : String(o.v) + "\n";
    });
    return s;
  }
  function status(msg, cls) {
    var st = $("rvStatus");
    if (!st) return;
    st.textContent = msg;
    st.className = "rv-status" + (cls ? " " + cls : "");
  }

  function doAssemble() {
    var src = $("rpEd").value;
    var asm;
    try { asm = rvAssemble(src); }
    catch (e) {
      S.asm = null; S.cpu = null;
      status("ASSEMBLE FAILED, line " + e.line + ": " + e.msg, "err");
      updateViews();
      return false;
    }
    S.asm = asm;
    S.cpu = rvCpu(asm.image, asm.entry);
    S.prevR = null;
    status("ASSEMBLED: " + asm.listing.length + " instructions, entry " + hex(asm.entry) + ". Step it or run it.", "ok");
    updateViews();
    return true;
  }
  function doStep() {
    if (!S.cpu && !doAssemble()) return;
    try {
      var r = rvStep(S.cpu);
      if (r === "halt") status("HALTED after " + S.cpu.steps + " steps.", "ok");
      else status("STEP " + S.cpu.steps + ", pc = " + hex(S.cpu.pc) + (S.cpu.halted ? " (halted)" : ""), "");
    } catch (e) {
      status("TRAP: " + (e.trap || e.msg), "err");
    }
    updateViews();
  }
  function doRun() {
    if (!S.cpu && !doAssemble()) return;
    try {
      rvRun(S.cpu, 200000);
      status("HALTED after " + S.cpu.steps + " steps.", "ok");
    } catch (e) {
      status("TRAP: " + (e.trap || e.msg), "err");
    }
    updateViews();
  }
  function doReset() {
    if (S.asm) {
      S.cpu = rvCpu(S.asm.image, S.asm.entry);
      S.prevR = null;
      status("RESET. Registers cleared, pc back to entry.", "");
      updateViews();
    } else { doAssemble(); }
  }

  function renderRegs() {
    var box = $("rvRegs");
    if (!box) return;
    if (!S.cpu) { box.innerHTML = "<div style=\"padding:14px;color:var(--steel);font-size:12.5px\">Assemble a program to inspect the register file.</div>"; return; }
    var h = "";
    for (var r = 0; r < 32; r++) {
      var v = S.cpu.R[r] | 0;
      var chg = S.prevR && (S.prevR[r] !== v);
      h += "<div class=\"rv-reg" + (chg ? " chg" : "") + "\"><span class=\"rn\">" +
        RV_REGNAMES[r] + " x" + r + "</span><span class=\"rv\">" + v + " (" + hex(v) + ")</span></div>";
    }
    box.innerHTML = h;
    S.prevR = S.cpu.R.slice();
  }
  function renderConsole() {
    var c = $("rvCon");
    if (c) c.textContent = S.cpu ? (renderOut(S.cpu.out) || "(no output yet)") : "(no output yet)";
  }
  function renderMc() {
    var box = $("rvMc");
    if (!box) return;
    if (!S.asm) { box.innerHTML = "<div style=\"padding:14px;color:var(--steel);font-size:12.5px\">Machine code appears after assembly.</div>"; return; }
    var pc = S.cpu ? (S.cpu.pc >>> 0) : -1;
    var h = "";
    S.asm.listing.forEach(function (e) {
      var cur = (e.addr >>> 0) === pc;
      h += "<div class=\"mrow" + (cur ? " cur" : "") + "\"><span class=\"ma\">" + hex(e.addr) +
        "</span><span class=\"mw\">" + hex(e.word) + "</span><span class=\"md\">" +
        esc(rvDis(e.word)) + "  ; " + esc(e.src) + "</span></div>";
    });
    box.innerHTML = h;
    var curEl = box.querySelector(".mrow.cur");
    if (curEl && curEl.scrollIntoView) curEl.scrollIntoView({ block: "nearest" });
  }
  function updateViews() { renderRegs(); renderConsole(); renderMc(); renderReadout(); rvSyncGutter(); }

  /* Mono status readout: assembled byte count, program counter, and the
     halted/running state. Tabular numerals keep it steady while stepping. */
  function renderReadout() {
    var r = $("rpReadout");
    if (!r) return;
    var nIns = 0, nBytes = 0;
    if (S.asm && S.asm.listing) {
      S.asm.listing.forEach(function (e) {
        if (e.bytes && e.bytes.length) { nIns++; nBytes += e.bytes.length; }
        else if (e.word !== null) { nIns++; nBytes += 4; }
      });
    }
    var pc = S.cpu ? hex(S.cpu.pc >>> 0) : "--------";
    var state = !S.cpu ? "IDLE" : (S.cpu.halted ? "HALTED" : "READY");
    r.textContent = nBytes + " BYTES / PC " + pc + " / " + state;
  }

  /* Editor gutter: line numbers stay pinned to the textarea, and the
     line the pc currently points at is marked after every step/run. */
  function rvSyncGutter() {
    var ta = $("rpEd"), g = $("rpGutter");
    if (!ta || !g) return;
    var n = ta.value.split("\n").length, h = "", l;
    var pc = S.cpu ? (S.cpu.pc >>> 0) : -1, cur = -1;
    if (S.asm) {
      for (var i = 0; i < S.asm.listing.length; i++) {
        var e = S.asm.listing[i];
        if (e.word !== null && (e.addr >>> 0) === pc) { cur = e.line; break; }
      }
    }
    for (l = 1; l <= n; l++) h += (l === cur ? "<span class=\"cur\">" + l + "</span>" : String(l)) + "\n";
    g.innerHTML = h;
    g.scrollTop = ta.scrollTop;
  }

  function readMemWords(cpu, base, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = base + i * 4;
      out.push((cpu.mem[a] | (cpu.mem[a + 1] << 8) | (cpu.mem[a + 2] << 16) | (cpu.mem[a + 3] << 24)) | 0);
    }
    return out;
  }
  function writeMemWords(cpu, base, ws) {
    for (var i = 0; i < ws.length; i++) {
      var a = base + i * 4, v = ws[i] | 0;
      cpu.mem[a] = v & 0xFF; cpu.mem[a + 1] = (v >>> 8) & 0xFF;
      cpu.mem[a + 2] = (v >>> 16) & 0xFF; cpu.mem[a + 3] = (v >>> 24) & 0xFF;
    }
  }
  function grade(ch) {
    var asm;
    try { asm = rvAssemble($("rpEd").value); }
    catch (e) { return { ok: false, html: "Does not assemble: line " + e.line + ": " + esc(e.msg) }; }
    var rows = [], allOk = true;
    ch.tests.forEach(function (t, ti) {
      var cpu = rvCpu(asm.image, asm.entry), bad = [];
      if (t.regs) Object.keys(t.regs).forEach(function (r) { cpu.R[+r] = t.regs[r] | 0; });
      if (t.mem) Object.keys(t.mem).forEach(function (a) { writeMemWords(cpu, parseInt(a, 0), t.mem[a]); });
      try { rvRun(cpu, 200000); }
      catch (e) { rows.push({ ok: false, m: "Test " + (ti + 1) + ": trap: " + esc(e.trap || e.msg) }); allOk = false; return; }
      if (!cpu.halted) { rows.push({ ok: false, m: "Test " + (ti + 1) + ": did not halt" }); allOk = false; return; }
      var w = t.want || {};
      if (w.regs) Object.keys(w.regs).forEach(function (r) {
        if ((cpu.R[+r] | 0) !== (w.regs[r] | 0)) bad.push("x" + r + " = " + (cpu.R[+r] | 0) + ", wanted " + w.regs[r]);
      });
      if (w.mem) Object.keys(w.mem).forEach(function (a) {
        var got = readMemWords(cpu, parseInt(a, 0), w.mem[a].length);
        for (var i = 0; i < got.length; i++)
          if (got[i] !== (w.mem[a][i] | 0)) bad.push("mem[" + a + "+" + (i * 4) + "] = " + got[i] + ", wanted " + w.mem[a][i]);
      });
      if (w.out !== undefined) {
        var s = renderOut(cpu.out);
        if (s !== w.out) bad.push("console = " + JSON.stringify(s) + ", wanted " + JSON.stringify(w.out));
      }
      rows.push(bad.length
        ? { ok: false, m: "Test " + (ti + 1) + ": " + esc(bad.join("; ")) }
        : { ok: true, m: "Test " + (ti + 1) + ": pass" });
      if (bad.length) allOk = false;
    });
    var html = rows.map(function (r) {
      return "<div style=\"color:" + (r.ok ? "var(--mint)" : "var(--bad)") + "\">" +
        (r.ok ? "PASS " : "FAIL ") + esc(r.m) + "</div>";
    }).join("");
    return { ok: allOk, html: html };
  }

  function switchTab(name) {
    S.tab = name;
    var tabs = document.querySelectorAll(".rv-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("on", tabs[i].getAttribute("data-tab") === name);
    var panes = { bench: "rvPaneBench", lessons: "rvPaneLessons", trials: "rvPaneTrials", isa: "rvPaneIsa" };
    Object.keys(panes).forEach(function (k) {
      var p = $(panes[k]);
      if (p) p.style.display = k === name ? "" : "none";
    });
  }

  function loadIntoEditor(src, bannerHtml) {
    $("rpEd").value = src;
    rvSyncGutter();
    var lb = $("rvLessonBanner");
    if (lb) {
      if (bannerHtml) { lb.innerHTML = bannerHtml; lb.style.display = ""; }
      else lb.style.display = "none";
    }
    switchTab("bench");
    doAssemble();
    $("rvBody").scrollTop = 0;
  }

  function renderLessons() {
    var box = $("rvPaneLessons");
    var h = "";
    RV_LESSONS.forEach(function (L, i) {
      h += "<div class=\"rv-card\"><h5>" + esc(L.t) + "</h5>" +
        "<div class=\"row\"><button class=\"rv-mini go\" data-lesson=\"" + i + "\">LOAD INTO BENCH</button></div></div>";
    });
    box.innerHTML = "<div class=\"rv-cards\">" + h + "</div>";
    var btns = box.querySelectorAll("[data-lesson]");
    for (var i = 0; i < btns.length; i++) (function (b) {
      b.addEventListener("click", function () {
        var L = RV_LESSONS[+b.getAttribute("data-lesson")];
        loadIntoEditor(L.c, "<b>" + esc(L.t) + "</b><br>" + L.b);
      });
    })(btns[i]);
  }

  function renderTrials() {
    var box = $("rvPaneTrials");
    var h = "";
    if (S.chalsDone.length === RV_CHALLENGES.length) {
      h += "<div class=\"rv-win\">ALL 8 TRIALS PASSED. You write real RISC-V now: branches, loops, memory, bit tricks. The silicon respects you.</div>";
    } else if (S.chalsDone.length) {
      h += "<div class=\"rv-win\" style=\"border-color:rgba(255,190,77,.5);color:var(--amber);background:rgba(255,190,77,.06)\">" +
        S.chalsDone.length + " / " + RV_CHALLENGES.length + " TRIALS PASSED. Keep going.</div>";
    }
    RV_CHALLENGES.forEach(function (C, i) {
      var done = S.chalsDone.indexOf(C.id) >= 0;
      h += "<div class=\"rv-card\"><h5>" + (done ? "<span class=\"rv-done\">PASS </span>" : "") + esc(C.t) +
        " <span class=\"rv-diff " + C.d + "\">" + C.d.toUpperCase() + "</span></h5>" +
        "<div class=\"bd\">" + C.b + "</div>" +
        "<div class=\"row\">" +
        "<button class=\"rv-mini\" data-tload=\"" + i + "\">LOAD STARTER</button>" +
        "<button class=\"rv-mini\" data-thint=\"" + i + "\">HINT</button>" +
        "<button class=\"rv-mini go\" data-tgrade=\"" + i + "\">GRADE MY CODE</button>" +
        "</div>" +
        "<div class=\"rv-hint\" id=\"rvhint-" + C.id + "\">HINT: " + esc(C.h) + "</div>" +
        "<div class=\"rv-res\" id=\"rvres-" + C.id + "\"></div>" +
        "</div>";
    });
    box.innerHTML = "<div class=\"rv-cards\">" + h + "</div>";
    function each(sel, fn) {
      var bs = box.querySelectorAll(sel);
      for (var i = 0; i < bs.length; i++) fn(bs[i]);
    }
    each("[data-tload]", function (b) {
      b.addEventListener("click", function () {
        var C = RV_CHALLENGES[+b.getAttribute("data-tload")];
        loadIntoEditor(C.s, "<b>Trial: " + esc(C.t) + "</b><br>" + C.b);
      });
    });
    each("[data-thint]", function (b) {
      b.addEventListener("click", function () {
        var C = RV_CHALLENGES[+b.getAttribute("data-thint")];
        $("rvhint-" + C.id).classList.toggle("show");
      });
    });
    each("[data-tgrade]", function (b) {
      b.addEventListener("click", function () {
        var C = RV_CHALLENGES[+b.getAttribute("data-tgrade")];
        var res = $("rvres-" + C.id);
        res.innerHTML = "<span style=\"color:var(--steel)\">Grading against hidden tests...</span>";
        setTimeout(function () {
          var r = grade(C);
          res.innerHTML = r.html;
          if (r.ok && S.chalsDone.indexOf(C.id) < 0) {
            S.chalsDone.push(C.id);
            saveDone();
            /* mark this card passed in place: a full re-render would wipe
               the per-test results the user just earned */
            var card = b.parentNode;
            while (card && card.className.indexOf("rv-card") < 0) card = card.parentNode;
            if (card) {
              var h5 = card.querySelector("h5");
              if (h5 && !h5.querySelector(".rv-done")) {
                var s = document.createElement("span");
                s.className = "rv-done";
                s.textContent = "PASS ";
                h5.insertBefore(s, h5.firstChild);
              }
            }
            var pane = $("rvPaneTrials");
            if (pane && S.chalsDone.length === RV_CHALLENGES.length && !pane.querySelector(".rv-win")) {
              var w = document.createElement("div");
              w.className = "rv-win";
              w.textContent = "ALL 8 TRIALS PASSED. You write real RISC-V now: branches, loops, memory, bit tricks. The silicon respects you.";
              pane.insertBefore(w, pane.firstChild);
            }
          }
        }, 30);
      });
    });
  }

  function renderIsa() {
    var box = $("rvPaneIsa");
    var h = "<table class=\"rv-isa\">";
    RV_ISAREF.forEach(function (row) {
      h += "<tr><td>" + esc(row[0]) + "</td><td>" + esc(row[1]) + "</td></tr>";
    });
    box.innerHTML = h + "</table>";
  }

  function rvOpen() {
    var ov = $("rpOverlay");
    if (ov) ov.classList.add("open");
  }
  function rvClose() {
    var ov = $("rpOverlay");
    if (ov) ov.classList.remove("open");
  }

  var rvCssDone = false;

  /* chrome "overlay": dialog over the host page (Proving Ground).
     chrome "page": lab renders inline in hostEl, no overlay, no close
     button (standalone site). Overlay mode opens automatically. */
  function rvBuild(chrome, hostEl) {
    chrome = (chrome === "page") ? "page" : "overlay";
    if (typeof rvAssemble === "undefined" || typeof RV_LESSONS === "undefined") {
      if (!$("rvCoreWarn")) {
        var warn = el("div", null, "RISC-V core failed to load. Reload the page.");
        warn.id = "rvCoreWarn";
        warn.style.cssText = "padding:20px;color:var(--bad);font-family:var(--font-m)";
        document.body.appendChild(warn);
      }
      return null;
    }
    if (!rvCssDone) {
      var st = document.createElement("style");
      st.textContent = RV_CSS;
      document.head.appendChild(st);
      rvCssDone = true;
    }
    if ($("rpPanel")) {
      if (chrome === "overlay") rvOpen();
      return $("rpPanel");
    }

    var panel = el("div", "rv-panel");
    panel.id = "rpPanel";
    var bar = el("div", "rv-bar");
    bar.innerHTML =
      "<span class=\"rv-title\"><span class=\"rv-num\">08</span>RISC-V PLAYGROUND</span>" +
      "<div class=\"rv-tabs\">" +
      "<button class=\"rv-tab on\" data-tab=\"bench\" type=\"button\">BENCH</button>" +
      "<button class=\"rv-tab\" data-tab=\"lessons\" type=\"button\">LESSONS</button>" +
      "<button class=\"rv-tab\" data-tab=\"trials\" type=\"button\">TRIALS</button>" +
      "<button class=\"rv-tab\" data-tab=\"isa\" type=\"button\">ISA</button>" +
      "</div>" +
      "<button class=\"rv-close\" id=\"rpClose\" type=\"button\">CLOSE</button>";

    var body = el("div", "rv-body");
    body.id = "rvBody";

    var bench = el("div");
    bench.id = "rvPaneBench";
    bench.innerHTML =
      "<div class=\"rv-lesson-banner\" id=\"rvLessonBanner\" style=\"display:none\"></div>" +
      "<div class=\"rv-toolbar\">" +
      "<div class=\"rv-tgroup\">" +
      "<button class=\"rv-btn pri\" id=\"rvAssemble\" type=\"button\" title=\"Assemble (Alt+A)\">ASSEMBLE</button>" +
      "<button class=\"rv-btn sec\" id=\"rpRun\" type=\"button\" title=\"Run (Alt+R)\">RUN</button>" +
      "</div><div class=\"rv-tsep\" aria-hidden=\"true\"></div><div class=\"rv-tgroup\">" +
      "<button class=\"rv-btn\" id=\"rpStep\" type=\"button\" title=\"Single step (Alt+S)\">STEP</button>" +
      "<button class=\"rv-btn\" id=\"rpReset\" type=\"button\" title=\"Reset (Alt+X)\">RESET</button>" +
      "</div>" +
      "<span class=\"rv-keys\">ALT+A ASSEMBLE &nbsp;/&nbsp; ALT+S STEP &nbsp;/&nbsp; ALT+R RUN &nbsp;/&nbsp; ALT+X RESET</span>" +
      "</div>" +
      "<p class=\"rv-readout\" id=\"rpReadout\"></p>" +
      "<p class=\"rv-status\" id=\"rvStatus\">Write RV32I assembly, then ASSEMBLE. Start with a lesson if this is your first silicon.</p>" +
      "<div class=\"rv-grid\">" +
      "<div><div class=\"rv-edwrap\"><div class=\"rv-gutter\" id=\"rpGutter\" aria-hidden=\"true\">1</div><textarea class=\"rv-ed\" id=\"rpEd\" spellcheck=\"false\" aria-label=\"RISC-V assembly editor\" wrap=\"off\"></textarea></div></div>" +
      "<div>" +
      "<div class=\"rv-pane\" style=\"margin-bottom:12px\"><h4>REGISTERS</h4><div class=\"rv-regs\" id=\"rvRegs\"></div></div>" +
      "<div class=\"rv-pane\" style=\"margin-bottom:12px\"><h4>CONSOLE</h4><div class=\"rv-con\" id=\"rvCon\">(no output yet)</div></div>" +
      "</div>" +
      "</div>" +
      "<div class=\"rv-pane\" style=\"margin-top:12px\"><h4>MACHINE CODE</h4><div class=\"rv-mc\" id=\"rvMc\"></div></div>";

    var lessons = el("div");
    lessons.id = "rvPaneLessons";
    lessons.style.display = "none";
    var trials = el("div");
    trials.id = "rvPaneTrials";
    trials.style.display = "none";
    var isa = el("div");
    isa.id = "rvPaneIsa";
    isa.style.display = "none";

    body.appendChild(bench);
    body.appendChild(lessons);
    body.appendChild(trials);
    body.appendChild(isa);
    panel.appendChild(bar);
    panel.appendChild(body);
    var ov = null;
    if (chrome === "page") {
      panel.classList.add("rv-page");
      (hostEl || document.body).appendChild(panel);
    } else {
      ov = el("div", "rv-overlay");
      ov.id = "rpOverlay";
      ov.setAttribute("role", "dialog");
      ov.setAttribute("aria-label", "The RISC-V Playground");
      ov.appendChild(panel);
      document.body.appendChild(ov);
    }

    var tabs = bar.querySelectorAll(".rv-tab");
    for (var i = 0; i < tabs.length; i++) (function (t) {
      t.addEventListener("click", function () { switchTab(t.getAttribute("data-tab")); });
    })(tabs[i]);

    $("rpEd").value = "# The RISC-V Playground, bench 08.\n# Write real RV32I assembly. ASSEMBLE it, STEP the silicon,\n# or RUN it to the halt. Try the LESSONS tab, or prove it in TRIALS.\n\nli a0, 42\nli a7, 1      # ecall 1 = print integer in a0\necall\nli a7, 10     # ecall 10 = halt\necall\n";
    $("rvAssemble").addEventListener("click", doAssemble);
    $("rpStep").addEventListener("click", doStep);
    $("rpRun").addEventListener("click", doRun);
    $("rpReset").addEventListener("click", doReset);
    $("rpEd").addEventListener("keydown", function (e) {
      if (e.key === "Tab") {
        e.preventDefault();
        var t = e.target, s = t.selectionStart;
        t.value = t.value.slice(0, s) + "  " + t.value.slice(t.selectionEnd);
        t.selectionStart = t.selectionEnd = s + 2;
        rvSyncGutter();
      }
    });
    var rped = $("rpEd");
    rped.addEventListener("input", rvSyncGutter);
    rped.addEventListener("scroll", function () {
      var g = $("rpGutter");
      if (g) g.scrollTop = rped.scrollTop;
    });
    rvSyncGutter();

    renderLessons();
    renderTrials();
    renderIsa();
    doAssemble();

    $("rpClose").addEventListener("click", rvClose);
    if (ov) {
      ov.addEventListener("click", function (e) { if (e.target === ov) rvClose(); });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && ov.classList.contains("open")) rvClose();
      });
    }
    wireShortcuts(panel);
    return panel;
  }

  /* Keyboard shortcuts: Alt+A assemble, Alt+S step, Alt+R run, Alt+X
     reset. Alt combos never type text, so they stay safe with focus in
     the editor, and none collide with browser reload or navigation. */
  function wireShortcuts(panel) {
    document.addEventListener("keydown", function (e) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      var k = (e.key || "").toLowerCase();
      var fn = k === "a" ? doAssemble : k === "s" ? doStep :
               k === "r" ? doRun : k === "x" ? doReset : null;
      if (!fn) return;
      if (!document.contains(panel)) return;
      var ov = $("rpOverlay");
      if (ov && !ov.classList.contains("open")) return;
      e.preventDefault();
      fn();
    });
  }

  /* Shared mount API. chrome "overlay": build the dialog and open it
     (Proving Ground). chrome "page": render the lab inline in hostEl,
     no overlay and no close button (standalone site). */
  function rvMount(hostEl, opts) {
    opts = opts || {};
    var mode = (opts.chrome === "page") ? "page" : "overlay";
    var panel = rvBuild(mode, hostEl);
    if (panel && mode === "overlay") rvOpen();
    return { panel: panel, open: rvOpen, close: rvClose };
  }
  if (typeof window !== "undefined") {
    window.RiscvLab = { mount: rvMount, grade: grade };
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      RV: { open: rvOpen, close: rvClose, build: rvBuild, grade: grade, mount: rvMount }
    });
  }

})();
