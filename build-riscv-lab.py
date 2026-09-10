#!/usr/bin/env python3
"""Build riscv-lab.js: extract PG Bench 08 from features.js and turn it into
the shared RISC-V lab module exposing window.RiscvLab.mount(el, opts).

Bench logic (assembler, interpreter, lessons, trials, grading) is NOT
touched: only the mount/entry layer, shared UX additions, and the header
comment change. Fails loudly if any expected source block is missing.
"""
import sys

FEAT = "/home/hatch/workspace/deploy/proving-ground/features.js"
OUT = "/home/hatch/workspace/deploy/proving-ground/riscv-lab.js"

with open(FEAT, encoding="utf-8") as f:
    lines = f.readlines()

# Bench 08 block: header comment at line 5083 through the IIFE close at 5648.
# (Bench 09 starts at 5650.) Verify the boundaries before cutting.
assert lines[5082].startswith("/* ================= THE RISC-V PLAYGROUND"), lines[5082][:60]
assert lines[5089].strip() == '(function () {', lines[5089][:60]
assert lines[5648].strip() == "})();", lines[5648][:60]
assert lines[5649].startswith("/* ================= THE PAGE WALKER"), lines[5649][:60]
src = "".join(lines[5082:5649])

reps = []

# 1. Header comment -> shared module header (no em dashes, user-facing rule).
reps.append((
"""/* ================= THE RISC-V PLAYGROUND (BENCH 08) =================
   Native bench, on-theme: the real RV32I core (rvcore.js, no DOM, shared
   with the node's 42-assertion suite) drives an instrument-styled bench:
   editor, single-step, run, live registers, console, machine-code listing,
   10 guided lessons, 8 auto-graded trials, ISA reference. No iframe, no
   outbound links, works offline once loaded. */""",
"""/* ================= RISC-V LAB (shared module) =================
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
   changed. */"""))

# 2. Shared UX additions appended to the module CSS: page-mode layout,
#    focus-visible rings, mono readout with tabular numerals, shortcut hint,
#    and a reduced-motion guard.
reps.append((
'''    ".rv-lesson-banner b{color:var(--paper);font-weight:600;}"
  ].join("\\n");''',
'''    ".rv-keys{display:block;width:100%;margin-top:8px;font-family:var(--font-m);font-size:10.5px;letter-spacing:.08em;color:var(--dim);}",
    ".rv-panel.rv-page{max-width:none;margin:0;}",
    ".rv-page .rv-close{display:none;}",
    ".rv-readout{font-family:var(--font-m);font-size:11.5px;letter-spacing:.06em;color:var(--steel);margin:0 0 12px;font-variant-numeric:tabular-nums;}",
    ".rv-btn:focus-visible,.rv-tab:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
    ".rv-ed:focus-visible{outline:2px solid var(--ember);outline-offset:-2px;}",
    "@media (prefers-reduced-motion: reduce){.rv-btn:active{transform:none;}}",
  ].join("\\n");'''))

# 3. rvBuild becomes chrome-parameterized; the PG launcher button moves to
#    the features.js adapter; CSS injection becomes idempotent.
reps.append((
'''  function rvBuild() {
    if (typeof rvAssemble === "undefined" || typeof RV_LESSONS === "undefined") {
      var warn = el("div", null, "RISC-V core failed to load. Reload the page.");
      warn.style.cssText = "padding:20px;color:var(--bad);font-family:var(--font-m)";
      document.body.appendChild(warn);
      return;
    }
    var st = document.createElement("style");
    st.textContent = RV_CSS;
    document.head.appendChild(st);

    var box = document.querySelector(".dossier .actions");
    if (box && !$("rpBtn")) {
      var b = el("button", "secondary", "Run the RISC-V Playground");
      b.id = "rpBtn";
      b.addEventListener("click", rvOpen);
      box.appendChild(b);
    }
    if ($("rpOverlay")) return;

    var ov = el("div", "rv-overlay");
    ov.id = "rpOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "The RISC-V Playground");

    var panel = el("div", "rv-panel");''',
'''  var rvCssDone = false;

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
    panel.id = "rpPanel";'''))

# 4. Toolbar: shortcut titles, visible shortcut hint, mono status readout.
reps.append((
'''      "<button class=\\"rv-btn pri\\" id=\\"rvAssemble\\" type=\\"button\\">ASSEMBLE</button>" +
      "<button class=\\"rv-btn sec\\" id=\\"rpRun\\" type=\\"button\\">RUN</button>" +
      "</div><div class=\\"rv-tsep\\" aria-hidden=\\"true\\"></div><div class=\\"rv-tgroup\\">" +
      "<button class=\\"rv-btn\\" id=\\"rpStep\\" type=\\"button\\">STEP</button>" +
      "<button class=\\"rv-btn\\" id=\\"rpReset\\" type=\\"button\\">RESET</button>" +
      "</div>" +
      "</div>" +
      "<p class=\\"rv-status\\" id=\\"rvStatus\\">Write RV32I assembly, then ASSEMBLE. Start with a lesson if this is your first silicon.</p>" +''',
'''      "<button class=\\"rv-btn pri\\" id=\\"rvAssemble\\" type=\\"button\\" title=\\"Assemble (Alt+A)\\">ASSEMBLE</button>" +
      "<button class=\\"rv-btn sec\\" id=\\"rpRun\\" type=\\"button\\" title=\\"Run (Alt+R)\\">RUN</button>" +
      "</div><div class=\\"rv-tsep\\" aria-hidden=\\"true\\"></div><div class=\\"rv-tgroup\\">" +
      "<button class=\\"rv-btn\\" id=\\"rpStep\\" type=\\"button\\" title=\\"Single step (Alt+S)\\">STEP</button>" +
      "<button class=\\"rv-btn\\" id=\\"rpReset\\" type=\\"button\\" title=\\"Reset (Alt+X)\\">RESET</button>" +
      "</div>" +
      "<span class=\\"rv-keys\\">ALT+A ASSEMBLE &nbsp;/&nbsp; ALT+S STEP &nbsp;/&nbsp; ALT+R RUN &nbsp;/&nbsp; ALT+X RESET</span>" +
      "</div>" +
      "<p class=\\"rv-readout\\" id=\\"rpReadout\\"></p>" +
      "<p class=\\"rv-status\\" id=\\"rvStatus\\">Write RV32I assembly, then ASSEMBLE. Start with a lesson if this is your first silicon.</p>" +'''))

# 5. Mount the panel into the overlay (overlay chrome) or inline into the
#    host element (page chrome).
reps.append((
'''    panel.appendChild(bar);
    panel.appendChild(body);
    ov.appendChild(panel);
    document.body.appendChild(ov);''',
'''    panel.appendChild(bar);
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
    }'''))

# 6. End-of-build wiring: overlay-only listeners guarded, shortcuts wired,
#    panel returned for the mount API.
reps.append((
'''    $("rpClose").addEventListener("click", rvClose);
    ov.addEventListener("click", function (e) { if (e.target === ov) rvClose(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("open")) rvClose();
    });''',
'''    $("rpClose").addEventListener("click", rvClose);
    if (ov) {
      ov.addEventListener("click", function (e) { if (e.target === ov) rvClose(); });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && ov.classList.contains("open")) rvClose();
      });
    }
    wireShortcuts(panel);
    return panel;'''))

# 7. Mono readout refreshed with every view update.
reps.append((
'''  function updateViews() { renderRegs(); renderConsole(); renderMc(); rvSyncGutter(); }''',
'''  function updateViews() { renderRegs(); renderConsole(); renderMc(); renderReadout(); rvSyncGutter(); }

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
  }'''))

# 8. Replace the PG-specific auto-init with the shared mount API.
reps.append((
'''  function rvInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    rvBuild();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", rvInit);
    } else {
      rvInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, { RV: { open: rvOpen, close: rvClose, build: rvBuild, grade: grade } });
  }

})();''',
'''  /* Keyboard shortcuts: Alt+A assemble, Alt+S step, Alt+R run, Alt+X
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

})();'''))

for i, (old, new) in enumerate(reps):
    n = src.count(old)
    assert n == 1, "replacement %d found %d times, expected 1" % (i + 1, n)
    src = src.replace(old, new)

# Sanity: no leftover references to the old auto-launcher inside the module.
assert 'querySelector(".dossier .actions")' not in src
assert "rpBtn" not in src
assert 'RiscvLab' in src and 'rpReadout' in src and 'rv-page' in src

if "\u2014" in src:
    raise SystemExit("em dash found in riscv-lab.js")

with open(OUT, "w", encoding="utf-8") as f:
    f.write(src)
print("wrote", OUT, len(src), "chars")
