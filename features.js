/* Shared prelude: RV register names (used by the Silicon Anvil module). */
var RV_REGNAMES = ["zero","ra","sp","gp","tp","t0","t1","t2","s0","s1","a0","a1","a2","a3","a4","a5","a6","a7","s2","s3","s4","s5","s6","s7","s8","s9","s10","s11","t3","t4","t5","t6"];

/* ================= THE SILICON ANVIL =================
   A real RV32I test rig: write assembly, assemble it to machine code,
   step a genuine 32-bit core, pass trials, earn certificates. */

var ANVIL_TRIALS = [
  { id: "firstlight", name: "First Light",
    goal: "Put the value 42 into a0, then halt the core with ecall (a7 = 10).",
    hint: "li a0, 42  /  li a7, 10  /  ecall",
    check: function (cpu) { return (cpu.R[10] | 0) === 42; } },
  { id: "counter", name: "The Counter",
    goal: "Print 1, 2, 3, 4, 5 through the UART (ecall with a7 = 1, value in a0), then halt.",
    hint: "loop with beq, mv a0, t0, ecall, addi t0, t0, 1",
    check: function (cpu) {
      var o = cpu.out.map(function (e) { return e.v; });
      return o.length === 5 && o[0] === 1 && o[1] === 2 && o[2] === 3 && o[3] === 4 && o[4] === 5;
    } },
  { id: "courier", name: "Memory Courier",
    goal: "Store the word 0xCAFE at byte address 0x100, then halt.",
    hint: "li t0, 0xCAFE  /  li t1, 0x100  /  sw t0, 0(t1)",
    check: function (cpu) { return (rvLoadW(cpu, 0x100) >>> 0) === 0xCAFE; } }
];

var RV_EXAMPLES = {
  fib: "# Fibonacci(9) = 34 into a0, the hard way. Watch t2 carry the sum.\n" +
    "addi a0, x0, 0\naddi a1, x0, 1\naddi t0, x0, 10\naddi t1, x0, 1\n" +
    "loop:\nbeq t1, t0, done\nadd t2, a0, a1\nmv a0, a1\nmv a1, t2\naddi t1, t1, 1\nj loop\n" +
    "done:\nli a7, 10\necall",
  counter: "# Count 1..5 out the UART. a7=1 prints a0, a7=10 halts.\n" +
    "addi t0, x0, 1\naddi t1, x0, 6\nloop:\nbeq t0, t1, done\nmv a0, t0\nli a7, 1\necall\naddi t0, t0, 1\nj loop\ndone:\nli a7, 10\necall",
  blank: "# THE SILICON ANVIL: a real RV32I core on the bench.\n" +
    "# Real instructions: addi add sub and or xor sll srl sra slt sltu,\n" +
    "# lw lh lb lbu lhu sw sh sb, beq bne blt bge bltu bgeu,\n" +
    "# jal jalr lui auipc ecall. Pseudos: li mv nop j ret. Comments start with #.\n" +
    "# Registers: x0..x31 or ABI names (a0..a7, t0..t6, s0..s11, ra, sp).\n" +
    "# ecall services: a7=1 prints a0 to the UART, a7=10 halts the core.\n# Memory: 4 KB, sp starts at 0x1000.\n\n" +
    "li a0, 42\nli a7, 10\necall"
};

var rvs = null;

function rvHex(n, pad) {
  var s = (n >>> 0).toString(16);
  while (s.length < pad) s = "0" + s;
  return s;
}

function rvBuild() {
  var box = document.querySelector(".dossier .actions");
  if (!box || $("rvAnvilBtn")) return;

  var css = [
    ".rv-overlay{position:fixed;inset:0;z-index:9999;background:rgba(4,8,8,.92);display:none;align-items:center;justify-content:center;padding:16px;}",
    ".rv-overlay.open{display:flex;}",
    ".rv-panel{width:min(860px,100%);max-height:94vh;overflow-y:auto;background:#0a1416;border:1px solid var(--acid);padding:16px;}",
    ".rv-panel h3{margin:0 0 4px;font-family:var(--font-d);text-transform:uppercase;letter-spacing:.02em;}",
    ".rv-sub{font-size:11px;color:var(--steel);margin:0 0 12px;text-transform:uppercase;letter-spacing:.1em;line-height:1.7;}",
    ".rv-trials{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px;}",
    ".rv-trial{border:1px solid var(--line);padding:8px 10px;background:var(--panel-2);cursor:pointer;min-width:0;}",
    ".rv-trial.sel{border-color:var(--acid);}",
    ".rv-trial h5{margin:0 0 4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--cyan);}",
    ".rv-trial p{margin:0 0 4px;font-size:11px;color:var(--paper);line-height:1.5;}",
    ".rv-trial p.hint{font-family:var(--font-m);font-size:10px;color:var(--steel);}",
    ".rv-ed{width:100%;min-height:190px;background:var(--ink);border:1px solid var(--line);color:var(--paper);font-family:var(--font-m);font-size:12px;line-height:1.55;padding:10px;box-sizing:border-box;resize:vertical;}",
    ".rv-btns{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:10px 0;}",
    ".rv-btns button{min-height:46px;padding:10px 6px;font-family:var(--font-d);font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;background:var(--panel-2);border:1px solid var(--line);color:var(--paper);}",
    ".rv-btns button:disabled{opacity:.35;cursor:default;}",
    "#rvRun{border-color:var(--acid);color:var(--acid);}",
    ".rv-btns2{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 10px;}",
    ".rv-btns2 button{min-height:40px;padding:8px 6px;font-family:var(--font-m);font-size:11px;cursor:pointer;background:var(--panel-2);border:1px solid var(--line);color:var(--cyan);}",
    ".rv-status{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px;}",
    ".rv-stat{border:1px solid var(--line);padding:6px 8px;background:var(--panel-2);min-width:0;}",
    ".rv-stat h6{margin:0 0 2px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--steel);font-weight:600;}",
    ".rv-stat p{margin:0;font-family:var(--font-m);font-size:12px;color:var(--paper);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".rv-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;}",
    ".rv-box{border:1px solid var(--line);background:var(--ink);padding:8px;min-width:0;}",
    ".rv-box h6{margin:0 0 6px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--steel);font-weight:600;}",
    ".rv-regs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;}",
    ".rv-reg{border:1px solid var(--line);padding:4px 6px;font-family:var(--font-m);font-size:10px;color:var(--paper);}",
    ".rv-reg b{color:var(--steel);font-weight:400;margin-right:4px;}",
    ".rv-reg.chg{border-color:var(--acid);color:var(--acid);}",
    ".rv-reg.chg b{color:var(--acid);}",
    ".rv-mem{font-family:var(--font-m);font-size:10px;color:var(--paper);line-height:1.7;white-space:pre;overflow-x:auto;}",
    ".rv-mem .ad{color:var(--steel);}",
    ".rv-uart{font-family:var(--font-m);font-size:12px;color:var(--cyan);min-height:34px;white-space:pre-wrap;}",
    ".rv-listing{font-family:var(--font-m);font-size:10px;color:var(--paper);line-height:1.7;max-height:150px;overflow-y:auto;white-space:pre;}",
    ".rv-listing .ad{color:var(--steel);}",
    ".rv-listing .hx{color:var(--orange);}",
    ".rv-result{margin-top:10px;padding:10px 12px;font-size:13px;font-family:var(--font-m);border:1px solid var(--line);min-height:20px;}",
    ".rv-result.win{border-color:var(--acid);color:var(--acid);}",
    ".rv-result.fail{border-color:var(--bad);color:var(--bad);}",
    ".rv-foot{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}",
    ".rv-foot .secondary{flex:1;min-height:44px;}",
    "@media (max-width:640px){.rv-trials{grid-template-columns:1fr;}.rv-btns{grid-template-columns:repeat(2,minmax(0,1fr));}.rv-status{grid-template-columns:repeat(2,minmax(0,1fr));}.rv-cols{grid-template-columns:1fr;}.rv-regs{grid-template-columns:repeat(4,minmax(0,1fr));}}"
  ].join("\n");
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  var b = el("button", "secondary", "Fire the Silicon Anvil");
  b.id = "rvAnvilBtn";
  b.addEventListener("click", function () { $("rvAnvilOverlay").classList.add("open"); });
  box.appendChild(b);

  var trialsHtml = ANVIL_TRIALS.map(function (c, i) {
    return '<div class="rv-trial' + (i === 0 ? " sel" : "") + '" data-i="' + i + '" role="button" tabindex="0">' +
      "<h5>Trial " + (i + 1) + ": " + c.name + "</h5><p>" + c.goal + "</p>" +
      '<p class="hint">' + c.hint + "</p></div>";
  }).join("");

  var regsHtml = "";
  for (var r = 0; r < 32; r++) {
    regsHtml += '<div class="rv-reg" id="rvReg' + r + '"><b>' + RV_REGNAMES[r] + "</b><span>0</span></div>";
  }

  var ov = el("div", "rv-overlay");
  ov.id = "rvAnvilOverlay";
  ov.innerHTML =
    '<div class="rv-panel" role="dialog" aria-label="The Silicon Anvil RISC-V test rig">' +
    "<h3>The Silicon Anvil</h3>" +
    '<p class="rv-sub">A real RV32I core bolted to the bench. Write assembly, assemble it to machine code, step the silicon, pass the trials. Traps are free, certificates are earned: three trials on the anvil, right here.</p>' +
    '<div class="rv-trials">' + trialsHtml + "</div>" +
    '<textarea class="rv-ed" id="rvEd" spellcheck="false"></textarea>' +
    '<div class="rv-btns">' +
    '<button id="rvAsm">Assemble</button>' +
    '<button id="rvRun">Run</button>' +
    '<button id="rvStep">Step</button>' +
    '<button id="rvStop" disabled>Stop</button>' +
    '<button id="rvReset">Reset</button>' +
    "</div>" +
    '<div class="rv-btns2">' +
    '<button id="rvExFib">Load: Fibonacci</button>' +
    '<button id="rvExCnt">Load: Counter</button>' +
    '<button id="rvExBlk">Load: Template</button>' +
    "</div>" +
    '<div class="rv-status">' +
    '<div class="rv-stat"><h6>PC</h6><p id="rvPc">0x00000000</p></div>' +
    '<div class="rv-stat"><h6>Next instruction</h6><p id="rvNext">--</p></div>' +
    '<div class="rv-stat"><h6>Steps</h6><p id="rvSteps">0</p></div>' +
    '<div class="rv-stat"><h6>State</h6><p id="rvState">no program</p></div>' +
    "</div>" +
    '<div class="rv-cols">' +
    '<div class="rv-box"><h6>Registers (32, live)</h6><div class="rv-regs">' + regsHtml + "</div></div>" +
    '<div class="rv-box"><h6>UART (ecall prints)</h6><div class="rv-uart" id="rvUart">(silent)</div>' +
    '<h6 style="margin-top:8px;">Memory</h6><div class="rv-mem" id="rvMem">--</div></div>' +
    "</div>" +
    '<div class="rv-box"><h6>Machine code listing</h6><div class="rv-listing" id="rvListing">Assemble something first.</div></div>' +
    '<div class="rv-result" id="rvResult"></div>' +
    '<div class="rv-foot">' +
    '<button class="secondary" id="rvHexBtn" disabled>Download HEX</button>' +
    '<button class="secondary" id="rvCertBtn" disabled>Download certificate</button>' +
    '<button class="secondary" id="rvClose">Close</button>' +
    "</div>" +
    "</div>";
  document.body.appendChild(ov);

  rvs = { asm: null, cpu: null, running: false, timer: 0, challenge: 0, cert: null, prev: null };

  $("rvEd").value = RV_EXAMPLES.blank;

  var trials = ov.querySelectorAll(".rv-trial");
  for (var ti = 0; ti < trials.length; ti++) {
    (function (t, i) {
      function sel() {
        rvs.challenge = i;
        for (var k = 0; k < trials.length; k++) trials[k].classList.remove("sel");
        t.classList.add("sel");
        toast("Trial selected: " + ANVIL_TRIALS[i].name);
      }
      t.addEventListener("click", sel);
      t.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sel(); } });
    })(trials[ti], ti);
  }

  $("rvAsm").addEventListener("click", rvAssembleUI);
  $("rvRun").addEventListener("click", rvRunUI);
  $("rvStep").addEventListener("click", rvStepUI);
  $("rvStop").addEventListener("click", rvStopUI);
  $("rvReset").addEventListener("click", rvResetUI);
  $("rvExFib").addEventListener("click", function () { $("rvEd").value = RV_EXAMPLES.fib; toast("Fibonacci example loaded"); });
  $("rvExCnt").addEventListener("click", function () { $("rvEd").value = RV_EXAMPLES.counter; toast("Counter example loaded"); });
  $("rvExBlk").addEventListener("click", function () { $("rvEd").value = RV_EXAMPLES.blank; toast("Blank template loaded"); });
  $("rvHexBtn").addEventListener("click", rvHexDownload);
  $("rvCertBtn").addEventListener("click", rvCertificate);
  $("rvClose").addEventListener("click", function () { rvStopUI(); ov.classList.remove("open"); });
  ov.addEventListener("click", function (e) { if (e.target === ov) { rvStopUI(); ov.classList.remove("open"); } });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && ov.classList.contains("open")) { rvStopUI(); ov.classList.remove("open"); }
  });

  rvRefresh();
}

function rvSetResult(msg, cls) {
  var r = $("rvResult");
  r.textContent = msg;
  r.className = "rv-result" + (cls ? " " + cls : "");
}

function rvAssembleUI() {
  rvStopUI();
  var src = $("rvEd").value;
  try {
    var a = rvAssemble(src);
    if (!a.words.length) throw { line: 0, msg: "nothing to assemble" };
    rvs.asm = a;
    rvs.cpu = rvCpu(a.image, a.entry);
    rvs.prev = null;
    rvs.cert = null;
    $("rvCertBtn").disabled = true;
    $("rvHexBtn").disabled = false;
    var lh = a.listing.map(function (l) {
      if (l.word === null && l.bytes) {
        return '<span class="ad">0x' + rvHex(l.addr, 8) + "</span>  " +
          '<span class="hx">' + l.bytes.map(function (b) { return rvHex(b, 2); }).join(" ") + "</span>  " +
          ".bytes " + l.bytes.length + "   <span class='ad'>; " + l.src.replace(/</g, "&lt;") + "</span>";
      }
      return '<span class="ad">0x' + rvHex(l.addr, 8) + "</span>  " +
        '<span class="hx">' + rvHex(l.word, 8) + "</span>  " +
        rvDis(l.word) + "   <span class='ad'>; " + l.src.replace(/</g, "&lt;") + "</span>";
    }).join("\n");
    $("rvListing").innerHTML = lh;
    rvSetResult("Assembled " + a.words.length + " words. Core reset, sp = 0x1000. Run it, or step it like you mean it.", "");
    rvRefresh();
    toast("Assembled " + a.words.length + " words");
  } catch (e) {
    rvSetResult("Assembly failed" + (e.line ? " at line " + e.line : "") + ": " + (e.msg || e.trap || "error"), "fail");
  }
}

function rvStopUI() {
  rvs.running = false;
  if (rvs.timer) { clearTimeout(rvs.timer); rvs.timer = 0; }
  var rs = $("rvRun"), sp = $("rvStop");
  if (rs) rs.disabled = !rvs.cpu;
  if (sp) sp.disabled = true;
}

function rvStepOnce() {
  try {
    var st = rvStep(rvs.cpu);
    return st;
  } catch (e) {
    rvSetResult("TRAP: " + (e.trap || e.msg || "unknown") + ". The core is halted in shame.", "fail");
    rvs.cpu.halted = true;
    rvStopUI();
    rvRefresh();
    return "trap";
  }
}

function rvStepUI() {
  if (!rvs.cpu || rvs.running) return;
  var st = rvStepOnce();
  rvRefresh();
  if (st === "halt") rvOnHalt();
}

function rvRunUI() {
  if (!rvs.cpu || rvs.running) return;
  rvSetResult("Running...", "");
  rvs.running = true;
  $("rvRun").disabled = true;
  $("rvStop").disabled = false;
  function chunk() {
    if (!rvs.running) return;
    var n = 0, done = false, trapped = null;
    try {
      while (n < 4000 && !rvs.cpu.halted) { rvStep(rvs.cpu); n++; }
      done = rvs.cpu.halted;
    } catch (e) { trapped = e.trap || e.msg || "unknown"; rvs.cpu.halted = true; }
    rvRefresh();
    if (trapped) {
      rvSetResult("TRAP: " + trapped + ". The core is halted in shame.", "fail");
      rvStopUI();
      return;
    }
    if (done) { rvStopUI(); rvOnHalt(); return; }
    rvs.timer = setTimeout(chunk, 16);
  }
  chunk();
}

function rvResetUI() {
  rvStopUI();
  if (!rvs.asm) return;
  rvs.cpu = rvCpu(rvs.asm.image, rvs.asm.entry);
  rvs.prev = null;
  rvs.cert = null;
  $("rvCertBtn").disabled = true;
  rvSetResult("Core reset. Same program, fresh silicon.", "");
  rvRefresh();
}

function rvOnHalt() {
  var c = ANVIL_TRIALS[rvs.challenge];
  var pass = false;
  try { pass = c.check(rvs.cpu); } catch (e) { pass = false; }
  if (pass) {
    rvs.cert = { trial: c.name, steps: rvs.cpu.steps, date: new Date().toISOString().slice(0, 10) };
    $("rvCertBtn").disabled = false;
    rvSetResult("TRIAL PASSED: " + c.name + " in " + rvs.cpu.steps + " steps. The anvil rings true. Certificate unlocked.", "win");
    toast("Trial passed: " + c.name);
  } else {
    rvSetResult("Halted after " + rvs.cpu.steps + " steps, but trial '" + c.name + "' not satisfied. Check the goal and try again.", "");
  }
}

function rvRefresh() {
  if (!rvs.cpu) {
    $("rvPc").textContent = "0x00000000";
    $("rvNext").textContent = "--";
    $("rvSteps").textContent = "0";
    $("rvState").textContent = "no program";
    $("rvUart").textContent = "(silent)";
    $("rvMem").textContent = "--";
    return;
  }
  var cpu = rvs.cpu;
  $("rvPc").textContent = "0x" + rvHex(cpu.pc, 8);
  $("rvSteps").textContent = String(cpu.steps);
  $("rvState").textContent = cpu.halted ? "halted" : (rvs.running ? "running" : "ready");
  var nxt = "--";
  if (cpu.pc + 4 <= cpu.memsz) {
    nxt = rvDis(cpu.mem[cpu.pc] | (cpu.mem[cpu.pc + 1] << 8) | (cpu.mem[cpu.pc + 2] << 16) | (cpu.mem[cpu.pc + 3] << 24));
  }
  $("rvNext").textContent = nxt;
  for (var r = 0; r < 32; r++) {
    var cell = $("rvReg" + r);
    var v = cpu.R[r] | 0;
    var changed = rvs.prev && rvs.prev[r] !== v;
    cell.className = "rv-reg" + (changed ? " chg" : "");
    cell.querySelector("span").textContent = "0x" + rvHex(v, 8);
    cell.title = RV_REGNAMES[r] + " = " + v + " (signed)";
  }
  rvs.prev = cpu.R.slice();
  $("rvUart").textContent = cpu.out.length ? cpu.out.map(function (e) { return e.t === "char" ? String.fromCharCode(e.v) : String(e.v); }).join(" ") : "(silent)";
  var mh = "";
  function wordAt(a) { return (cpu.mem[a] | (cpu.mem[a + 1] << 8) | (cpu.mem[a + 2] << 16) | (cpu.mem[a + 3] << 24)) >>> 0; }
  for (var m = 0; m < 8; m++) {
    var a = m * 4;
    mh += '<span class="ad">0x' + rvHex(a, 4) + "</span> " + rvHex(wordAt(a), 8) + (m === 3 ? "\n" : "  ");
  }
  mh += "\n" + '<span class="ad">0x0100</span> ' + rvHex(wordAt(0x100), 8) + "   " + '<span class="ad">0x0FFC</span> ' + rvHex(wordAt(0xFFC), 8);
  $("rvMem").innerHTML = mh;
  $("rvRun").disabled = cpu.halted || rvs.running;
}

function rvHexDownload() {
  if (!rvs.asm) return;
  var txt = rvs.asm.listing.map(function (l) {
    return "0x" + rvHex(l.addr, 8) + "  " + rvHex(l.word, 8) + "  " + rvDis(l.word);
  }).join("\n");
  var blob = new Blob(["# Silicon Anvil machine code\n" + txt + "\n"], { type: "text/plain" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "anvil-program.hex";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  toast("HEX listing downloaded");
}

function rvCertificate() {
  if (!rvs.cert) return;
  var c = rvs.cert;
  var v = (typeof currentInvention === "function") ? currentInvention() : null;
  var nm = v ? v.name : "unnamed prototype";
  var code = v ? v.code : "n/a";
  var txt =
    "SILICON ANVIL TRIAL CERTIFICATE\n" +
    "The Proving Ground RV32I Test Rig\n" +
    "================================\n" +
    "Invention : " + nm + " (" + code + ")\n" +
    "Trial     : " + c.trial + "\n" +
    "Date      : " + c.date + "\n" +
    "Result    : TRIAL PASSED, CORE HALTED CLEAN\n" +
    "Steps     : " + c.steps + "\n" +
    "\nCertified by the bench. The silicon does not lie, it just traps.\n";
  var blob = new Blob([txt], { type: "text/plain" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "anvil-trial-certificate.txt";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  toast("Trial certificate downloaded");
}

if (typeof document !== "undefined" && document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", rvBuild);
} else if (typeof document !== "undefined") {
  rvBuild();
}

/* ============================================================
   THE WIPE STATION
   NIST 800-88 drive sanitization bench for the OLD IRON intake
   rack. Pick a method per drive (Clear / Purge / Destroy), run
   the passes, watch verification sample every block, and issue
   per-serial certificates. Fail states are real: bad-sector
   spinners and lying firmware cannot be purged, they must be
   destroyed. Self-contained, appended at the end of features.js.
   ============================================================ */
(function () {
  "use strict";

  function ws$(id) { return document.getElementById(id); }
  function wsEl(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function wsEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function wsToast(msg) {
    if (typeof window.showToast === "function") { window.showToast(msg); return; }
    var t = ws$("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  var WS_CSS = [
    ".ws-overlay{position:fixed;inset:0;background:rgba(4,7,7,.92);z-index:90;display:none;overflow-y:auto;padding:18px 12px;}",
    ".ws-overlay.open{display:block;}",
    ".ws-panel{max-width:1060px;margin:0 auto;background:var(--panel);border:1px solid var(--line);padding:22px;}",
    ".ws-panel h3{font-family:var(--font-d);font-size:26px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.02em;color:var(--acid);}",
    ".ws-sub{color:var(--steel);font-size:12px;line-height:1.7;margin:0 0 16px;max-width:70ch;}",
    ".ws-sub b{color:var(--cyan);font-weight:600;}",
    ".ws-methods{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 16px;}",
    ".ws-method{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;font-size:11px;line-height:1.6;color:var(--steel);}",
    ".ws-method h6{margin:0 0 4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--orange);}",
    ".ws-method p{margin:0;}",
    ".ws-bays{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}",
    "@media(max-width:760px){.ws-bays{grid-template-columns:1fr;}.ws-methods{grid-template-columns:1fr;}}",
    ".ws-bay{border:1px solid var(--line);background:var(--panel-2);padding:14px;position:relative;}",
    ".ws-bay .ws-bayhead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;}",
    ".ws-bay h5{margin:0;font-family:var(--font-d);font-size:16px;text-transform:uppercase;}",
    ".ws-bay .ws-sn{font-size:10px;color:var(--steel);letter-spacing:.08em;}",
    ".ws-bay .ws-meta{font-size:11px;color:var(--steel);margin:6px 0 10px;line-height:1.6;}",
    ".ws-bay .ws-note{font-size:11px;color:var(--cyan);margin:0 0 10px;line-height:1.6;min-height:34px;}",
    ".ws-status{font-size:10px;letter-spacing:.14em;text-transform:uppercase;padding:3px 8px;border:1px solid var(--line);}",
    ".ws-status.pending{color:var(--steel);}",
    ".ws-status.running{color:var(--cyan);border-color:var(--cyan);}",
    ".ws-status.clean{color:var(--acid);border-color:var(--acid);}",
    ".ws-status.destroyed{color:var(--orange);border-color:var(--orange);}",
    ".ws-status.failed{color:var(--bad);border-color:var(--bad);}",
    ".ws-mrow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;}",
    ".ws-mrow button{flex:1 1 30%;min-height:44px;background:var(--black);border:1px solid var(--line);color:var(--paper);font:inherit;font-size:11px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;padding:8px 4px;}",
    ".ws-mrow button.on{border-color:var(--acid);color:var(--acid);}",
    ".ws-mrow button:disabled{opacity:.45;cursor:default;}",
    ".ws-bar{height:10px;background:var(--black);border:1px solid var(--line);margin:8px 0;position:relative;overflow:hidden;}",
    ".ws-bar i{position:absolute;inset:0;width:0%;background:var(--cyan);}",
    ".ws-phase{font-size:11px;color:var(--steel);min-height:18px;margin:0 0 6px;}",
    ".ws-grid{display:grid;grid-template-columns:repeat(16,minmax(0,1fr));gap:2px;margin:8px 0;}",
    ".ws-cell{aspect-ratio:1;background:#101515;border:1px solid #1c2423;}",
    ".ws-cell.ok{background:var(--acid);}",
    ".ws-cell.bad{background:var(--bad);}",
    ".ws-cell.check{background:var(--cyan);}",
    ".ws-result{font-size:12px;line-height:1.6;margin:8px 0 0;min-height:38px;}",
    ".ws-result.good{color:var(--acid);}",
    ".ws-result.bad{color:var(--bad);}",
    ".ws-result.warn{color:var(--orange);}",
    ".ws-foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px;align-items:center;}",
    ".ws-foot button{min-height:48px;padding:12px 18px;background:var(--black);border:1px solid var(--line);color:var(--paper);font:inherit;font-size:12px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;}",
    ".ws-foot button.primary{border-color:var(--acid);color:var(--acid);}",
    ".ws-foot button:disabled{opacity:.45;cursor:default;}",
    ".ws-banner{border:1px solid var(--acid);background:rgba(170,255,0,.06);padding:14px 16px;margin-top:16px;display:none;}",
    ".ws-banner h4{margin:0 0 6px;font-family:var(--font-d);font-size:18px;color:var(--acid);text-transform:uppercase;}",
    ".ws-banner p{margin:0;font-size:12px;line-height:1.7;color:var(--paper);}",
    ".ws-summary{font-size:12px;line-height:1.8;color:var(--steel);margin-top:16px;display:none;}",
    ".ws-summary table{width:100%;border-collapse:collapse;font-size:11px;}",
    ".ws-summary td,.ws-summary th{border:1px solid var(--line);padding:6px 8px;text-align:left;}",
    ".ws-summary th{color:var(--cyan);text-transform:uppercase;letter-spacing:.1em;font-size:10px;}"
  ].join("\n");

  var WS_METHODS = {
    CLEAR:   { label: "Clear",   cost: 8,  blurb: "Single overwrite pass over every addressable block, then sampled read-back. Cheap and slow. On flash media the over-provisioned cells are never touched." },
    PURGE:   { label: "Purge",   cost: 4,  blurb: "Firmware-level command (ATA Secure Erase, NVMe Format). Fast and thorough, but the drive has to tell the truth, and verification has to reach every sector." },
    DESTROY: { label: "Destroy", cost: 12, blurb: "Physical shred to 6mm particles. No data survives, no certificate needed, no drive either. The honest answer for dying media." }
  };

  var WS_DRIVES = [
    { id: 0, name: "WD Blue 2TB", sn: "WX81A49N2K77", cap: "2 TB", iface: "SATA 6Gb/s", media: "HDD", blurb: "Retired office spinner. SMART is clean, no grown defects. A textbook candidate." },
    { id: 1, name: "Samsung 970 EVO 1TB", sn: "S5XANX0T991822B", cap: "1 TB", iface: "NVMe Gen3", media: "SSD", blurb: "NVMe stick from a decommissioned workstation. Firmware is current and behaves." },
    { id: 2, name: "Seagate Barracuda 4TB", sn: "Z1D0Q2PW44H9", cap: "4 TB", iface: "SATA 6Gb/s", media: "HDD", blurb: "Click of death adjacent. Grown defect list is long, some sectors will never read again." },
    { id: 3, name: "SanDisk Ultra 512GB", sn: "203917QABX44", cap: "512 GB", iface: "SATA 6Gb/s", media: "SSD", blurb: "Budget SSD with a known firmware quirk: Secure Erase reports success while stale blocks linger in spare cells." }
  ];

  var wsState = WS_DRIVES.map(function () {
    return { method: "CLEAR", status: "pending", running: false, failNote: "", done: false, cert: null };
  });
  var wsEls = {};
  var wsTotalCost = 0;
  function wsOutcome(drive, method) {
    if (method === "DESTROY") {
      return { pass: true, destroy: true, cells: [], note: "Shredded to 6mm particles. Verification not applicable: the media no longer exists." };
    }
    if (drive.id === 2 && method !== "DESTROY") {
      return { pass: false, cells: [7, 23, 58, 91, 120, 141], note: "FAIL: grown-defect sectors are unreadable, so verification cannot confirm them. " + method.charAt(0) + method.slice(1).toLowerCase() + " cannot sanitize what it cannot reach. Per NIST 800-88, this media must be destroyed." };
    }
    if (method === "PURGE" && drive.id === 3) {
      return { pass: false, cells: [44, 45, 100, 101], note: "FAIL: verification found stale data in over-provisioned cells after a successful-looking Secure Erase. The firmware lied. Per NIST 800-88, this media must be destroyed." };
    }
    if (method === "CLEAR" && (drive.media === "SSD")) {
      return { pass: true, caveat: true, cells: [], note: "PASS with caveat: one overwrite pass completed and sampled blocks read back clean. Warning: clear does not sanitize over-provisioned flash cells (NIST 800-88). Certificate carries the caveat." };
    }
    return { pass: true, cells: [], note: "PASS: overwrite pass completed, sampled blocks read back clean. Media is sanitized." };
  }

  function wsStopTimer(s) {
    if (s && s.timer) { clearInterval(s.timer); s.timer = null; }
  }
  function wsStopAll() {
    wsState.forEach(function (s, i) {
      wsStopTimer(s);
      if (s.running) {          /* a close mid-run aborts the run: the bay goes back to pending */
        s.running = false;
        s.status = "pending";
        wsRefreshBay(i);
      }
    });
  }

  function wsRefreshBay(i) {
    var s = wsState[i], els = wsEls.bays[i];
    var st = els.status;
    st.textContent = s.status.toUpperCase().replace("CLEAN", "SANITIZED");
    st.className = "ws-status " + s.status;
    els.methodBtns.forEach(function (b, bi) {
      var m = ["CLEAR", "PURGE", "DESTROY"][bi];
      b.className = (s.method === m && !s.done) ? "on" : "";
      b.disabled = s.running || s.done;
    });
    els.run.disabled = s.running || s.done;
    els.rerun.style.display = (s.done && s.status === "failed") ? "" : "none";
  }

  function wsRefreshAll() {
    for (var i = 0; i < WS_DRIVES.length; i++) wsRefreshBay(i);
    var done = wsState.filter(function (s) { return s.cert; }).length;
    wsEls.dl.disabled = done === 0;
    var allResolved = wsState.every(function (s) { return s.status === "clean" || s.status === "destroyed"; });
    if (allResolved && !wsEls.bannerDone) {
      wsEls.bannerDone = true;
      var clean = wsState.filter(function (s) { return s.status === "clean"; }).length;
      var dest = wsState.filter(function (s) { return s.status === "destroyed"; }).length;
      var cav = wsState.filter(function (s) { return s.cert && s.cert.caveat; }).length;
      wsEls.banner.style.display = "block";
      wsEls.banner.querySelector("p").innerHTML =
        "All four drives are resolved: <b>" + clean + " sanitized</b>, <b>" + dest + " destroyed</b>. " +
        "Total shop cost <b>$" + wsTotalCost + "</b>" +
        (cav ? " (" + cav + " certificate" + (cav > 1 ? "s carry" : " carries") + " a flash caveat)" : "") +
        ". Every serial below has its paperwork. That is the whole job.";
      wsEls.summary.style.display = "block";
      wsBuildSummary();
      wsToast("Shift complete: all drives resolved");
    }
  }

  function wsBuildSummary() {
    var html = "<table><tr><th>Drive</th><th>Serial</th><th>Method</th><th>Result</th><th>Cost</th></tr>";
    WS_DRIVES.forEach(function (d, i) {
      var s = wsState[i];
      var res = s.status === "clean" ? (s.cert && s.cert.caveat ? "Sanitized (flash caveat)" : "Sanitized") :
                s.status === "destroyed" ? "Destroyed" : "Failed";
      html += "<tr><td>" + wsEsc(d.name) + "</td><td>" + wsEsc(d.sn) + "</td><td>" +
        wsEsc(WS_METHODS[s.cert ? s.cert.method : "CLEAR"].label) + "</td><td>" + wsEsc(res) +
        "</td><td>$" + (s.cert ? s.cert.cost : 0) + "</td></tr>";
    });
    html += "</table>";
    wsEls.summary.innerHTML = "<h4>Shift summary</h4>" + html;
  }

  function wsRun(i) {
    var d = WS_DRIVES[i], s = wsState[i], els = wsEls.bays[i];
    if (s.running || s.done) return;
    s.running = true;
    s.status = "running";
    s.failNote = "";
    var m = WS_METHODS[s.method];
    wsRefreshBay(i);
    els.result.className = "ws-result";
    els.result.textContent = "";

    var outcome = wsOutcome(d, s.method);
    var totalTicks = s.method === "PURGE" ? 26 : s.method === "DESTROY" ? 34 : 60;
    var tick = 0;
    var cells = els.cells;
    for (var ci = 0; ci < cells.length; ci++) {
      cells[ci].className = "ws-cell";
    }

    var phases = s.method === "CLEAR"
      ? ["Seating drive in the write blocker...", "Overwrite pass 1 of 1: writing zeros to every addressable block...", "Read-back verification: sampling 160 blocks..."]
      : s.method === "PURGE"
      ? ["Issuing firmware sanitize command...", "Waiting on the controller (do not power-cycle)...", "Full verification: reading every block..."]
      : ["Feeding drive to the shredder...", "Grinding to 6mm particles...", "Sweeping up the confetti..."];

    wsStopTimer(s);
    s.timer = setInterval(function () {
      tick++;
      var pct = Math.min(100, Math.round((tick / totalTicks) * 100));
      els.barFill.style.width = pct + "%";
      var ph = tick < totalTicks * 0.35 ? 0 : tick < totalTicks * 0.8 ? 1 : 2;
      els.phase.textContent = phases[ph] + " " + pct + "%";

      if (tick >= totalTicks * 0.55 && tick < totalTicks) {
        var lit = Math.floor(((tick - totalTicks * 0.55) / (totalTicks * 0.45)) * cells.length);
        for (var k = 0; k < cells.length; k++) {
          if (k < lit && cells[k].className === "ws-cell") {
            var isBad = outcome.cells.indexOf(k) !== -1;
            cells[k].className = isBad ? "ws-cell bad" : "ws-cell ok";
          }
        }
      }

      if (tick >= totalTicks) {
        wsStopTimer(s);
        wsFinish(i, outcome);
      }
    }, 70);
  }

  function wsFinish(i, outcome) {
    var d = WS_DRIVES[i], s = wsState[i], els = wsEls.bays[i];
    var m = WS_METHODS[s.method];
    s.running = false;
    wsTotalCost += m.cost;
    els.barFill.style.width = "100%";
    els.phase.textContent = "Done.";
    if (outcome.pass) {
      s.done = true;
      s.status = outcome.destroy ? "destroyed" : "clean";
      s.cert = { method: s.method, cost: m.cost, caveat: !!outcome.caveat, note: outcome.note };
      els.result.className = "ws-result " + (outcome.caveat ? "warn" : "good");
      els.result.textContent = outcome.note + " Cost: $" + m.cost + ".";
      wsToast(d.name + (outcome.destroy ? ": destroyed" : ": sanitized"));
    } else {
      s.status = "failed";
      s.done = true;
      s.failNote = outcome.note;
      els.result.className = "ws-result bad";
      els.result.textContent = outcome.note + " This drive is not resolved: pick DESTROY and run again.";
      wsToast(d.name + ": " + s.method.toLowerCase() + " failed");
    }
    wsRefreshBay(i);
    wsRefreshAll();
  }

  function wsRerun(i) {
    var s = wsState[i], els = wsEls.bays[i];
    wsStopTimer(s);
    s.done = false;
    s.status = "pending";
    s.running = false;
    s.cert = null;
    s.failNote = "";
    s.method = "DESTROY";
    els.barFill.style.width = "0%";
    els.phase.textContent = "";
    els.result.className = "ws-result";
    els.result.textContent = "";
    els.cells.forEach(function (c) { c.className = "ws-cell"; });
    wsRefreshBay(i);
  }

  function wsDownload() {
    var lines = [];
    lines.push("OLD IRON INTAKE: DRIVE SANITIZATION CERTIFICATES");
    lines.push("Bench: The Wipe Station, The Proving Ground");
    lines.push("Standard: NIST Special Publication 800-88 Rev. 1");
    lines.push("Date: " + new Date().toISOString().slice(0, 10));
    lines.push("Operator: Proving Ground");
    lines.push("");
    WS_DRIVES.forEach(function (d, i) {
      var s = wsState[i];
      if (!s.cert) return;
      var m = WS_METHODS[s.cert.method];
      lines.push("----------------------------------------");
      if (s.cert.method === "DESTROY") {
        lines.push("CERTIFICATE OF DESTRUCTION");
      } else {
        lines.push("CERTIFICATE OF SANITIZATION");
      }
      lines.push("Drive: " + d.name + " (" + d.cap + ", " + d.iface + ", " + d.media + ")");
      lines.push("Serial: " + d.sn);
      lines.push("Method: " + m.label + " (" + s.cert.method + ")");
      lines.push("Verification: " + (s.cert.method === "DESTROY" ? "not applicable, media shredded" : "read-back, blocks verified"));
      if (s.cert.caveat) lines.push("CAVEAT: Clear on flash media does not sanitize over-provisioned cells (NIST 800-88).");
      lines.push("Result: " + (s.cert.method === "DESTROY" ? "destroyed" : "sanitized") + ", $" + s.cert.cost);
      lines.push("");
    });
    lines.push("----------------------------------------");
    lines.push("Total shop cost: $" + wsTotalCost);
    lines.push("End of certificates.");
    var blob = new Blob([lines.join("\n")], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = "wipe-station-certificates.txt";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      (window.URL || window.webkitURL).revokeObjectURL(a.href);
      a.remove();
    }, 500);
    wsToast("Certificates downloaded");
  }

  function wsBuild() {
    var box = document.querySelector(".dossier .actions");
    if (!box || ws$("wsBtn")) return;

    var st = document.createElement("style");
    st.textContent = WS_CSS;
    document.head.appendChild(st);

    var b = wsEl("button", "secondary", "Run the Wipe Station");
    b.id = "wsBtn";
    b.addEventListener("click", function () {
      ws$("wsOverlay").classList.add("open");
    });
    box.appendChild(b);

    var ov = wsEl("div", "ws-overlay");
    ov.id = "wsOverlay";
    var panel = wsEl("div", "ws-panel");
    panel.innerHTML =
      "<h3>The Wipe Station</h3>" +
      '<p class="ws-sub">The intake bench for <b>OLD IRON</b>: every retired drive gets a method decision, ' +
      "verified passes, and a per-serial certificate before it leaves the shop. " +
      "Pick <b>Clear</b>, <b>Purge</b>, or <b>Destroy</b> per drive, run it, and watch verification. " +
      "Bad media cannot be purged, it can only be destroyed. That is the whole puzzle.</p>";
    ov.appendChild(panel);
    document.body.appendChild(ov);

    var mg = wsEl("div", "ws-methods");
    Object.keys(WS_METHODS).forEach(function (k) {
      var m = WS_METHODS[k];
      mg.appendChild(wsEl("div", "ws-method",
        "<h6>" + m.label + " ($" + m.cost + ")</h6><p>" + wsEsc(m.blurb) + "</p>"));
    });
    panel.appendChild(mg);

    var bays = wsEl("div", "ws-bays");
    wsEls.bays = [];
    WS_DRIVES.forEach(function (d, i) {
      var bay = wsEl("div", "ws-bay");
      var head = wsEl("div", "ws-bayhead");
      head.appendChild(wsEl("h5", null, wsEsc(d.name)));
      var status = wsEl("span", "ws-status pending", "PENDING");
      head.appendChild(status);
      bay.appendChild(head);
      bay.appendChild(wsEl("p", "ws-sn", "S/N " + wsEsc(d.sn) + " &middot; " + wsEsc(d.cap) + " &middot; " + wsEsc(d.iface) + " &middot; " + wsEsc(d.media)));
      bay.appendChild(wsEl("p", "ws-note", wsEsc(d.blurb)));

      var mrow = wsEl("div", "ws-mrow");
      var btns = [];
      ["CLEAR", "PURGE", "DESTROY"].forEach(function (mk, bi) {
        var mb = wsEl("button", bi === 0 ? "on" : "", WS_METHODS[mk].label + " $" + WS_METHODS[mk].cost);
        mb.addEventListener("click", function () {
          var s = wsState[i];
          if (s.running || s.done) return;
          s.method = mk;
          wsRefreshBay(i);
        });
        btns.push(mb);
        mrow.appendChild(mb);
      });
      bay.appendChild(mrow);

      var phase = wsEl("p", "ws-phase", "");
      bay.appendChild(phase);
      var bar = wsEl("div", "ws-bar");
      var fill = wsEl("i", null, "");
      bar.appendChild(fill);
      bay.appendChild(bar);

      var grid = wsEl("div", "ws-grid");
      var cells = [];
      for (var c = 0; c < 160; c++) {
        var cell = wsEl("div", "ws-cell", "");
        grid.appendChild(cell);
        cells.push(cell);
      }
      bay.appendChild(grid);

      var result = wsEl("p", "ws-result", "");
      bay.appendChild(result);

      var brow = wsEl("div", "ws-mrow");
      var run = wsEl("button", "", "Run sanitization");
      run.style.flex = "1 1 100%";
      run.addEventListener("click", function () { wsRun(i); });
      brow.appendChild(run);
      var rerun = wsEl("button", "", "Reset bay");
      rerun.style.display = "none";
      rerun.style.flex = "1 1 100%";
      rerun.addEventListener("click", function () { wsRerun(i); });
      brow.appendChild(rerun);
      bay.appendChild(brow);

      bays.appendChild(bay);
      wsEls.bays.push({ status: status, methodBtns: btns, run: run, rerun: rerun, phase: phase, barFill: fill, cells: cells, result: result });
    });
    panel.appendChild(bays);

    wsEls.banner = wsEl("div", "ws-banner",
      "<h4>Shift complete</h4><p></p>");
    panel.appendChild(wsEls.banner);
    wsEls.bannerDone = false;

    wsEls.summary = wsEl("div", "ws-summary", "");
    panel.appendChild(wsEls.summary);

    var foot = wsEl("div", "ws-foot");
    var dl = wsEl("button", "primary", "Download wipe certificates");
    dl.disabled = true;
    dl.addEventListener("click", wsDownload);
    wsEls.dl = dl;
    var close = wsEl("button", null, "Close");
    close.addEventListener("click", function () {
      wsStopAll();
      ws$("wsOverlay").classList.remove("open");
    });
    foot.appendChild(dl);
    foot.appendChild(close);
    panel.appendChild(foot);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", wsBuild);
    } else {
      wsBuild();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      WS: {
        outcome: wsOutcome,
        DRIVES: WS_DRIVES,
        METHODS: WS_METHODS
      }
    });
  }

})();
/* ============================================================
   THE PIPELINE HAZARD LAB
   A classic five-stage RV32I pipeline (IF/ID/EX/MEM/WB) with real
   forwarding, real load-use and control stalls, and a swappable
   branch predictor. Edit the program, flip forwarding, swap the
   predictor, and watch cycles, stalls, and forwarding arcs move.
   Three trials with cycle budgets, plus a downloadable profile
   card. Companion bench to the Silicon Anvil, built for the
   portfolio's RISC-V focus.
   Pure sim + assembler between PH-SIM-BEGIN/END are shared
   verbatim with the node test harness.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- local helpers (never touch outer scope) ---------- */
  var ph$ = function (id) { return document.getElementById(id); };
  function phEl(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function phToast(msg) {
    if (typeof window.showToast === "function") { window.showToast(msg); return; }
    var t = ph$("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 1800);
  }
  function phEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function phHex(n) {
    return "0x" + ("00000000" + ((n | 0) >>> 0).toString(16)).slice(-8);
  }

  /* ---------- injected styles ---------- */
  var PH_CSS = [
    ".ph-overlay{position:fixed;inset:0;background:rgba(4,7,7,.93);z-index:95;display:none;overflow-y:auto;padding:18px 12px;}",
    ".ph-overlay.open{display:block;}",
    ".ph-panel{max-width:1140px;margin:0 auto;background:var(--panel);border:1px solid var(--line);padding:22px;}",
    ".ph-panel h3{font-family:var(--font-d);font-size:26px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.02em;color:var(--acid);}",
    ".ph-sub{font-size:12px;line-height:1.65;color:var(--steel);margin:0 0 14px;max-width:76ch;}",
    ".ph-sub a{color:var(--cyan);text-decoration:none;border-bottom:1px dotted var(--cyan);}",
    ".ph-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}",
    ".ph-tab{background:var(--panel-2);border:1px solid var(--line);color:var(--paper);font:inherit;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:10px 14px;cursor:pointer;min-height:44px;}",
    ".ph-tab.on{border-color:var(--acid);color:var(--acid);}",
    ".ph-brief{border:1px dashed var(--orange);background:rgba(255,107,44,.05);padding:12px 14px;margin-bottom:12px;font-size:12px;line-height:1.6;color:var(--paper);display:none;}",
    ".ph-brief.show{display:block;}",
    ".ph-brief b{color:var(--orange);}",
    ".ph-brief .par{color:var(--acid);}",
    ".ph-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;}",
    ".ph-toolbar .secondary{min-height:44px;}",
    ".ph-toolbar select{background:var(--black,#0a0f0e);border:1px solid var(--line);color:var(--paper);font:inherit;font-size:11px;padding:10px 8px;min-height:44px;}",
    ".ph-toolbar .lbl{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--steel);}",
    ".ph-main{display:grid;grid-template-columns:minmax(300px,5fr) 7fr;gap:14px;}",
    ".ph-edhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}",
    ".ph-edhead h4,.ph-righth h4{margin:0;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".ph-edhead .secondary{min-height:36px;font-size:11px;padding:6px 10px;}",
    ".ph-edwrap{display:grid;grid-template-columns:40px 1fr;border:1px solid var(--line);background:var(--panel);}",
    ".ph-gutter{background:var(--panel-2);color:var(--steel);font-family:var(--font-m);font-size:12px;line-height:1.7;padding:10px 0;text-align:center;user-select:none;overflow:hidden;}",
    ".ph-gutter div{height:20.4px;}",
    ".ph-gutter div.hot{color:var(--ember);background:rgba(255,107,44,.18);cursor:pointer;}",
    ".ph-ed{width:100%;min-height:340px;background:transparent;border:0;color:var(--paper);font-family:var(--font-m);font-size:12px;line-height:1.7;padding:10px 12px;resize:vertical;white-space:pre;}",
    ".ph-ed:focus{outline:1px solid var(--cyan);}",
    ".ph-errors{font-size:11px;color:var(--bad);margin:6px 0 0;line-height:1.6;display:none;}",
    ".ph-errors.show{display:block;}",
    ".ph-blame{margin-top:10px;font-size:11px;line-height:1.7;color:var(--steel);}",
    ".ph-blame .brow{cursor:pointer;padding:4px 6px;border-left:2px solid var(--orange);margin-bottom:4px;background:rgba(255,107,44,.05);}",
    ".ph-blame .brow:hover{background:rgba(255,107,44,.12);}",
    ".ph-blame .brow b{color:var(--orange);}",
    ".ph-strip{display:flex;align-items:stretch;gap:4px;margin-bottom:10px;overflow-x:auto;padding-bottom:4px;}",
    ".ph-stage{flex:1 1 0;min-width:118px;border:1px solid var(--line);background:var(--panel-2);padding:8px;min-height:96px;}",
    ".ph-stage h5{margin:0 0 6px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;}",
    ".ph-stage.s0 h5{color:var(--cyan);}.ph-stage.s1 h5{color:var(--acid);}.ph-stage.s2 h5{color:var(--orange);}.ph-stage.s3 h5{color:#c9a2ff;}.ph-stage.s4 h5{color:var(--mint);}",
    ".ph-stage .inst{font-family:var(--font-m);font-size:11px;line-height:1.5;color:var(--paper);overflow-wrap:anywhere;}",
    ".ph-stage .empty{color:var(--steel);font-size:11px;}",
    ".ph-stage.bubble{border-color:var(--orange);}",
    ".ph-stage.bubble .inst{color:var(--orange);}",
    ".ph-stage.flushed{border-color:var(--bad);}",
        ".ph-fwdtag{display:inline-block;font-size:9px;letter-spacing:.06em;color:#0a0f0e;background:var(--acid);padding:1px 5px;margin:2px 2px 0 0;font-family:var(--font-m);}",
    ".ph-arrow{align-self:center;color:var(--steel);font-size:16px;flex:none;}",
    ".ph-tracewrap{border:1px solid var(--line);overflow:auto;max-height:300px;background:var(--panel);}",
    ".ph-trace{border-collapse:collapse;font-family:var(--font-m);font-size:10px;white-space:nowrap;}",
    ".ph-trace th,.ph-trace td{border:1px solid var(--panel);padding:3px 7px;text-align:center;}",
    ".ph-trace th{position:sticky;top:0;background:var(--panel-2);color:var(--steel);z-index:2;}",
    ".ph-trace td.pc{position:sticky;left:0;background:var(--panel-2);color:var(--paper);text-align:left;z-index:1;max-width:220px;overflow:hidden;text-overflow:ellipsis;}",
    ".ph-trace td.c-IF{color:var(--cyan);}.ph-trace td.c-ID{color:var(--acid);}.ph-trace td.c-EX{color:var(--orange);font-weight:bold;}.ph-trace td.c-MEM{color:#c9a2ff;}.ph-trace td.c-WB{color:var(--mint);}",
    ".ph-trace tr.killed td{opacity:.35;text-decoration:line-through;}",
    ".ph-trace td.cur{background:rgba(199,255,56,.10);}",
    ".ph-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px;margin:14px 0;}",
    ".ph-stat{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;}",
    ".ph-stat h4{margin:0 0 4px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".ph-stat p{margin:0;font-family:var(--font-m);font-size:17px;color:var(--paper);}",
    ".ph-stat p.warn{color:var(--orange);}",
    ".ph-stat p.good{color:var(--acid);}",
    ".ph-regmem{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:6px;}",
    ".ph-regmem details{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;}",
    ".ph-regmem summary{cursor:pointer;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);min-height:44px;display:flex;align-items:center;}",
    ".ph-regtable{font-family:var(--font-m);font-size:10px;line-height:1.7;color:var(--paper);columns:2;}",
    ".ph-regtable .rz{color:var(--steel);}",
    ".ph-regtable .rhot{color:var(--acid);}",
    ".ph-banner{border:1px solid var(--acid);background:rgba(199,255,56,.06);padding:14px 16px;margin:14px 0;display:none;}",
    ".ph-banner.show{display:block;}",
    ".ph-banner h4{margin:0 0 6px;font-family:var(--font-d);font-size:18px;text-transform:uppercase;color:var(--acid);}",
    ".ph-banner p{margin:0;font-size:12px;line-height:1.6;color:var(--paper);}",
    ".ph-banner.fail{border-color:var(--bad);background:rgba(255,93,93,.06);}",
    ".ph-banner.fail h4{color:var(--bad);}",
    ".ph-foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;}",
    ".ph-foot .secondary,.ph-foot .primary{flex:1;min-height:44px;}",
    ".ph-foot .primary{border-color:var(--acid);color:var(--acid);}",
    ".ph-overlay .primary{width:auto;min-width:0;margin-top:0;background:transparent;border:1px solid var(--acid);color:var(--acid);font-family:inherit;font-size:11px;font-weight:400;letter-spacing:.06em;padding:10px 12px;overflow:visible;}",
    ".ph-overlay .primary::after{display:none;}",
    ".ph-overlay button{white-space:normal;line-height:1.5;overflow-wrap:anywhere;}",
    ".ph-toolbar .primary{min-width:0;}",
    "@media (max-width:900px){",
    ".ph-main{grid-template-columns:1fr;}",
    ".ph-regmem{grid-template-columns:1fr;}",
    ".ph-panel h3{font-size:20px;}",
    ".ph-overlay{padding:10px 8px;}",
    ".ph-panel{padding:14px;}",
    ".ph-righth{order:-1;}",
    ".ph-strip{flex-direction:column;align-items:stretch;overflow:visible;padding-bottom:0;}",
    ".ph-stage{flex:none;min-width:0;min-height:0;}",
    ".ph-arrow{transform:rotate(90deg);}",
    ".ph-ed{font-size:16px;line-height:1.6;min-height:260px;}",
    ".ph-gutter{font-size:16px;line-height:1.6;}",
    ".ph-gutter div{height:25.6px;}",
    ".ph-toolbar select{font-size:16px;}",
    ".ph-regtable{columns:1;}",
    ".ph-foot{flex-direction:column;}",
    ".ph-foot .secondary,.ph-foot .primary{flex:none;width:100%;}",
    "}"
  ].join("\n");

/* PH-SIM-BEGIN */
var PH_MEM_WORDS = 256;

var PH_ABI = { zero: 0, ra: 1, sp: 2, gp: 3, tp: 4, t0: 5, t1: 6, t2: 7, s0: 8, fp: 8, s1: 9, a0: 10, a1: 11, a2: 12, a3: 13, a4: 14, a5: 15, a6: 16, a7: 17, s2: 18, s3: 19, s4: 20, s5: 21, s6: 22, s7: 23, s8: 24, s9: 25, s10: 26, s11: 27, t3: 28, t4: 29, t5: 30, t6: 31 };
var PH_ABI_BY_NUM = ["zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2", "s0", "s1", "a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "t3", "t4", "t5", "t6"];

function phRegName(n) { return PH_ABI_BY_NUM[n] || ("x" + n); }

function phRegNum(tok, line, errors) {
  tok = String(tok).trim();
  var n, m = /^x(\d+)$/.exec(tok);
  if (m) n = parseInt(m[1], 10);
  else if (Object.prototype.hasOwnProperty.call(PH_ABI, tok)) n = PH_ABI[tok];
  if (n === undefined || n < 0 || n > 31) {
    errors.push({ line: line, msg: "bad register '" + tok + "'" });
    return 0;
  }
  return n;
}

function phImmNum(tok, line, errors, lo, hi, what) {
  tok = String(tok).trim();
  var v;
  if (/^0x[0-9a-fA-F]+$/.test(tok)) v = parseInt(tok, 16);
  else if (/^-?\d+$/.test(tok)) v = parseInt(tok, 10);
  else { errors.push({ line: line, msg: "bad immediate '" + tok + "'" }); return 0; }
  if (v < lo || v > hi) errors.push({ line: line, msg: (what || "immediate") + " " + v + " out of range [" + lo + ", " + hi + "]" });
  return v | 0;
}

/* op -> format. R: rd,rs1,rs2 | I: rd,rs1,imm | Is: rd,rs1,shamt |
   L: rd,off(rs1) | S: rs2,off(rs1) | B: rs1,rs2,target | J: rd,target | N: none */
var PH_FMT = {
  add: "R", sub: "R", and: "R", or: "R", xor: "R", sll: "R", srl: "R",
  addi: "I", andi: "I", ori: "I", xori: "I", slli: "Is", srli: "Is",
  lw: "L", sw: "S",
  beq: "B", bne: "B", blt: "B", bge: "B",
  jal: "J", nop: "N"
};

function phAssemble(src) {
  var errors = [], instrs = [], labels = {};
  var rawLines = String(src).split("\n");
  var cleaned = [];
  var i, ln;
  for (i = 0; i < rawLines.length; i++) {
    var line = rawLines[i];
    var c = line.indexOf("#");
    var c2 = line.indexOf("//");
    if (c2 >= 0 && (c < 0 || c2 < c)) c = c2;
    var c3 = line.indexOf(";");
    if (c3 >= 0 && (c < 0 || c3 < c)) c = c3;
    if (c >= 0) line = line.slice(0, c);
    cleaned.push({ line: i + 1, text: line });
  }
  /* pass 1: labels */
  var pc = 0;
  var items = [];
  for (i = 0; i < cleaned.length; i++) {
    var t = cleaned[i].text, lineNo = cleaned[i].line;
    var lm = /^\s*([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(t);
    if (lm) {
      if (Object.prototype.hasOwnProperty.call(labels, lm[1])) {
        errors.push({ line: lineNo, msg: "duplicate label '" + lm[1] + "'" });
      } else labels[lm[1]] = pc;
      t = lm[2];
    }
    t = t.trim();
    if (!t) continue;
    items.push({ line: lineNo, pc: pc, text: t });
    pc += 4;
  }
  /* pass 2: encode */
  for (i = 0; i < items.length; i++) {
    (function (it) {
      var parts = it.text.split(/\s+/);
      var op = parts[0].toLowerCase();
      var rest = it.text.slice(parts[0].length).trim();
      /* pseudos */
      if (op === "li" || op === "mv" || op === "j") {
        var a = rest.split(",").map(function (s) { return s.trim(); });
        if (op === "li" && a.length === 2) { op = "addi"; rest = a[0] + ", x0, " + a[1]; }
        else if (op === "mv" && a.length === 2) { op = "addi"; rest = a[0] + ", " + a[1] + ", 0"; }
        else if (op === "j" && a.length === 1) { op = "jal"; rest = "x0, " + a[0]; }
        else { errors.push({ line: it.line, msg: "bad pseudo-instruction '" + it.text + "'" }); return; }
        parts = [op];
      }
      var fmt = PH_FMT[op];
      if (!fmt) { errors.push({ line: it.line, msg: "unknown op '" + parts[0] + "'" }); return; }
      var ins = { pc: it.pc, line: it.line, op: op, rd: 0, rs1: -1, rs2: -1, imm: 0, target: 0, text: "" };
      function ops(n) {
        var p = rest.split(",");
        if (p.length !== n) { errors.push({ line: it.line, msg: op + " wants " + n + " operands" }); return null; }
        return p.map(function (s) { return s.trim(); });
      }
      var o;
      if (fmt === "R") {
        o = ops(3); if (!o) return;
        ins.rd = phRegNum(o[0], it.line, errors);
        ins.rs1 = phRegNum(o[1], it.line, errors);
        ins.rs2 = phRegNum(o[2], it.line, errors);
      } else if (fmt === "I" || fmt === "Is") {
        o = ops(3); if (!o) return;
        ins.rd = phRegNum(o[0], it.line, errors);
        ins.rs1 = phRegNum(o[1], it.line, errors);
        ins.imm = fmt === "Is" ? phImmNum(o[2], it.line, errors, 0, 31, "shift amount")
                               : phImmNum(o[2], it.line, errors, -2048, 2047, "immediate");
      } else if (fmt === "L" || fmt === "S") {
        o = ops(2); if (!o) return;
        var mm = /^(-?0x[0-9a-fA-F]+|-?\d+)\(\s*([A-Za-z0-9_]+)\s*\)$/.exec(o[1]);
        if (!mm) { errors.push({ line: it.line, msg: "bad memory operand '" + o[1] + "', use off(reg)" }); return; }
        ins.imm = phImmNum(mm[1], it.line, errors, -2048, 2047, "offset");
        ins.rs1 = phRegNum(mm[2], it.line, errors);
        if (fmt === "L") ins.rd = phRegNum(o[0], it.line, errors);
        else ins.rs2 = phRegNum(o[0], it.line, errors);
      } else if (fmt === "B") {
        o = ops(3); if (!o) return;
        ins.rs1 = phRegNum(o[0], it.line, errors);
        ins.rs2 = phRegNum(o[1], it.line, errors);
        ins.target = phTarget(o[2], it, labels, errors);
      } else if (fmt === "J") {
        o = ops(2); if (!o) return;
        ins.rd = phRegNum(o[0], it.line, errors);
        ins.target = phTarget(o[1], it, labels, errors);
      }
      if (fmt === "B" || fmt === "J") {
        if (ins.target % 4 !== 0 || ins.target < 0) {
          errors.push({ line: it.line, msg: "branch target must be a non-negative multiple of 4" });
        }
      }
      ins.isLoad = (op === "lw");
      ins.isStore = (op === "sw");
      ins.isBranch = (fmt === "B");
      ins.isJump = (op === "jal");
      ins.writesRd = (fmt === "R" || fmt === "I" || fmt === "Is" || fmt === "L" || op === "jal");
      ins.usesRs2 = (fmt === "R" || fmt === "S" || fmt === "B");
      ins.rs = [];
      if (ins.rs1 >= 0) ins.rs.push(ins.rs1);
      if (ins.usesRs2 && ins.rs2 >= 0) ins.rs.push(ins.rs2);
      ins.text = phNorm(ins);
      instrs.push(ins);
    })(items[i]);
  }
  return { ok: errors.length === 0 && instrs.length > 0, instrs: instrs, errors: errors };
}

function phTarget(tok, it, labels, errors) {
  tok = String(tok).trim();
  if (Object.prototype.hasOwnProperty.call(labels, tok)) return labels[tok];
  if (/^-?0x[0-9a-fA-F]+$/.test(tok) || /^-?\d+$/.test(tok)) {
    var v = /^0x/i.test(tok) ? parseInt(tok, 16) : parseInt(tok, 10);
    return (it.pc + v) | 0; /* pc-relative byte offset, like the machine encoding */
  }
  errors.push({ line: it.line, msg: "unknown label '" + tok + "'" });
  return it.pc + 4;
}

function phNorm(ins) {
  var r = phRegName;
  switch (ins.op) {
    case "lw": return "lw " + r(ins.rd) + ", " + ins.imm + "(" + r(ins.rs1) + ")";
    case "sw": return "sw " + r(ins.rs2) + ", " + ins.imm + "(" + r(ins.rs1) + ")";
    case "beq": case "bne": case "blt": case "bge":
      return ins.op + " " + r(ins.rs1) + ", " + r(ins.rs2) + ", ->" + ins.target;
    case "jal": return "jal " + r(ins.rd) + ", ->" + ins.target;
    case "nop": return "nop";
    default:
      if (PH_FMT[ins.op] === "R") return ins.op + " " + r(ins.rd) + ", " + r(ins.rs1) + ", " + r(ins.rs2);
      return ins.op + " " + r(ins.rd) + ", " + r(ins.rs1) + ", " + ins.imm;
  }
}

/* ---------- pipeline simulator (pure, no DOM) ---------- */
function phNewSim(instrs, opts) {
  opts = opts || {};
  var s = {
    instrs: instrs,
    fwd: opts.fwd !== false,
    predictor: opts.predictor || "2bit",
    regs: [], mem: [],
    pipe: [null, null, null, null, null],
    pcNext: 0, nextId: 1,
    cycle: 0, retired: 0,
    dataStalls: 0, controlStalls: 0, forwards: 0,
    preds: 0, predHit: 0,
    bht: {},
    trace: [],
    blame: {},
    bubbleEX: false,
    lastEvents: [],
    done: false, trap: ""
  };
  var i;
  for (i = 0; i < 32; i++) s.regs.push(0);
  for (i = 0; i < PH_MEM_WORDS; i++) s.mem.push(0);
  if (opts.memInit) {
    for (var a in opts.memInit) {
      if (Object.prototype.hasOwnProperty.call(opts.memInit, a)) {
        var w = parseInt(a, 10);
        if (w >= 0 && w < PH_MEM_WORDS) s.mem[w] = opts.memInit[a] | 0;
      }
    }
  }
  return s;
}

function phBlame(s, pc, kind) {
  var b = s.blame[pc];
  if (!b) { b = { data: 0, control: 0 }; s.blame[pc] = b; }
  b[kind]++;
}

function phPredict(s, pc) {
  if (s.predictor === "t") return true;
  if (s.predictor === "2bit") return (s.bht[pc] === undefined ? 1 : s.bht[pc]) >= 2;
  return false; /* "nt" */
}

function phFetch(s) {
  var ii = s.pcNext / 4;
  var ins = s.instrs[ii];
  var slot = {
    id: s.nextId++, ii: ii, pc: ins.pc, line: ins.line, text: ins.text,
    op: ins.op, rd: ins.rd, rs1: ins.rs1, rs2: ins.rs2, imm: ins.imm,
    target: ins.target, rs: ins.rs.slice(),
    isLoad: ins.isLoad, isStore: ins.isStore, isBranch: ins.isBranch,
    isJump: ins.isJump, writesRd: ins.writesRd, usesRs2: ins.usesRs2,
    predTaken: false, predTarget: ins.pc + 4,
    res: 0, sdata: 0, killed: false, killCycle: -1
  };
  if (ins.isBranch) {
    slot.predTaken = phPredict(s, ins.pc);
    slot.predTarget = slot.predTaken ? ins.target : ins.pc + 4;
  }
  s.pcNext = slot.predTarget;
  slot.row = s.trace.length;
  s.trace.push({ id: slot.id, pc: ins.pc, line: ins.line, text: ins.text, cells: {}, killed: false });
  return slot;
}

/* youngest producer of rs among the stages ahead, or null */
function phProducer(slot, rs, ahead) {
  var k;
  for (k = 0; k < ahead.length; k++) {
    var p = ahead[k].slot;
    if (p && !p.killed && p.writesRd && p.rd === rs && p.rd !== 0) {
      return { slot: p, stage: ahead[k].stage };
    }
  }
  return null;
}

/* ID-stage hazard check. ahead = [{stage:'EX',slot:oEX},{stage:'MEM',slot:oMEM},{stage:'WB',slot:oWB}] */
function phDetect(s, idSlot, ahead) {
  var r;
  for (r = 0; r < idSlot.rs.length; r++) {
    var rs = idSlot.rs[r];
    if (rs === 0) continue;
    var pr = phProducer(idSlot, rs, ahead);
    if (!pr) continue;
    if (s.fwd) {
      if (pr.stage === "EX" && pr.slot.isLoad) {
        return { kind: "load-use", rs: rs, producer: pr.slot };
      }
    } else {
      if (pr.stage === "EX" || pr.stage === "MEM") {
        return { kind: "raw", rs: rs, producer: pr.slot };
      }
    }
  }
  return null;
}

/* resolve one operand inside EX, applying forwarding muxes */
function phOpVal(s, slot, rs, oMEM, oWB, ev) {
  if (rs <= 0) return 0;
  var pr = phProducer(slot, rs, [{ stage: "EX", slot: oMEM }, { stage: "WB", slot: oWB }]);
  if (pr && s.fwd) {
    s.forwards++;
    ev.push({ t: "fwd", from: pr.stage, rs: rs, id: slot.id, pc: slot.pc });
    return pr.slot.res | 0;
  }
  return s.regs[rs] | 0;
}

function phTrap(s, msg) {
  s.done = true;
  s.trap = msg;
  return [];
}

function phStep(s) {
  var ev = [];
  s.lastEvents = ev;
  s.bubbleEX = false;
  if (s.done) return ev;
  var oIF = s.pipe[0], oID = s.pipe[1], oEX = s.pipe[2], oMEM = s.pipe[3], oWB = s.pipe[4];
  var cycle = s.cycle;
  var STAGE = ["IF", "ID", "EX", "MEM", "WB"];

  /* 1. WB: retire */
  if (oWB && !oWB.killed) {
    if (oWB.writesRd && oWB.rd !== 0) s.regs[oWB.rd] = oWB.res | 0;
    s.retired++;
  }
  /* 2. MEM -> WB */
  var newWB = null;
  if (oMEM && !oMEM.killed) {
    if (oMEM.isLoad) {
      var la = oMEM.res | 0;
      if (la % 4 !== 0 || la < 0 || la >= PH_MEM_WORDS * 4) return phTrap(s, "load address fault at 0x" + ((la >>> 0).toString(16)));
      oMEM.res = s.mem[la >> 2] | 0;
    } else if (oMEM.isStore) {
      var sa = oMEM.res | 0;
      if (sa % 4 !== 0 || sa < 0 || sa >= PH_MEM_WORDS * 4) return phTrap(s, "store address fault at 0x" + ((sa >>> 0).toString(16)));
      s.mem[sa >> 2] = oMEM.sdata | 0;
    }
    newWB = oMEM;
  }
  /* 3. EX -> MEM, with branch/jump resolution */
  var newMEM = null, flush = false, flushTarget = 0;
  if (oEX && !oEX.killed) {
    var v1 = phOpVal(s, oEX, oEX.rs1, oMEM, oWB, ev);
    var v2 = oEX.usesRs2 ? phOpVal(s, oEX, oEX.rs2, oMEM, oWB, ev) : 0;
    var op = oEX.op, res = 0;
    if (op === "add") res = (v1 + v2) | 0;
    else if (op === "sub") res = (v1 - v2) | 0;
    else if (op === "and") res = (v1 & v2) | 0;
    else if (op === "or") res = (v1 | v2) | 0;
    else if (op === "xor") res = (v1 ^ v2) | 0;
    else if (op === "sll") res = (v1 << (v2 & 31)) | 0;
    else if (op === "srl") res = (v1 >>> (v2 & 31)) | 0;
    else if (op === "addi") res = (v1 + oEX.imm) | 0;
    else if (op === "andi") res = (v1 & oEX.imm) | 0;
    else if (op === "ori") res = (v1 | oEX.imm) | 0;
    else if (op === "xori") res = (v1 ^ oEX.imm) | 0;
    else if (op === "slli") res = (v1 << (oEX.imm & 31)) | 0;
    else if (op === "srli") res = (v1 >>> (oEX.imm & 31)) | 0;
    else if (op === "lw" || op === "sw") {
      res = (v1 + oEX.imm) | 0;
      if (oEX.isStore) oEX.sdata = v2 | 0;
    } else if (op === "jal") {
      res = (oEX.pc + 4) | 0;
    }
    oEX.res = res;
    if (oEX.isBranch) {
      var taken;
      if (op === "beq") taken = (v1 === v2);
      else if (op === "bne") taken = (v1 !== v2);
      else if (op === "blt") taken = (v1 < v2);
      else taken = (v1 >= v2);
      s.preds++;
      if (s.predictor === "2bit") {
        var ctr = s.bht[oEX.pc] === undefined ? 1 : s.bht[oEX.pc];
        if (taken === oEX.predTaken) s.predHit++;
        s.bht[oEX.pc] = taken ? Math.min(3, ctr + 1) : Math.max(0, ctr - 1);
      } else if (taken === oEX.predTaken) s.predHit++;
      if (taken !== oEX.predTaken) {
        flush = true;
        flushTarget = taken ? oEX.target : oEX.pc + 4;
        s.controlStalls += (oIF && !oIF.killed ? 1 : 0) + (oID && !oID.killed ? 1 : 0);
        phBlame(s, oEX.pc, "control");
        ev.push({ t: "mispredict", id: oEX.id, pc: oEX.pc, taken: taken });
      }
    } else if (oEX.isJump) {
      flush = true;
      flushTarget = oEX.target;
      s.controlStalls += (oIF && !oIF.killed ? 1 : 0) + (oID && !oID.killed ? 1 : 0);
      phBlame(s, oEX.pc, "control");
      ev.push({ t: "jump", id: oEX.id, pc: oEX.pc });
    }
    newMEM = oEX;
  }
  /* 4+5. ID and IF */
  var newEX = null, newID = null, newIF = null;
  function kill(slot) {
    if (slot && !slot.killed) {
      slot.killed = true;
      slot.killCycle = cycle;
      s.trace[slot.row].killed = true;
    }
  }
  if (flush) {
    kill(oIF); kill(oID);
    s.pcNext = flushTarget;
  } else if (oID && !oID.killed) {
    var hz = phDetect(s, oID, [
      { stage: "EX", slot: oEX },
      { stage: "MEM", slot: oMEM },
      { stage: "WB", slot: oWB }
    ]);
    if (hz) {
      newEX = null;
      s.bubbleEX = true;
      newID = oID;
      newIF = oIF;
      s.dataStalls++;
      phBlame(s, oID.pc, "data");
      ev.push({ t: "stall", kind: hz.kind, rs: hz.rs, id: oID.id, pc: oID.pc, prodPc: hz.producer.pc });
    } else {
      newEX = oID;
      newID = (oIF && !oIF.killed) ? oIF : null;
      newIF = (s.pcNext < s.instrs.length * 4) ? phFetch(s) : null;
    }
  } else {
    newID = (oIF && !oIF.killed) ? oIF : null;
    newIF = (s.pcNext < s.instrs.length * 4) ? phFetch(s) : null;
  }

  s.pipe = [newIF, newID, newEX, newMEM, newWB];
  var si, marked = false;
  for (si = 0; si < 5; si++) {
    var sl = s.pipe[si];
    if (sl && !sl.killed) { s.trace[sl.row].cells[cycle] = STAGE[si]; marked = true; }
  }
  /* Only count cycles that did pipeline work: the final retire step drains
     an empty pipe and must not inflate the counter past the trace. */
  if (marked) s.cycle++;
  if (s.pcNext >= s.instrs.length * 4 &&
      !s.pipe[0] && !s.pipe[1] && !s.pipe[2] && !s.pipe[3] && !s.pipe[4]) {
    s.done = true;
  }
  return ev;
}

function phRun(s, maxCycles) {
  var n = maxCycles || 20000;
  while (!s.done && s.cycle < n) phStep(s);
  if (!s.done) { s.done = true; s.trap = "runaway: exceeded " + n + " cycles"; }
  return s;
}
/* PH-SIM-END */

/* PH-SIM-END */

/* ---------- trials (pure data) ---------- */
var PH_TRIALS = [
  {
    id: "t1", name: "Trial 1: The Slow Loop",
    brief: "Eight words, one sum, too many stalls. The loop as written burns a load-use stall every lap, and the predictor is stuck on always-not-taken. Reorder the loop to hide the load behind independent work, pick a predictor that learns, and finish at or under <b>56 cycles</b> with a0 = 36. <span class=\"par\">Shop par: 53 cycles.</span>",
    hint: "Two independent instructions fit between the load and its use. The loop branch is taken almost every time.",
    program: "  addi t0, x0, 8\n  addi t1, x0, 0\nloop:\n  lw   t3, 0(t2)\n  add  t1, t1, t3\n  addi t2, t2, 4\n  addi t0, t0, -1\n  bne  t0, x0, loop\n  add  a0, x0, t1",
    memInit: { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8 },
    checks: [{ reg: "a0", val: 36 }],
    minRetired: 35, par: 53, budget: 56,
    startFwd: true, startPred: "nt"
  },
  {
    id: "t2", name: "Trial 2: Two Branches, One Predictor",
    brief: "One branch is taken 15 times out of 20, the other 19 out of 20. No static predictor gets both right, and every wrong guess flushes two fresh instructions down the drain. The two-bit predictor learns each branch on its own. Finish at or under <b>205 cycles</b> with a0 = 20 and a1 = 50. <span class=\"par\">Shop par: 195 cycles.</span>",
    hint: "Static always-taken aces the loop branch but bombs the skip. Static always-not-taken does the reverse. Only the adaptive predictor gets both.",
    program: "  addi t0, x0, 20\n  addi t1, x0, 0\n  addi t2, x0, 0\nloop:\n  addi t1, t1, 1\n  andi t3, t1, 3\n  beq  t3, x0, skip\n  jal  x0, cont\nskip:\n  addi t2, t2, 10\ncont:\n  addi t0, t0, -1\n  bne  t0, x0, loop\n  add  a0, x0, t1\n  add  a1, x0, t2",
    memInit: null,
    checks: [{ reg: "a0", val: 20 }, { reg: "a1", val: 50 }],
    minRetired: 100, par: 195, budget: 205,
    startFwd: true, startPred: "nt"
  },
  {
    id: "t3", name: "Trial 3: Forward Frenzy",
    brief: "Five instructions, every one chained on the last, and the forwarding unit is switched off. The pipe stalls on every link while results crawl to writeback. Flip forwarding on and watch the stalls vanish. Finish at or under <b>12 cycles</b> with a0 = 80. <span class=\"par\">Shop par: 9 cycles.</span>",
    hint: "Forwarding routes each ALU result straight back to the next instruction. No code change needed, this one is pure hardware.",
    program: "  addi t0, x0, 5\n  add  t1, t0, t0\n  add  t2, t1, t1\n  add  t3, t2, t2\n  add  a0, t3, t3",
    memInit: null,
    checks: [{ reg: "a0", val: 80 }],
    minRetired: 5, par: 9, budget: 12,
    startFwd: false, startPred: "2bit"
  }
];

var PH_DEMO = "# Demo: a counting loop fed by forwarded ALU results.\n# Edit me, then press Apply and Reset.\n  li   t0, 5\n  li   t1, 0\nloop:\n  add  t1, t1, t0\n  addi t0, t0, -1\n  bne  t0, x0, loop\n  mv   a0, t1        # a0 = 15";

var PH_PRED_NAMES = { nt: "Always not-taken", t: "Always taken", "2bit": "2-bit adaptive" };

/* ---------- UI state ---------- */
var phUI = null;

function phLoadStamps() {
  try {
    var raw = window.localStorage.getItem("ph-trial-stamps");
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function phSaveStamps(st) {
  try { window.localStorage.setItem("ph-trial-stamps", JSON.stringify(st)); } catch (e) {}
}

function phBuild() {
  if (phUI) return phUI;
  var st = document.createElement("style");
  st.textContent = PH_CSS;
  document.head.appendChild(st);

  var box = document.querySelector(".dossier .actions");
  var ui = {
    sim: null, instrs: null, timer: null, running: false,
    mode: "free", trialIdx: -1,
    stamps: phLoadStamps(),
    memInit: null, tick: 0
  };
  phUI = ui;

  if (box && !ph$("phBtn")) {
    var b = phEl("button", "secondary", "Run the Pipeline Hazard Lab");
    b.id = "phBtn";
    b.addEventListener("click", function () { ph$("phOverlay").classList.add("open"); });
    box.appendChild(b);
  }

  var ov = phEl("div", "ph-overlay");
  ov.id = "phOverlay";
  var panel = phEl("div", "ph-panel");
  panel.innerHTML =
    "<h3>The Pipeline Hazard Lab</h3>" +
    '<p class="ph-sub">The Silicon Anvil proved the core computes. This bench proves it computes <b>fast</b>: a classic five-stage RV32I pipeline with real forwarding, real load-use and control stalls, and a branch predictor you can swap mid-shift. Built for the RISC-V bench behind the <a href="https://dillingerstaffing.github.io/portfolio/" target="_blank" rel="noopener">freelance portfolio</a>: every cycle here is the same machinery a client pays for.</p>';
  ov.appendChild(panel);
  document.body.appendChild(ov);

  /* tabs */
  var tabs = phEl("div", "ph-tabs");
  ui.tabBtns = [];
  ["Free Bench", "Trial 1: The Slow Loop", "Trial 2: Two Branches", "Trial 3: Forward Frenzy"].forEach(function (label, i) {
    var tb = phEl("button", "ph-tab" + (i === 0 ? " on" : ""), phEsc(label));
    tb.addEventListener("click", function () { phSelectMode(i === 0 ? -1 : i - 1); });
    tabs.appendChild(tb);
    ui.tabBtns.push(tb);
  });
  panel.appendChild(tabs);

  ui.brief = phEl("div", "ph-brief", "");
  panel.appendChild(ui.brief);

  /* toolbar */
  var bar = phEl("div", "ph-toolbar");
  ui.runBtn = phEl("button", "secondary", "Run");
  ui.runBtn.addEventListener("click", phToggleRun);
  bar.appendChild(ui.runBtn);
  ui.stepBtn = phEl("button", "secondary", "Step 1 cycle");
  ui.stepBtn.addEventListener("click", function () { phStopRun(); phStepOnce(); });
  bar.appendChild(ui.stepBtn);
  ui.resetBtn = phEl("button", "secondary", "Reset");
  ui.resetBtn.addEventListener("click", function () { phStopRun(); phResetSim(); phToast("Pipeline reset"); });
  bar.appendChild(ui.resetBtn);

  bar.appendChild(phEl("span", "lbl", "Speed"));
  ui.speed = phEl("select", null, "");
  [["1", "1x"], ["4", "4x"], ["16", "16x"]].forEach(function (o) {
    var op = phEl("option", null, o[1]);
    op.value = o[0];
    ui.speed.appendChild(op);
  });
  ui.speed.value = "4";
  bar.appendChild(ui.speed);

  bar.appendChild(phEl("span", "lbl", "Forwarding"));
  ui.fwdBtn = phEl("button", "secondary", "ON");
  ui.fwdBtn.addEventListener("click", function () {
    ui.fwdOn = !ui.fwdOn;
    ui.fwdBtn.textContent = ui.fwdOn ? "ON" : "OFF";
    phStopRun(); phResetSim();
    phToast("Forwarding " + (ui.fwdOn ? "enabled" : "disabled") + ", pipeline reset");
  });
  bar.appendChild(ui.fwdBtn);

  bar.appendChild(phEl("span", "lbl", "Predictor"));
  ui.pred = phEl("select", null, "");
  Object.keys(PH_PRED_NAMES).forEach(function (k) {
    var op = phEl("option", null, PH_PRED_NAMES[k]);
    op.value = k;
    ui.pred.appendChild(op);
  });
  ui.pred.value = "2bit";
  ui.pred.addEventListener("change", function () { phStopRun(); phResetSim(); phToast("Predictor: " + PH_PRED_NAMES[ui.pred.value]); });
  bar.appendChild(ui.pred);

  ui.trialBtn = phEl("button", "primary", "Run trial to completion");
  ui.trialBtn.style.display = "none";
  ui.trialBtn.addEventListener("click", phRunTrial);
  bar.appendChild(ui.trialBtn);
  panel.appendChild(bar);

  ui.banner = phEl("div", "ph-banner", "<h4></h4><p></p>");
  panel.appendChild(ui.banner);

  /* main grid */
  var main = phEl("div", "ph-main");
  var left = phEl("div", "ph-left");
  var edhead = phEl("div", "ph-edhead", "<h4>Program</h4>");
  ui.applyBtn = phEl("button", "secondary", "Apply and Reset");
  ui.applyBtn.addEventListener("click", function () { phStopRun(); phApplyEditor(); });
  edhead.appendChild(ui.applyBtn);
  left.appendChild(edhead);
  var edwrap = phEl("div", "ph-edwrap");
  ui.gutter = phEl("div", "ph-gutter", "");
  edwrap.appendChild(ui.gutter);
  ui.ed = phEl("textarea", "ph-ed", "");
  ui.ed.id = "phEd";
  ui.ed.spellcheck = false;
  ui.ed.value = PH_DEMO;
  ui.ed.addEventListener("scroll", function () { ui.gutter.scrollTop = ui.ed.scrollTop; });
  edwrap.appendChild(ui.ed);
  left.appendChild(edwrap);
  ui.errors = phEl("div", "ph-errors", "");
  left.appendChild(ui.errors);
  ui.blame = phEl("div", "ph-blame", "");
  left.appendChild(ui.blame);
  main.appendChild(left);

  var right = phEl("div", "ph-righth");
  right.appendChild(phEl("h4", null, "Pipeline, this cycle"));
  ui.strip = phEl("div", "ph-strip", "");
  right.appendChild(ui.strip);
  right.appendChild(phEl("h4", null, "Cycle trace"));
  var twrap = phEl("div", "ph-tracewrap", "");
  ui.trace = phEl("table", "ph-trace", "");
  twrap.appendChild(ui.trace);
  right.appendChild(twrap);
  main.appendChild(right);
  panel.appendChild(main);

  /* stats */
  ui.stats = phEl("div", "ph-stats", "");
  panel.appendChild(ui.stats);

  /* registers + memory */
  var rm = phEl("div", "ph-regmem");
  var d1 = phEl("details", null, "<summary>Register file</summary>");
  ui.regs = phEl("div", "ph-regtable", "");
  d1.appendChild(ui.regs);
  rm.appendChild(d1);
  var d2 = phEl("details", null, "<summary>Data memory (first 64 words)</summary>");
  ui.mem = phEl("div", "ph-regtable", "");
  d2.appendChild(ui.mem);
  rm.appendChild(d2);
  panel.appendChild(rm);

  /* footer */
  var foot = phEl("div", "ph-foot");
  var dl = phEl("button", "primary", "Download profile card");
  dl.addEventListener("click", phDownload);
  foot.appendChild(dl);
  var close = phEl("button", "secondary", "Close");
  close.addEventListener("click", function () { phStopRun(); ph$("phOverlay").classList.remove("open"); });
  foot.appendChild(close);
  panel.appendChild(foot);

  ui.fwdOn = true;
  ui.stripStages = [];
  var names = [["IF", "Fetch"], ["ID", "Decode"], ["EX", "Execute"], ["MEM", "Memory"], ["WB", "Writeback"]];
  names.forEach(function (nm, si) {
    var card = phEl("div", "ph-stage s" + si, "<h5>" + nm[0] + " &middot; " + nm[1] + "</h5>");
    var body = phEl("div", "ph-inst", "");
    card.appendChild(body);
    ui.strip.appendChild(card);
    ui.stripStages.push({ card: card, body: body });
    if (si < 4) ui.strip.appendChild(phEl("div", "ph-arrow", "&#8594;"));
  });

  phSelectMode(-1);
  return ui;
}

/* ---------- mode / assembly ---------- */
function phSelectMode(trialIdx) {
  var ui = phUI;
  ui.trialIdx = trialIdx;
  ui.tabBtns.forEach(function (b, i) {
    b.classList.toggle("on", (i === 0 && trialIdx === -1) || (i - 1 === trialIdx));
  });
  if (trialIdx === -1) {
    ui.brief.classList.remove("show");
    ui.trialBtn.style.display = "none";
    ui.memInit = null;
    ui.ed.value = PH_DEMO;
    ui.fwdOn = true; ui.fwdBtn.textContent = "ON";
    ui.pred.value = "2bit";
  } else {
    var t = PH_TRIALS[trialIdx];
    ui.brief.innerHTML = "<b>" + phEsc(t.name) + ".</b> " + t.brief +
      "<br><span style=\"color:var(--steel)\">Hint: " + phEsc(t.hint) + "</span>";
    ui.brief.classList.add("show");
    ui.trialBtn.style.display = "";
    ui.memInit = t.memInit;
    ui.ed.value = t.program;
    ui.fwdOn = t.startFwd; ui.fwdBtn.textContent = t.startFwd ? "ON" : "OFF";
    ui.pred.value = t.startPred;
  }
  phStopRun();
  phApplyEditor();
  phRenderBrief();
}

function phRenderBrief() {
  var ui = phUI;
  if (ui.trialIdx === -1) return;
  var t = PH_TRIALS[ui.trialIdx];
  var st = ui.stamps[t.id];
  var extra = st ? ' <span class="par">Best: ' + st.best + ' cycles' + (st.passed ? ", CLEARED" : "") + '.</span>' : "";
  ui.brief.innerHTML = "<b>" + phEsc(t.name) + ".</b> " + t.brief + extra +
    "<br><span style=\"color:var(--steel)\">Hint: " + phEsc(t.hint) + "</span>";
}

function phApplyEditor() {
  var ui = phUI;
  var a = phAssemble(ui.ed.value);
  if (a.instrs.length === 0 && a.errors.length === 0) {
    ui.errors.innerHTML = "Empty program: nothing to run.";
    ui.errors.classList.add("show");
    return false;
  }
  if (!a.ok) {
    ui.errors.innerHTML = a.errors.map(function (e) { return "line " + e.line + ": " + phEsc(e.msg); }).join("<br>");
    ui.errors.classList.add("show");
    return false;
  }
  ui.errors.classList.remove("show");
  ui.instrs = a.instrs;
  phResetSim();
  return true;
}

function phResetSim() {
  var ui = phUI;
  if (!ui.instrs) return;
  ui.sim = phNewSim(ui.instrs, { fwd: ui.fwdOn, predictor: ui.pred.value, memInit: ui.memInit });
  ui.tick = 0;
  phHideBanner();
  phRenderAll();
}

function phHideBanner() {
  var ui = phUI;
  ui.banner.classList.remove("show", "fail");
}

/* ---------- stepping / running ---------- */
function phStepOnce() {
  var ui = phUI;
  if (!ui.sim || ui.sim.done) return;
  var ev = phStep(ui.sim);
  ui.tick++;
  ev.forEach(function (e) {
    if (e.t === "mispredict") {
      phToast("Branch mispredict at 0x" + e.pc.toString(16) + ": two instructions flushed");
      ui.stripStages.forEach(function (s) { s.card.classList.add("flushed"); });
      setTimeout(function () { ui.stripStages.forEach(function (s) { s.card.classList.remove("flushed"); }); }, 600);
    } else if (e.t === "stall" && e.kind === "load-use") {
      /* quiet: the strip shows it */
    }
  });
  if (ui.sim.done) {
    phStopRun();
    if (ui.sim.trap) phToast("Trap: " + ui.sim.trap);
    else phToast("Halted after " + ui.sim.cycle + " cycles, " + ui.sim.retired + " retired");
  }
  phRenderAll();
}

function phToggleRun() {
  var ui = phUI;
  if (ui.running) { phStopRun(); return; }
  if (!ui.sim || ui.sim.done) { if (!phApplyEditor()) return; }
  ui.running = true;
  ui.runBtn.textContent = "Pause";
  var speed = parseInt(ui.speed.value, 10) || 1;
  ui.timer = setInterval(function () {
    var k;
    for (k = 0; k < speed && ui.sim && !ui.sim.done; k++) phStep(ui.sim);
    ui.tick++;
    if (ui.sim.done) {
      phStopRun();
      if (ui.sim.trap) phToast("Trap: " + ui.sim.trap);
      else phToast("Halted after " + ui.sim.cycle + " cycles, " + ui.sim.retired + " retired");
    }
    phRenderAll();
  }, 120);
}

function phStopRun() {
  var ui = phUI;
  if (ui.timer) { clearInterval(ui.timer); ui.timer = null; }
  if (ui.running) { ui.running = false; ui.runBtn.textContent = "Run"; }
}

/* ---------- rendering ---------- */
function phRenderAll() {
  phRenderStrip();
  phRenderStats();
  phRenderRegs();
  phRenderBlame();
  phRenderGutter();
  if (phUI.tick % 5 === 0 || (phUI.sim && phUI.sim.done)) phRenderTrace();
}

function phRenderStrip() {
  var ui = phUI, s = ui.sim;
  var fwdById = {};
  (s ? s.lastEvents : []).forEach(function (e) {
    if (e.t === "fwd") {
      (fwdById[e.id] = fwdById[e.id] || []).push(e);
    }
  });
  ui.stripStages.forEach(function (st, si) {
    var slot = s ? s.pipe[si] : null;
    st.card.classList.remove("bubble");
    if (!slot) {
      if (si === 2 && s && s.bubbleEX) {
        st.card.classList.add("bubble");
        st.body.innerHTML = '<span class="inst" style="color:var(--orange)">BUBBLE<br><span style="font-size:10px">stall</span></span>';
      } else {
        st.body.innerHTML = '<span class="empty">--</span>';
      }
      return;
    }
    var h = phEsc(slot.text);
    (fwdById[slot.id] || []).forEach(function (f) {
      h += '<br><span class="ph-fwdtag">' + phEsc(phRegName(f.rs)) + " fwd from " + f.from + "</span>";
    });
    if (slot.killed) h = '<span style="opacity:.4;text-decoration:line-through">' + h + "</span>";
    st.body.innerHTML = '<span class="inst">' + h + "</span>";
  });
}

function phRenderTrace() {
  var ui = phUI, s = ui.sim;
  if (!s) { ui.trace.innerHTML = ""; return; }
  var maxC = Math.max(0, s.cycle - 1);
  var fromC = Math.max(0, maxC - 79);
  var html = "<tr><th></th>";
  var c;
  for (c = fromC; c <= maxC; c++) html += "<th class=\"" + (c === maxC ? "cur" : "") + "\">" + c + "</th>";
  html += "</tr>";
  var STAGE_CLS = { IF: "c-IF", ID: "c-ID", EX: "c-EX", MEM: "c-MEM", WB: "c-WB" };
  s.trace.forEach(function (row) {
    html += '<tr class="' + (row.killed ? "killed" : "") + '"><td class="pc">' + phEsc(row.text) + "</td>";
    for (c = fromC; c <= maxC; c++) {
      var cell = row.cells[c];
      if (cell) html += '<td class="' + STAGE_CLS[cell] + (c === maxC ? " cur" : "") + '">' + cell + "</td>";
      else html += "<td" + (c === maxC ? ' class="cur"' : "") + "></td>";
    }
    html += "</tr>";
  });
  ui.trace.innerHTML = html;
}

function phRenderStats() {
  var ui = phUI, s = ui.sim;
  function tile(label, val, cls) {
    return '<div class="ph-stat"><h4>' + label + "</h4><p class=\"" + (cls || "") + "\">" + val + "</p></div>";
  }
  if (!s) { ui.stats.innerHTML = ""; return; }
  var ipc = s.cycle ? (s.retired / s.cycle).toFixed(2) : "0.00";
  var acc = s.preds ? Math.round(100 * s.predHit / s.preds) + "%" : "--";
  var h = "";
  h += tile("Cycle", s.cycle, "");
  h += tile("Retired", s.retired, "good");
  h += tile("IPC", ipc, "");
  h += tile("Data stalls", s.dataStalls, s.dataStalls ? "warn" : "");
  h += tile("Control stalls", s.controlStalls, s.controlStalls ? "warn" : "");
  h += tile("Forwards", s.forwards, s.forwards ? "good" : "");
  h += tile("Predictor", s.predHit + "/" + s.preds + " " + acc, "");
  if (s.trap) h += tile("Trap", "YES", "warn");
  ui.stats.innerHTML = h;
}

function phRenderRegs() {
  var ui = phUI, s = ui.sim;
  if (!s) return;
  var h = "";
  var i;
  for (i = 0; i < 32; i++) {
    var v = s.regs[i] | 0;
    var cls = v === 0 ? "rz" : (i >= 10 && i <= 17 ? "rhot" : "");
    h += '<div class="' + cls + '">' + phRegName(i) + " " + phHex(v) + "</div>";
  }
  ui.regs.innerHTML = h;
  h = "";
  for (i = 0; i < 64; i++) {
    var w = s.mem[i] | 0;
    h += '<div class="' + (w === 0 ? "rz" : "rhot") + '">+' + (i * 4) + " " + phHex(w) + "</div>";
  }
  ui.mem.innerHTML = h;
}

function phPcToLine(pc) {
  var ui = phUI;
  if (!ui.instrs) return 0;
  var i;
  for (i = 0; i < ui.instrs.length; i++) if (ui.instrs[i].pc === pc) return ui.instrs[i].line;
  return 0;
}

function phRenderBlame() {
  var ui = phUI, s = ui.sim;
  if (!s) { ui.blame.innerHTML = ""; return; }
  var pcs = Object.keys(s.blame);
  if (!pcs.length) { ui.blame.innerHTML = '<span style="color:var(--steel)">No stalls yet. The pipe is clean.</span>'; return; }
  var h = "";
  pcs.sort(function (a, b) { return a - b; }).forEach(function (pck) {
    var b = s.blame[pck];
    var pc = parseInt(pck, 10);
    var line = phPcToLine(pc);
    var ins = ui.instrs ? ui.instrs.filter(function (x) { return x.pc === pc; })[0] : null;
    var bits = [];
    if (b.data) bits.push(b.data + " data");
    if (b.control) bits.push(b.control + " control");
    h += '<div class="brow" data-line="' + line + '"><b>0x' + pc.toString(16) + "</b> " +
      phEsc(ins ? ins.text : "") + " &middot; " + bits.join(" + ") + " stall" + ((b.data + b.control) > 1 ? "s" : "") + "</div>";
  });
  ui.blame.innerHTML = h;
  Array.prototype.forEach.call(ui.blame.querySelectorAll(".brow"), function (row) {
    row.addEventListener("click", function () {
      var ln = parseInt(row.getAttribute("data-line"), 10);
      phToast("Line " + ln + ": reorder code or flip a setting to kill these stalls");
    });
  });
}

function phRenderGutter() {
  var ui = phUI, s = ui.sim;
  var n = ui.ed.value.split("\n").length;
  var hot = {};
  if (s) {
    Object.keys(s.blame).forEach(function (pck) {
      var ln = phPcToLine(parseInt(pck, 10));
      if (ln) hot[ln] = true;
    });
  }
  var h = "", i;
  for (i = 1; i <= n; i++) h += '<div class="' + (hot[i] ? "hot" : "") + '">' + (hot[i] ? "!" : i) + "</div>";
  ui.gutter.innerHTML = h;
  ui.gutter.scrollTop = ui.ed.scrollTop;
}

/* ---------- trials ---------- */
function phRunTrial() {
  var ui = phUI;
  var t = PH_TRIALS[ui.trialIdx];
  if (!t) return;
  phStopRun();
  if (!phApplyEditor()) return;
  var s = phNewSim(ui.instrs, { fwd: ui.fwdOn, predictor: ui.pred.value, memInit: t.memInit });
  phRun(s, 20000);
  ui.sim = s;
  ui.tick++;
  phRenderAll();
  function fail(title, msg) {
    ui.banner.innerHTML = "<h4>" + phEsc(title) + "</h4><p>" + msg + "</p>";
    ui.banner.classList.add("show", "fail");
  }
  if (s.trap) { fail("Trial failed: trap", "The core trapped: " + phEsc(s.trap) + ". Fix the program and run the trial again."); return; }
  var bad = null;
  t.checks.forEach(function (ck) {
    var got = s.regs[PH_ABI[ck.reg]] | 0;
    if (got !== ck.val) bad = ck.reg + " = " + got + ", needed " + ck.val;
  });
  if (bad) { fail("Trial failed: wrong result", "The program finished but " + phEsc(bad) + ". The answer must be right, not just fast."); return; }
  if (s.retired < t.minRetired) {
    fail("Trial failed: too little work", "Only " + s.retired + " instructions retired. The bench requires the real program to run (at least " + t.minRetired + "). No hard-coding the answer.");
    return;
  }
  if (s.cycle > t.budget) {
    fail("Trial failed: over budget", "Finished in " + s.cycle + " cycles against a budget of " + t.budget + " (par " + t.par + "). " + phEsc(t.hint));
    return;
  }
  var st = ui.stamps[t.id] || {};
  st.passed = true;
  st.best = st.best === undefined ? s.cycle : Math.min(st.best, s.cycle);
  ui.stamps[t.id] = st;
  phSaveStamps(ui.stamps);
  var allClear = PH_TRIALS.every(function (x) { return ui.stamps[x.id] && ui.stamps[x.id].passed; });
  var msg = "Cleared in <b>" + s.cycle + " cycles</b> (par " + t.par + ", budget " + t.budget + "), " +
    s.dataStalls + " data stalls, " + s.controlStalls + " control stalls, " + s.forwards + " forwards. Best so far: " + st.best + ".";
  if (allClear) msg += "<br><b>All three trials cleared. The shop names you Master Pipeline Smith.</b>";
  ui.banner.innerHTML = "<h4>Trial cleared</h4><p>" + msg + "</p>";
  ui.banner.classList.add("show");
  ui.banner.classList.remove("fail");
  phRenderBrief();
  phToast(allClear ? "All three trials cleared. Master Pipeline Smith." : "Trial cleared in " + s.cycle + " cycles");
}

/* ---------- profile card download ---------- */
function phDownload() {
  var ui = phUI;
  if (!ui.sim) { phToast("Nothing to profile yet"); return; }
  var s = ui.sim;
  var t = ui.trialIdx === -1 ? null : PH_TRIALS[ui.trialIdx];
  var lines = [];
  lines.push("PIPELINE HAZARD LAB: PROFILE CARD");
  lines.push("The Proving Ground, " + new Date().toISOString().slice(0, 10));
  lines.push("----------------------------------------");
  lines.push("Mode: " + (t ? t.name : "Free Bench"));
  lines.push("Forwarding: " + (ui.fwdOn ? "on" : "off"));
  lines.push("Predictor: " + PH_PRED_NAMES[ui.pred.value]);
  lines.push("");
  lines.push("RESULT");
  lines.push("Cycles: " + s.cycle);
  lines.push("Retired: " + s.retired);
  lines.push("IPC: " + (s.cycle ? (s.retired / s.cycle).toFixed(3) : "0"));
  lines.push("Data stalls: " + s.dataStalls);
  lines.push("Control stalls: " + s.controlStalls);
  lines.push("Forwarded operands: " + s.forwards);
  lines.push("Branch predictions: " + s.predHit + "/" + s.preds);
  if (s.trap) lines.push("TRAP: " + s.trap);
  lines.push("");
  lines.push("STALL BLAME");
  var pcs = Object.keys(s.blame).sort(function (a, b) { return a - b; });
  if (!pcs.length) lines.push("(none, the pipe ran clean)");
  pcs.forEach(function (pck) {
    var b = s.blame[pck], pc = parseInt(pck, 10);
    var ins = ui.instrs.filter(function (x) { return x.pc === pc; })[0];
    lines.push("0x" + pc.toString(16) + " " + (ins ? ins.text : "") + ": " + b.data + " data, " + b.control + " control");
  });
  lines.push("");
  lines.push("TRIAL STAMPS");
  PH_TRIALS.forEach(function (x) {
    var st = ui.stamps[x.id];
    lines.push(x.name + ": " + (st && st.passed ? "CLEARED, best " + st.best + " cycles (par " + x.par + ")" : "not cleared"));
  });
  lines.push("");
  lines.push("PROGRAM");
  lines.push(ui.ed.value);
  lines.push("----------------------------------------");
  lines.push("End of profile card.");
  var blob = new Blob([lines.join("\n")], { type: "text/plain" });
  var a = document.createElement("a");
  a.href = (window.URL || window.webkitURL).createObjectURL(blob);
  a.download = "pipeline-hazard-lab-profile.txt";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    (window.URL || window.webkitURL).revokeObjectURL(a.href);
    a.remove();
  }, 500);
  phToast("Profile card downloaded");
}

/* ---------- init ---------- */
function phInit() {
  if (typeof document === "undefined") return;
  if (!document.querySelector(".dossier .actions")) return;
  phBuild();
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", phInit);
  } else {
    phInit();
  }
}

/* node test hook: harmless in the browser */
if (typeof module !== "undefined" && module.exports) {
  module.exports = Object.assign(module.exports || {}, {
    PH: {
      assemble: phAssemble, newSim: phNewSim, step: phStep, run: phRun,
      TRIALS: PH_TRIALS, ABI: PH_ABI, regName: phRegName
    }
  });
}

})();
/* ============================================================
   THE BURN-IN CHAMBER
   GPU compute-part qualification bench for the TAPEOUT lab.
   Three cards, one chamber, honest verdicts: design a stress
   profile (workload, power limit, fan curve, soak time), watch
   live telemetry from a real lumped-capacitance thermal model,
   then call SHIP or RMA. Cook a card and it is scrap.
   ============================================================ */
(function () {
  "use strict";

  var bi$ = function (id) { return document.getElementById(id); };
  function biToast(msg) {
    var t = bi$("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 1800);
  }
  function biEl(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function biEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var BI_CSS = [
    ".bi-overlay{position:fixed;inset:0;background:rgba(4,7,7,.93);z-index:95;display:none;overflow-y:auto;padding:18px 12px;}",
    ".bi-overlay.open{display:block;}",
    ".bi-panel{max-width:1140px;margin:0 auto;background:var(--panel);border:1px solid var(--line);padding:22px;}",
    ".bi-panel h3{font-family:var(--font-d);font-size:26px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.02em;color:var(--acid);}",
    ".bi-sub{font-size:12px;line-height:1.65;color:var(--steel);margin:0 0 14px;max-width:80ch;}",
    ".bi-sub a{color:var(--cyan);text-decoration:none;border-bottom:1px dotted var(--cyan);}",
    ".bi-sub b{color:var(--orange);}",
    ".bi-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}",
    ".bi-cardtab{background:var(--panel-2);border:1px solid var(--line);color:var(--paper);font:inherit;font-size:11px;padding:10px 14px;cursor:pointer;min-height:52px;text-align:left;min-width:170px;}",
    ".bi-cardtab .sn{display:block;font-family:var(--font-m);font-size:10px;color:var(--steel);}",
    ".bi-cardtab .st{display:block;font-size:9px;letter-spacing:.12em;text-transform:uppercase;margin-top:4px;color:var(--steel);}",
    ".bi-cardtab.on{border-color:var(--acid);}",
    ".bi-cardtab .st.ok{color:var(--acid);}",
    ".bi-cardtab .st.warn{color:var(--orange);}",
    ".bi-cardtab .st.bad{color:var(--bad);}",
    ".bi-brief{border:1px dashed var(--orange);background:rgba(255,107,44,.05);padding:12px 14px;margin-bottom:12px;font-size:12px;line-height:1.6;color:var(--paper);}",
    ".bi-brief b{color:var(--orange);}",
    ".bi-brief .par{color:var(--acid);}",
    ".bi-ctl{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px;}",
    ".bi-field{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;}",
    ".bi-field h4{margin:0 0 6px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".bi-field select{width:100%;background:var(--black,#0a0f0e);border:1px solid var(--line);color:var(--paper);font:inherit;font-size:11px;padding:10px 8px;min-height:44px;}",
    ".bi-field input[type=range]{width:100%;accent-color:var(--acid);min-height:44px;}",
    ".bi-field .val{font-family:var(--font-m);font-size:13px;color:var(--acid);}",
    ".bi-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;}",
    ".bi-toolbar .secondary{min-height:48px;font-size:12px;padding:10px 18px;}",
    ".bi-run{border-color:var(--acid) !important;color:var(--acid) !important;font-weight:700;}",
    ".bi-run.running{border-color:var(--bad) !important;color:var(--bad) !important;}",
    ".bi-prog{height:10px;border:1px solid var(--line);background:var(--panel);margin-bottom:12px;position:relative;overflow:hidden;}",
    ".bi-prog i{position:absolute;left:0;top:0;bottom:0;width:0;background:var(--acid);}",
    ".bi-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px;}",
    ".bi-stat{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;}",
    ".bi-stat h4{margin:0 0 4px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".bi-stat p{margin:0;font-family:var(--font-m);font-size:18px;color:var(--paper);}",
    ".bi-stat p.hot{color:var(--orange);}",
    ".bi-stat p.crit{color:var(--bad);animation:biBlink 0.7s steps(2) infinite;}",
    ".bi-stat p.good{color:var(--acid);}",
    ".bi-stat .tag{display:inline-block;font-size:8px;letter-spacing:.1em;background:var(--orange);color:#0a0f0e;padding:1px 5px;margin-left:6px;vertical-align:middle;}",
    "@keyframes biBlink{50%{opacity:.35;}}",
    ".bi-charts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}",
    ".bi-chartbox{border:1px solid var(--line);background:var(--panel);padding:8px;}",
    ".bi-chartbox h5{margin:0 0 4px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--steel);font-weight:600;}",
    ".bi-chartbox canvas{width:100%;height:120px;display:block;}",
    ".bi-log{border:1px solid var(--line);background:var(--panel-2);padding:12px 14px;margin-bottom:12px;}",
    ".bi-log h4{margin:0 0 8px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".bi-log table{width:100%;border-collapse:collapse;font-family:var(--font-m);font-size:10px;}",
    ".bi-log th,.bi-log td{border:1px solid var(--panel);padding:5px 7px;text-align:left;}",
    ".bi-log th{color:var(--steel);text-transform:uppercase;letter-spacing:.08em;font-size:9px;}",
    ".bi-log td.hot{color:var(--orange);}",
    ".bi-log td.err{color:var(--bad);}",
    ".bi-log .empty{font-size:11px;color:var(--steel);}",
    ".bi-verdict{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;}",
    ".bi-verdict button{min-height:52px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;font-family:var(--font-d);}",
    ".bi-verdict .ship{background:rgba(199,255,56,.08);border:1px solid var(--acid);color:var(--acid);}",
    ".bi-verdict .rma{background:rgba(255,93,93,.08);border:1px solid var(--bad);color:var(--bad);}",
    ".bi-verdict button:disabled{opacity:.35;cursor:not-allowed;}",
    ".bi-verdict .called{opacity:1;box-shadow:0 0 0 2px currentColor;}",
    ".bi-banner{border:1px solid var(--acid);background:rgba(199,255,56,.06);padding:14px 16px;margin:14px 0;display:none;}",
    ".bi-banner.show{display:block;}",
    ".bi-banner h4{margin:0 0 6px;font-family:var(--font-d);font-size:18px;text-transform:uppercase;color:var(--acid);}",
    ".bi-banner p{margin:0 0 10px;font-size:12px;line-height:1.6;color:var(--paper);}",
    ".bi-banner.fail{border-color:var(--bad);background:rgba(255,93,93,.06);}",
    ".bi-banner.fail h4{color:var(--bad);}",
    ".bi-score{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;font-size:11px;color:var(--steel);}",
    ".bi-score b{font-family:var(--font-m);font-size:15px;color:var(--acid);}",
    ".bi-foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;}",
    ".bi-foot .secondary{flex:1;min-height:48px;}",
    "@media (max-width:900px){",
    ".bi-charts{grid-template-columns:1fr;}",
    ".bi-panel{padding:14px;}",
    ".bi-panel h3{font-size:20px;}",
    ".bi-overlay{padding:10px 8px;}",
    ".bi-field select{font-size:16px;}",
    "}"
  ].join("\n");

  /* ---------------- sim core (pure, unit-testable) ---------------- */

  var BI_T_AMB = 24;      /* chamber ambient, C */
  var BI_T_TARGET = 83;   /* boost starts derating above this */
  var BI_T_MAX = 105;     /* thermal shutdown */
  var BI_C = 65;          /* lumped thermal capacitance, J/K */

  var BI_WORKLOADS = {
    compute: { label: "Compute (shaders, full ALU)", power: 1.00, eccMem: 0 },
    mixed:   { label: "Mixed (render loop)",         power: 0.85, eccMem: 1 },
    memory:  { label: "Memory (VRAM hammer)",        power: 0.70, eccMem: 2 }
  };
  var BI_FANS = {
    quiet:     { label: "Quiet (40% max)", h: 3.2 },
    balanced:  { label: "Balanced (65% max)", h: 5.0 },
    aggressive:{ label: "Aggressive (100%)", h: 7.5 },
    auto:      { label: "Auto curve", h: null }
  };

  /* Hidden faults are shuffled among the three serials every shift,
     so the bench cannot be memorized. */
  function biMakeCards() {
    var defs = [
      { model: "VX-90X 24GB", serial: "BI-90117", tdp: 300, boost: 2520 },
      { model: "VX-90X 24GB", serial: "BI-90122", tdp: 300, boost: 2520 },
      { model: "VX-90X 24GB", serial: "BI-90131", tdp: 300, boost: 2520 }
    ];
    var faults = ["none", "paste", "vram"];
    for (var i = faults.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = faults[i]; faults[i] = faults[j]; faults[j] = t;
    }
    defs.forEach(function (d, k) {
      d.fault = faults[k];
      d.cooling = d.fault === "paste" ? 0.78 : 1.0;   /* dried paste: poor heat transfer */
      d.truth = d.fault === "none" ? "ship" : "rma";  /* healthy ships, faulty is RMA */
    });
    return defs;
  }

  function biFanH(curve, T) {
    if (curve === "auto") {
      var f = 3.2 + (T - 40) / 65 * 4.3;
      if (f < 3.2) f = 3.2;
      if (f > 7.5) f = 7.5;
      return f;
    }
    return BI_FANS[curve].h;
  }

  /* One physics tick. s is mutated; returns an event summary. */
  function biStep(s, card, prof, dt) {
    var wl = BI_WORKLOADS[prof.workload];
    var ev = { shutdown: false, ecc: 0 };
    if (s.dead) return ev;

    /* boost: full below target, derates linearly to 70% at (T_MAX - 10) */
    var span = (BI_T_MAX - 10) - BI_T_TARGET;
    var ratio = 1;
    if (s.T > BI_T_TARGET) {
      ratio = 1 - Math.min(1, (s.T - BI_T_TARGET) / span) * 0.30;
    }
    var clockTarget = card.boost * ratio;
    s.clock += (clockTarget - s.clock) * Math.min(1, dt / 4);

    s.power = card.tdp * wl.power * prof.powerLimit * (s.clock / card.boost);

    var h = biFanH(prof.fan, s.T) * card.cooling;
    s.fanPct = prof.fan === "auto"
      ? Math.round(40 + Math.min(1, Math.max(0, (s.T - 40) / 65)) * 60)
      : (prof.fan === "quiet" ? 40 : prof.fan === "balanced" ? 65 : 100);

    s.T += (s.power - h * (s.T - BI_T_AMB)) * dt / BI_C;
    s.t += dt;

    /* ECC: Poisson-ish. Marginal VRAM screams under memory load,
       and heat makes it worse. Healthy silicon is nearly silent. */
    var rate;
    if (card.fault === "vram") {
      var base = wl.eccMem === 2 ? 0.60 : wl.eccMem === 1 ? 0.20 : 0.05;
      var heat = 1 + Math.max(0, s.T - 65) * 0.06;
      rate = base * heat * Math.pow(s.clock / card.boost, 2);
    } else if (card.fault === "paste") {
      rate = 0.005;
    } else {
      rate = 0.002;
    }
    var p = 1 - Math.exp(-rate * dt);
    if (Math.random() < p) {
      ev.ecc = 1 + (Math.random() < 0.15 ? Math.floor(Math.random() * 3) + 1 : 0);
      s.ecc += ev.ecc;
    }
    if (s.maxT === undefined || s.T > s.maxT) s.maxT = s.T;

    if (s.T >= BI_T_MAX) {
      s.dead = true;
      ev.shutdown = true;
    }
    return ev;
  }

  function biNewRun() {
    return { T: BI_T_AMB + 2, clock: 0, power: 0, fanPct: 40, ecc: 0, t: 0, dead: false, maxT: BI_T_AMB + 2, samples: [] };
  }

  /* ---------------- UI ---------------- */

  var biUI = null;

  var BI_SPEEDS = { 1: 2, 4: 8, 16: 32 };   /* sim seconds per 100ms tick */

  function biLoadBest() {
    try {
      var v = window.localStorage.getItem("biBest");
      if (v === null) return null;
      var n = parseInt(v, 10);
      return isNaN(n) ? null : n;
    } catch (e) { return null; }
  }
  function biSaveBest(v) {
    try { window.localStorage.setItem("biBest", String(v)); } catch (e) {}
  }

  function biNewShift() {
    return {
      cards: biMakeCards(),
      cardIdx: 0,
      logs: [[], [], []],        /* per-card run summaries */
      verdicts: [null, null, null],
      running: false,
      timer: null,
      sim: biNewRun(),
      prof: { workload: "compute", powerLimit: 1.0, fan: "balanced", dur: 180, speed: 4 },
      score: 0,
      finished: false
    };
  }

  function biStatusOf(sh, i) {
    if (sh.verdicts[i]) return { cls: "ok", txt: "VERDICT: " + sh.verdicts[i].toUpperCase() };
    if (sh.logs[i].length) {
      var secs = sh.logs[i].reduce(function (a, r) { return a + r.dur; }, 0);
      if (sh.logs[i].some(function (r) { return r.shutdown; })) return { cls: "bad", txt: "KILLED IN CHAMBER" };
      return { cls: secs >= 60 ? "ok" : "warn", txt: "LOGGED " + Math.round(secs) + "s" };
    }
    return { cls: "", txt: "UNTESTED" };
  }

  function biBuild() {
    if (biUI) return biUI;
    var st = document.createElement("style");
    st.textContent = BI_CSS;
    document.head.appendChild(st);

    var box = document.querySelector(".dossier .actions");
    if (box && !bi$("biBtn")) {
      var b = biEl("button", "secondary", "Run the Burn-In Chamber");
      b.id = "biBtn";
      b.addEventListener("click", function () { bi$("biOverlay").classList.add("open"); });
      box.appendChild(b);
    }

    var ov = biEl("div", "bi-overlay");
    ov.id = "biOverlay";
    var panel = biEl("div", "bi-panel");
    panel.innerHTML =
      "<h3>The Burn-In Chamber</h3>" +
      '<p class="bi-sub">This is the qualification rig behind the <a href="https://dillingerstaffing.github.io/tapeout/" target="_blank" rel="noopener">TAPEOUT</a> lab: three compute cards came back from the field and every one needs an honest burn-in before it ships or is sent back for RMA. Pick a card, design the stress profile, run the chamber, read the telemetry, then call <b>SHIP</b> or <b>RMA</b>. Two of these cards are carrying faults you cannot see from the outside. The telemetry will not confess on its own: each fault only surfaces under the workload that stresses it, soaked long enough to matter. Push any card past its thermal limit and it dies in the chamber, which counts as a miss. Scoring: 100 points per correct call, 300 for a clean sweep.</p>';
    ov.appendChild(panel);
    document.body.appendChild(ov);

    var ui = { sh: biNewShift(), charts: {}, chartCtx: {} };
    biUI = ui;

    /* card tabs */
    ui.tabs = biEl("div", "bi-tabs");
    panel.appendChild(ui.tabs);

    /* brief */
    ui.brief = biEl("div", "bi-brief",
      "<b>How to read a card:</b> a healthy card holds boost near its rated clock, lands in the expected temperature band, and stays nearly silent on ECC. " +
      "A card with dried thermal paste runs hot for the same power and sheds boost (watch the THROTTLING tag). " +
      "A card with marginal VRAM throws correctable ECC bursts, loudest under the memory workload. " +
      "Tip: match the stress to the suspicion. A compute soak will not catch bad VRAM, and a gentle memory pass will not catch bad paste. " +
      "You need at least 60 seconds of logged burn per card before a verdict unlocks. " +
      '<span class="par">House par: 300 points, zero kills.</span>');
    panel.appendChild(ui.brief);

    /* controls */
    ui.ctl = biEl("div", "bi-ctl");
    panel.appendChild(ui.ctl);

    function field(title) {
      var f = biEl("div", "bi-field", "<h4>" + biEsc(title) + "</h4>");
      ui.ctl.appendChild(f);
      return f;
    }
    var fw = field("Workload");
    ui.selW = biEl("select", null, "");
    Object.keys(BI_WORKLOADS).forEach(function (k) {
      var o = document.createElement("option");
      o.value = k; o.textContent = BI_WORKLOADS[k].label;
      ui.selW.appendChild(o);
    });
    ui.selW.value = "compute";
    fw.appendChild(ui.selW);

    var fp = field("Power limit");
    ui.rngP = document.createElement("input");
    ui.rngP.type = "range"; ui.rngP.min = "50"; ui.rngP.max = "120"; ui.rngP.step = "5"; ui.rngP.value = "100";
    ui.valP = biEl("div", "val", "100%");
    ui.rngP.addEventListener("input", function () { ui.valP.textContent = ui.rngP.value + "%"; });
    fp.appendChild(ui.rngP); fp.appendChild(ui.valP);

    var ff = field("Fan curve");
    ui.selF = biEl("select", null, "");
    Object.keys(BI_FANS).forEach(function (k) {
      var o = document.createElement("option");
      o.value = k; o.textContent = BI_FANS[k].label;
      ui.selF.appendChild(o);
    });
    ui.selF.value = "balanced";
    ff.appendChild(ui.selF);

    var fd = field("Soak time");
    ui.selD = biEl("select", null, "");
    [["60", "1 minute (quick screen)"], ["180", "3 minutes (standard)"], ["420", "7 minutes (torture test)"]].forEach(function (o) {
      var el2 = document.createElement("option");
      el2.value = o[0]; el2.textContent = o[1];
      ui.selD.appendChild(el2);
    });
    ui.selD.value = "180";
    fd.appendChild(ui.selD);

    var fs = field("Chamber speed");
    ui.selS = biEl("select", null, "");
    [["1", "1x (real time)"], ["4", "4x (fast)"], ["16", "16x (time lapse)"]].forEach(function (o) {
      var el2 = document.createElement("option");
      el2.value = o[0]; el2.textContent = o[1] + "";
      ui.selS.appendChild(el2);
    });
    ui.selS.value = "4";
    fs.appendChild(ui.selS);

    /* toolbar */
    ui.bar = biEl("div", "bi-toolbar");
    ui.runBtn = biEl("button", "secondary bi-run", "RUN CHAMBER");
    ui.runBtn.addEventListener("click", biToggleRun);
    ui.bar.appendChild(ui.runBtn);
    ui.abortBtn = biEl("button", "secondary", "Abort run");
    ui.abortBtn.addEventListener("click", function () { biEndRun(true); });
    ui.bar.appendChild(ui.abortBtn);
    ui.newBtn = biEl("button", "secondary", "New shift (reshuffle faults)");
    ui.newBtn.addEventListener("click", function () {
      if (ui.sh.running) { biToast("Finish or abort the run first"); return; }
      ui.sh = biNewShift();
      ui.finished = false;
      biBanner(false, "", "");
      biRenderAll();
      biToast("New shift: faults reshuffled");
    });
    ui.bar.appendChild(ui.newBtn);
    ui.closeBtn = biEl("button", "secondary", "Close chamber");
    ui.closeBtn.addEventListener("click", function () {
      if (ui.sh.running) biEndRun(true);
      bi$("biOverlay").classList.remove("open");
    });
    ui.bar.appendChild(ui.closeBtn);
    panel.appendChild(ui.bar);

    ui.prog = biEl("div", "bi-prog", "<i></i>");
    panel.appendChild(ui.prog);

    /* stats */
    ui.stats = biEl("div", "bi-stats");
    var defs = [["TEMP", "stT", "C"], ["CLOCK", "stC", "MHz"], ["POWER", "stP", "W"], ["FAN", "stF", "%"], ["ECC ERRORS", "stE", ""], ["ELAPSED", "stL", "s"]];
    ui.statEls = {};
    defs.forEach(function (d) {
      var s2 = biEl("div", "bi-stat", "<h4>" + d[0] + "</h4><p id=\"bi_" + d[1] + "\">--</p>");
      ui.stats.appendChild(s2);
      ui.statEls[d[1]] = s2.querySelector("p");
    });
    panel.appendChild(ui.stats);

    /* charts */
    ui.chartsWrap = biEl("div", "bi-charts");
    var chartDefs = [
      ["cT", "Temperature (C)", "--acid"],
      ["cC", "Clock (MHz)", "--cyan"],
      ["cP", "Power (W)", "--orange"],
      ["cE", "ECC errors (cumulative)", "var(--bad)"]
    ];
    chartDefs.forEach(function (cd) {
      var bx = biEl("div", "bi-chartbox", "<h5>" + cd[1] + "</h5>");
      var cv = document.createElement("canvas");
      bx.appendChild(cv);
      ui.chartsWrap.appendChild(bx);
      ui.chartCtx[cd[0]] = { cv: cv, color: cd[2], key: cd[0] };
    });
    panel.appendChild(ui.chartsWrap);

    /* burn log */
    ui.log = biEl("div", "bi-log");
    panel.appendChild(ui.log);

    /* verdict */
    ui.verd = biEl("div", "bi-verdict");
    ui.shipBtn = biEl("button", "ship", "SHIP IT");
    ui.rmaBtn = biEl("button", "rma", "RMA IT");
    ui.shipBtn.addEventListener("click", function () { biVerdict("ship"); });
    ui.rmaBtn.addEventListener("click", function () { biVerdict("rma"); });
    ui.verd.appendChild(ui.shipBtn);
    ui.verd.appendChild(ui.rmaBtn);
    panel.appendChild(ui.verd);

    /* score */
    ui.scoreRow = biEl("div", "bi-score");
    panel.appendChild(ui.scoreRow);

    /* banner */
    ui.banner = biEl("div", "bi-banner");
    panel.appendChild(ui.banner);

    /* foot */
    ui.foot = biEl("div", "bi-foot");
    ui.dlBtn = biEl("button", "secondary", "Download burn-in certificate");
    ui.dlBtn.addEventListener("click", biDownload);
    ui.dlBtn.style.display = "none";
    ui.foot.appendChild(ui.dlBtn);
    panel.appendChild(ui.foot);

    biRenderAll();
    return ui;
  }

  /* ---------------- render ---------------- */

  function biRenderAll() {
    biRenderTabs(); biRenderLog(); biRenderVerdict(); biRenderScore(); biRenderStats(biUI.sim);
    biDrawCharts();
  }

  function biRenderTabs() {
    var ui = biUI, sh = ui.sh;
    ui.tabs.innerHTML = "";
    sh.cards.forEach(function (c, i) {
      var st = biStatusOf(sh, i);
      var tb = biEl("button", "bi-cardtab" + (i === sh.cardIdx ? " on" : ""),
        biEsc(c.model) + '<span class="sn">S/N ' + biEsc(c.serial) + '</span>' +
        '<span class="st ' + st.cls + '">' + biEsc(st.txt) + "</span>");
      tb.addEventListener("click", function () {
        if (sh.running) { biToast("Card is in the chamber"); return; }
        sh.cardIdx = i;
        sh.sim = biNewRun();
        biRenderAll();
      });
      ui.tabs.appendChild(tb);
    });
  }

  function biRenderStats(s) {
    var ui = biUI;
    var E = ui.statEls;
    var set = function (id, txt, cls) {
      E[id].textContent = txt;
      E[id].className = cls || "";
    };
    if (!s || s.t === 0) {
      ["stT", "stC", "stP", "stF", "stE", "stL"].forEach(function (id) { set(id, "--"); });
      return;
    }
    var tCls = s.T >= BI_T_MAX - 10 ? "crit" : s.T >= BI_T_TARGET ? "hot" : "";
    set("stT", Math.round(s.T) + " C" + (s.T >= BI_T_TARGET + 1 && s.T < BI_T_MAX ? " THROTTLING" : ""), tCls);
    var card = ui.sh.cards[ui.sh.cardIdx];
    var clkPct = s.clock / card.boost;
    set("stC", Math.round(s.clock) + " MHz", clkPct < 0.95 && s.t > 10 ? "hot" : "");
    set("stP", Math.round(s.power) + " W", "");
    set("stF", s.fanPct + "%", "");
    set("stE", String(s.ecc), s.ecc > 20 ? "crit" : s.ecc > 0 ? "hot" : "good");
    set("stL", Math.round(s.t) + "s", "");
  }

  function biRenderLog() {
    var ui = biUI, sh = ui.sh, i = sh.cardIdx;
    var rows = sh.logs[i];
    var h = "<h4>Burn log, S/N " + biEsc(sh.cards[i].serial) + "</h4>";
    if (!rows.length) {
      ui.log.innerHTML = h + '<p class="empty">No runs yet. Design a profile and run the chamber.</p>';
      return;
    }
    h += '<table><tr><th>Run</th><th>Workload</th><th>Power</th><th>Fan</th><th>Soak</th><th>Peak temp</th><th>Avg clock</th><th>ECC</th><th>Result</th></tr>';
    rows.forEach(function (r, k) {
      var hot = r.maxT >= BI_T_TARGET ? ' class="hot"' : "";
      var ecc = r.ecc > 0 ? ' class="err"' : "";
      h += "<tr><td>" + (k + 1) + "</td><td>" + biEsc(BI_WORKLOADS[r.workload].label.split(" (")[0]) + "</td>" +
        "<td>" + Math.round(r.powerLimit * 100) + "%</td><td>" + biEsc(r.fan) + "</td>" +
        "<td>" + Math.round(r.dur) + "s</td><td" + hot + ">" + Math.round(r.maxT) + " C</td>" +
        "<td>" + Math.round(r.avgClock) + " MHz</td><td" + ecc + ">" + r.ecc + "</td>" +
        "<td>" + (r.shutdown ? '<span style="color:var(--bad)">SHUTDOWN</span>' : "complete") + "</td></tr>";
    });
    ui.log.innerHTML = h + "</table>";
  }

  function biCanJudge(i) {
    var sh = biUI.sh;
    if (sh.verdicts[i]) return false;
    if (sh.logs[i].some(function (r) { return r.shutdown; })) return false; /* killed cards score 0, no verdict needed */
    var secs = sh.logs[i].reduce(function (a, r) { return a + r.dur; }, 0);
    return secs >= 60;
  }

  function biRenderVerdict() {
    var ui = biUI, sh = ui.sh, i = sh.cardIdx;
    var v = sh.verdicts[i];
    var killed = sh.logs[i].some(function (r) { return r.shutdown; });
    ui.shipBtn.disabled = !biCanJudge(i);
    ui.rmaBtn.disabled = !biCanJudge(i);
    ui.shipBtn.className = "ship" + (v === "ship" ? " called" : "");
    ui.rmaBtn.className = "rma" + (v === "rma" ? " called" : "");
    if (killed && !v) {
      ui.shipBtn.disabled = true; ui.rmaBtn.disabled = true;
      ui.shipBtn.textContent = "CARD DEAD";
      ui.rmaBtn.textContent = "SCRAPPED (0 PTS)";
    } else {
      ui.shipBtn.textContent = "SHIP IT";
      ui.rmaBtn.textContent = "RMA IT";
    }
  }

  function biRenderScore() {
    var ui = biUI, sh = ui.sh;
    var done = sh.verdicts.filter(function (v) { return v; }).length;
    var killed = sh.cards.filter(function (c, i) { return sh.logs[i].some(function (r) { return r.shutdown; }); }).length;
    var best = biLoadBest();
    ui.scoreRow.innerHTML = "Score <b>" + sh.score + " / 300</b> &middot; judged " + done + "/3" +
      (killed ? " &middot; <span style=\"color:var(--bad)\">" + killed + " killed</span>" : "") +
      (best !== null ? " &middot; best " + best : "");
  }

  function biBanner(show, title, body, fail) {
    var ui = biUI;
    ui.banner.className = "bi-banner" + (show ? " show" : "") + (fail ? " fail" : "");
    ui.banner.innerHTML = show ? ("<h4>" + title + "</h4><p>" + body + "</p>") : "";
  }

  /* ---------------- run loop ---------------- */

  function biReadProfile() {
    var ui = biUI;
    return {
      workload: ui.selW.value,
      powerLimit: parseInt(ui.rngP.value, 10) / 100,
      fan: ui.selF.value,
      dur: parseInt(ui.selD.value, 10),
      speed: parseInt(ui.selS.value, 10)
    };
  }

  function biToggleRun() {
    var ui = biUI, sh = ui.sh;
    if (sh.running) { biEndRun(true); return; }
    var i = sh.cardIdx;
    if (sh.verdicts[i]) { biToast("Already judged, pick another card"); return; }
    if (sh.logs[i].some(function (r) { return r.shutdown; })) { biToast("That card is dead"); return; }
    sh.prof = biReadProfile();
    sh.sim = biNewRun();
    sh.sim.prof = sh.prof;
    sh.running = true;
    sh.clockSum = 0; sh.clockN = 0;
    ui.runBtn.textContent = "STOP";
    ui.runBtn.classList.add("running");
    ui.prog.firstChild.style.width = "0%";
    ui.timer = setInterval(biTick, 100);
    biToast("Chamber sealed, burn started");
  }

  function biTick() {
    var ui = biUI, sh = ui.sh;
    if (!sh.running) return;
    var dt = BI_SPEEDS[sh.prof.speed] || 8;
    var card = sh.cards[sh.cardIdx];
    /* Speed is wall-clock only: the explicit Euler step is only stable for
       small dt, so fast ticks are split into stable substeps of <= 8 s. */
    var nSub = Math.max(1, Math.ceil(dt / 8)), sdt = dt / nSub, ev = null, bi;
    for (bi = 0; bi < nSub && !sh.sim.dead; bi++) ev = biStep(sh.sim, card, sh.prof, sdt);
    sh.clockSum += sh.sim.clock; sh.clockN++;
    if (sh.sim.samples.length < 2000) {
      sh.sim.samples.push({ t: sh.sim.t, T: sh.sim.T, clock: sh.sim.clock, power: sh.sim.power, ecc: sh.sim.ecc });
    }
    ui.prog.firstChild.style.width = Math.min(100, sh.sim.t / sh.prof.dur * 100) + "%";
    biRenderStats(sh.sim);
    biDrawCharts();
    if (ev.shutdown) {
      biEndRun(false, true);
      return;
    }
    if (sh.sim.t >= sh.prof.dur) biEndRun(false, false);
  }

  function biEndRun(aborted, shutdown) {
    var ui = biUI, sh = ui.sh;
    if (!sh.running) return;
    clearInterval(ui.timer);
    sh.running = false;
    ui.runBtn.textContent = "RUN CHAMBER";
    ui.runBtn.classList.remove("running");
    var i = sh.cardIdx, s = sh.sim;
    if (!aborted && s.t >= 20) {
      sh.logs[i].push({
        workload: sh.prof.workload,
        powerLimit: sh.prof.powerLimit,
        fan: sh.prof.fan,
        dur: Math.round(s.t),
        maxT: Math.round(s.maxT),
        avgClock: Math.round(sh.clockN ? sh.clockSum / sh.clockN : 0),
        ecc: s.ecc,
        shutdown: !!shutdown
      });
      if (shutdown) biToast("THERMAL SHUTDOWN: card is scrap");
      else biToast("Run logged");
    } else if (aborted) {
      biToast("Run aborted, not logged");
    }
    biRenderAll();
  }

  function biDrawCharts() {
    var ui = biUI;
    if (!ui || !ui.chartCtx) return;
    var s = ui.sh.sim;
    var draw = function (key, get, min, max, color, unit, lines) {
      var c = ui.chartCtx[key];
      if (!c) return;
      var cv = c.cv;
      var W = cv.clientWidth || 300, H = 120;
      if (cv.width !== W * 2) { cv.width = W * 2; cv.height = H * 2; }
      var g = cv.getContext("2d");
      g.setTransform(2, 0, 0, 2, 0, 0);
      g.clearRect(0, 0, W, H);
      g.strokeStyle = "var(--panel)";
      g.lineWidth = 1;
      for (var gy = 0; gy <= 4; gy++) {
        var yy = 8 + (H - 16) * gy / 4;
        g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke();
      }
      if (lines) {
        lines.forEach(function (ln) {
          var ly = 8 + (H - 16) * (1 - (ln.v - min) / (max - min));
          g.strokeStyle = ln.c; g.setLineDash([4, 4]);
          g.beginPath(); g.moveTo(0, ly); g.lineTo(W, ly); g.stroke();
          g.setLineDash([]);
          g.fillStyle = ln.c; g.font = "9px monospace";
          g.fillText(ln.l, 4, Math.max(10, ly - 3));
        });
      }
      var pts = s.samples;
      if (pts.length < 2) return;
      g.strokeStyle = color; g.lineWidth = 1.6;
      g.beginPath();
      var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
      pts.forEach(function (p, k) {
        var x = t1 > t0 ? (p.t - t0) / (t1 - t0) * (W - 8) + 4 : 4;
        var v = get(p);
        var y = 8 + (H - 16) * (1 - Math.min(1, Math.max(0, (v - min) / (max - min))));
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.stroke();
      var last = get(pts[pts.length - 1]);
      g.fillStyle = "#9aa3ad"; g.font = '10px "IBM Plex Mono", monospace';
      g.fillText(unit ? (Math.round(last) + " " + unit) : String(Math.round(last)), W - 64, 16);
    };
    var card = ui.sh.cards[ui.sh.cardIdx];
    draw("cT", function (p) { return p.T; }, 20, 115, "#c7ff38", "C", [
      { v: BI_T_TARGET, c: "var(--ember)", l: "TARGET 83C" },
      { v: BI_T_MAX, c: "var(--bad)", l: "SHUTDOWN 105C" }
    ]);
    draw("cC", function (p) { return p.clock; }, 0, card.boost * 1.05, "var(--ice)", "MHz", [
      { v: card.boost, c: "var(--ice)", l: "RATED " + card.boost }
    ]);
    draw("cP", function (p) { return p.power; }, 0, card.tdp * 1.25, "var(--ember)", "W", [
      { v: card.tdp, c: "var(--ember)", l: "TDP " + card.tdp }
    ]);
    draw("cE", function (p) { return p.ecc; }, 0, Math.max(10, s.ecc * 1.2), "var(--bad)", "errs", null);
  }

  /* ---------------- verdicts, scoring, certificate ---------------- */

  function biVerdict(v) {
    var ui = biUI, sh = ui.sh, i = sh.cardIdx;
    if (!biCanJudge(i)) return;
    sh.verdicts[i] = v;
    var card = sh.cards[i];
    var correct = (v === card.truth);
    if (correct) sh.score += 100;
    biToast(correct ? "Correct call: +100" : "Missed that one");
    biRenderAll();
    biFinishCheck();
  }

  function biFaultName(f) {
    return f === "none" ? "healthy" : f === "paste" ? "dried thermal paste" : "marginal VRAM";
  }

  function biFinishCheck() {
    var ui = biUI, sh = ui.sh;
    var judged = sh.verdicts.filter(function (v) { return v; }).length;
    var killed = sh.cards.filter(function (c, i) { return sh.logs[i].some(function (r) { return r.shutdown; }); }).length;
    if (judged + killed < 3) return;
    sh.finished = true;
    var best = biLoadBest();
    if (best === null || sh.score > best) biSaveBest(sh.score);
    ui.dlBtn.style.display = "";
    var detail = sh.cards.map(function (c, i) {
      var v = sh.verdicts[i];
      var fate = v ? (v === c.truth ? "correct" : "wrong") : "killed in chamber";
      return "S/N " + c.serial + ": " + biFaultName(c.fault) + ", you called " + (v ? v.toUpperCase() : "nothing") + " (" + fate + ")";
    }).join("<br>");
    if (sh.score === 300) {
      biBanner(true, "Clean sweep: 300 / 300",
        "All three cards judged correctly and the chamber stands. " + detail +
        "<br><br>This is the same honesty the TAPEOUT lab promises its buyers: every card ships with its real burn log, faults and all. " +
        "Download the certificate below, it is the artifact this shift produced.",
        false);
    } else {
      var coach = killed
        ? "You cooked " + killed + " card" + (killed > 1 ? "s" : "") + ". Aggressive profiles find faults faster but the shutdown line is real: back the power limit down or open the fan curve before a long soak."
        : "Read the logs again: hot-for-the-power means paste, ECC bursts under the memory workload mean VRAM. Run a fresh shift and hunt each fault with the workload that exposes it.";
      biBanner(true, "Shift complete: " + sh.score + " / 300",
        detail + "<br><br>" + coach + "<br><br>The certificate records exactly what happened, misses included. TAPEOUT publishes burn logs, not marketing.",
        true);
    }
    biRenderScore();
  }

  function biDownload() {
    var ui = biUI, sh = ui.sh;
    var lines = [];
    lines.push("BURN-IN CHAMBER: QUALIFICATION CERTIFICATE");
    lines.push("The Proving Ground, " + new Date().toISOString().slice(0, 10));
    lines.push("Lab: TAPEOUT compute-part qualification");
    lines.push("----------------------------------------");
    sh.cards.forEach(function (c, i) {
      lines.push("");
      lines.push("CARD " + (i + 1) + ": " + c.model + "  S/N " + c.serial);
      lines.push("Hidden condition: " + biFaultName(c.fault));
      sh.logs[i].forEach(function (r, k) {
        lines.push("  Run " + (k + 1) + ": " + r.workload + " @ " + Math.round(r.powerLimit * 100) + "%, fan " + r.fan +
          ", " + r.dur + "s soak, peak " + r.maxT + "C, avg clock " + r.avgClock + " MHz, ECC " + r.ecc +
          (r.shutdown ? " *** THERMAL SHUTDOWN ***" : ""));
      });
      var v = sh.verdicts[i];
      lines.push("  Verdict: " + (v ? v.toUpperCase() : "none (card killed)") +
        (v ? (v === c.truth ? " (correct)" : " (WRONG)") : ""));
    });
    lines.push("");
    lines.push("SHIFT SCORE: " + sh.score + " / 300");
    lines.push("----------------------------------------");
    lines.push("Every card ships with its real burn log. That is the TAPEOUT promise.");
    lines.push("End of certificate.");
    var blob = new Blob([lines.join("\n")], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = "burn-in-chamber-certificate.txt";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      (window.URL || window.webkitURL).revokeObjectURL(a.href);
      a.remove();
    }, 500);
    biToast("Certificate downloaded");
  }

  /* ---------------- init ---------------- */

  function biInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    biBuild();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", biInit);
    } else {
      biInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      BI: {
        step: biStep, fanH: biFanH, makeCards: biMakeCards, newRun: biNewRun,
        WORKLOADS: BI_WORKLOADS, FANS: BI_FANS,
        T_AMB: BI_T_AMB, T_TARGET: BI_T_TARGET, T_MAX: BI_T_MAX
      }
    });
  }

})();
/* ============================================================
   THE CACHE FORGE
   An RV32I L1 data-cache tuning bench: real set-associative cache
   simulation with LRU replacement, animated set grid, address
   breakdown, AMAT scoring, three qualification trials, and a
   downloadable Cache Architect certificate.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- tiny helpers (module-local) ---------------- */
  function cf$(id) { return document.getElementById(id); }
  function cfEl(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function cfEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function cfToast(msg) {
    var t = cf$("cfToastBox");
    if (!t) {
      t = cfEl("div", "cf-toast");
      t.id = "cfToastBox";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 2200);
  }
  function cfHex(n, pad) {
    var h = (n >>> 0).toString(16).toUpperCase();
    while (h.length < pad) h = "0" + h;
    return "0x" + h;
  }

  /* ---------------- simulation core (pure, testable) ---------------- */
  function cfLog2i(x) { var n = 0; while ((1 << n) < x) n++; return n; }

  function cfNewCache(sizeKB, assoc, blockB) {
    var sets = (sizeKB * 1024) / (assoc * blockB);
    var lines = [];
    for (var s = 0; s < sets; s++) {
      var ways = [];
      for (var w = 0; w < assoc; w++) ways.push({ tag: -1, age: 0 });
      lines.push(ways);
    }
    return { sizeKB: sizeKB, assoc: assoc, blockB: blockB, sets: sets, lines: lines, tick: 0 };
  }

  function cfAccess(c, addr) {
    var blockAddr = Math.floor(addr / c.blockB);
    var set = blockAddr % c.sets;
    var tag = Math.floor(blockAddr / c.sets);
    var ways = c.lines[set];
    c.tick++;
    for (var w = 0; w < ways.length; w++) {
      if (ways[w].tag === tag) { ways[w].age = c.tick; return { hit: true, set: set, way: w, tag: tag }; }
    }
    var lru = 0;
    for (var k = 1; k < ways.length; k++) if (ways[k].age < ways[lru].age) lru = k;
    var evicted = ways[lru].tag;
    ways[lru].tag = tag;
    ways[lru].age = c.tick;
    return { hit: false, set: set, way: lru, tag: tag, evicted: evicted };
  }

  function cfDecompose(addr, blockB, sets) {
    var offB = cfLog2i(blockB), idxB = cfLog2i(sets);
    var blockAddr = Math.floor(addr / blockB);
    return {
      offset: addr % blockB, set: blockAddr % sets, tag: Math.floor(blockAddr / sets),
      offB: offB, idxB: idxB, tagB: 32 - offB - idxB
    };
  }

  var CF_BASE = 0x80000000;
  function cfTraceLoop() {
    var a = [];
    for (var i = 0; i < 600; i++) a.push(CF_BASE + (i % 16) * 4);
    return a;
  }
  function cfTraceMatrix() {
    var a = [];
    for (var c = 0; c < 64; c++) for (var r = 0; r < 64; r++) a.push(CF_BASE + (r * 64 + c) * 4);
    return a;
  }
  function cfTraceSweep() {
    var a = [];
    for (var i = 0; i < 1536 * 2; i++) a.push(CF_BASE + (i % 1536) * 4);
    return a;
  }
  var CF_TRACES = {
    loop:   { label: "HOT LOOP (lw storm)", desc: "600 loads from a 16-word kernel. Pure temporal locality: anything should catch it." },
    matrix: { label: "COLUMN WALK (64x64 int matrix)", desc: "4096 loads, column-major over a 16KB matrix. Each row is 256 bytes away: block size decides." },
    sweep:  { label: "DOUBLE SWEEP (6KB array, 2 passes)", desc: "3072 loads, sequential scan twice. Spatial locality pays, capacity hurts." }
  };
  function cfGetTrace(key) {
    if (key === "matrix") return cfTraceMatrix();
    if (key === "sweep") return cfTraceSweep();
    return cfTraceLoop();
  }
  function cfFullSim(trace, cfg) {
    var c = cfNewCache(cfg.sizeKB, cfg.assoc, cfg.blockB);
    var hits = 0;
    for (var i = 0; i < trace.length; i++) if (cfAccess(c, trace[i]).hit) hits++;
    var rate = hits / trace.length;
    return { hits: hits, misses: trace.length - hits, n: trace.length, rate: rate, amat: 1 + (1 - rate) * 120 };
  }

  var CF_TRIALS = [
    {
      id: 0, trace: "loop", name: "Trial 1: The Hot Loop",
      goal: "Hit rate of at least 92% on the HOT LOOP trace.",
      pass: function (r) { return r.rate >= 0.92; },
      metric: function (r) { return "hit rate " + (r.rate * 100).toFixed(1) + "% (need 92.0%)"; },
      hint: "Any cache you can bolt together passes this one. It is here to teach the controls: try STEP, then RUN, and watch the set grid."
    },
    {
      id: 1, trace: "matrix", name: "Trial 2: The Column Walk",
      goal: "Hit rate of at least 85% on the COLUMN WALK trace.",
      pass: function (r) { return r.rate >= 0.85; },
      metric: function (r) { return "hit rate " + (r.rate * 100).toFixed(1) + "% (need 85.0%)"; },
      hint: "The walk strides 256 bytes between rows, so small blocks fetch neighbors nobody reads. Fit the 16KB working set and spend silicon on block size: 32-byte blocks are the floor, 64 is comfortable."
    },
    {
      id: 2, trace: "sweep", name: "Trial 3: The Silicon Budget",
      goal: "AMAT of 3.0 cycles or less on the DOUBLE SWEEP trace, with at most 8KB of cache.",
      pass: function (r, cfg) { return cfg.sizeKB <= 8 && r.amat <= 3.0; },
      metric: function (r, cfg) { return "AMAT " + r.amat.toFixed(2) + " cycles at " + cfg.sizeKB + "KB (need <= 3.00, <= 8KB)"; },
      hint: "Size alone cannot save you here: the sweep's locality is spatial, not temporal. The lever is block size. Try the biggest line the die allows at exactly 8KB."
    }
  ];

  /* ---------------- styles ---------------- */
  var CF_CSS = [
    ".cf-overlay{position:fixed;inset:0;background:rgba(4,7,7,.93);z-index:95;display:none;overflow-y:auto;padding:18px 12px;}",
    ".cf-overlay.open{display:block;}",
    ".cf-panel{max-width:1140px;margin:0 auto;background:var(--panel);border:1px solid var(--line);padding:22px;}",
    ".cf-panel h3{font-family:var(--font-d);font-size:26px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.02em;color:var(--acid);}",
    ".cf-sub{font-size:12px;line-height:1.65;color:var(--steel);margin:0 0 14px;max-width:82ch;}",
    ".cf-sub a{color:var(--cyan);text-decoration:none;border-bottom:1px dotted var(--cyan);}",
    ".cf-sub b{color:var(--orange);}",
    ".cf-close{float:right;background:var(--panel-2);border:1px solid var(--line);color:var(--paper);font:inherit;font-size:12px;padding:10px 16px;cursor:pointer;min-height:44px;}",
    ".cf-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}",
    ".cf-tab{background:var(--panel-2);border:1px solid var(--line);color:var(--paper);font:inherit;font-size:11px;letter-spacing:.1em;padding:10px 18px;cursor:pointer;min-height:48px;}",
    ".cf-tab.on{border-color:var(--acid);color:var(--acid);}",
    ".cf-ctl{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px;}",
    ".cf-field{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;}",
    ".cf-field h4{margin:0 0 6px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".cf-field select{width:100%;background:var(--black,#0a0f0e);border:1px solid var(--line);color:var(--paper);font:inherit;font-size:12px;padding:10px 8px;min-height:44px;}",
    ".cf-field input[type=range]{width:100%;accent-color:var(--acid);min-height:44px;}",
    ".cf-field .val{font-family:var(--font-m);font-size:13px;color:var(--acid);}",
    ".cf-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;}",
    ".cf-toolbar .secondary{min-height:48px;font-size:12px;padding:10px 18px;}",
    ".cf-run{border-color:var(--acid) !important;color:var(--acid) !important;font-weight:700;}",
    ".cf-run.running{border-color:var(--bad) !important;color:var(--bad) !important;}",
    ".cf-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px;}",
    ".cf-tile{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;}",
    ".cf-tile h4{margin:0 0 4px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".cf-tile p{margin:0;font-family:var(--font-m);font-size:18px;color:var(--paper);}",
    ".cf-tile p.good{color:var(--acid);}",
    ".cf-tile p.bad{color:var(--orange);}",
    ".cf-break{border:1px solid var(--line);background:var(--panel);padding:10px 14px;margin-bottom:12px;font-family:var(--font-m);font-size:12px;color:var(--paper);line-height:1.7;}",
    ".cf-break .hit{color:var(--cyan);font-weight:700;}",
    ".cf-break .miss{color:var(--orange);font-weight:700;}",
    ".cf-break .lbl{color:var(--steel);font-size:10px;letter-spacing:.1em;}",
    ".cf-gridbox{border:1px solid var(--line);background:var(--panel);padding:12px;margin-bottom:12px;}",
    ".cf-gridbox h4{margin:0 0 8px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".cf-grid{display:flex;flex-wrap:wrap;gap:2px;max-height:180px;overflow-y:auto;}",
    ".cf-cell{width:9px;height:9px;background:var(--panel);border:1px solid #0a0f0e;}",
    ".cf-cell.p1{background:#2e4a2a;}.cf-cell.p2{background:#5a7a2e;}.cf-cell.p3{background:#8aa832;}.cf-cell.full{background:var(--acid);}",
    ".cf-cell.hit{outline:2px solid var(--cyan);outline-offset:-2px;}",
    ".cf-cell.miss{outline:2px solid var(--orange);outline-offset:-2px;}",
    ".cf-legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:10px;color:var(--steel);letter-spacing:.06em;}",
    ".cf-legend i{display:inline-block;width:10px;height:10px;margin-right:4px;vertical-align:-1px;}",
    ".cf-ways{border:1px solid var(--line);background:var(--panel);padding:12px;margin-bottom:12px;}",
    ".cf-ways h4{margin:0 0 8px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".cf-way{display:grid;grid-template-columns:64px 1fr auto;gap:10px;align-items:center;font-family:var(--font-m);font-size:12px;padding:6px 8px;border:1px solid var(--line);margin-bottom:4px;color:var(--steel);}",
    ".cf-way .tag{color:var(--paper);}",
    ".cf-way.hit{border-color:var(--cyan);background:rgba(88,228,232,.06);}",
    ".cf-way.miss{border-color:var(--orange);background:rgba(255,107,44,.06);}",
    ".cf-way .st{font-size:10px;letter-spacing:.1em;}",
    ".cf-trial{border:1px solid var(--line);background:var(--panel-2);padding:14px 16px;margin-bottom:10px;}",
    ".cf-trial h4{margin:0 0 4px;font-family:var(--font-d);font-size:17px;text-transform:uppercase;color:var(--acid);}",
    ".cf-trial .goal{font-size:12px;color:var(--steel);margin:0 0 10px;line-height:1.6;}",
    ".cf-trial .row{display:flex;flex-wrap:wrap;gap:8px;align-items:end;}",
    ".cf-trial select{background:var(--black,#0a0f0e);border:1px solid var(--line);color:var(--paper);font:inherit;font-size:12px;padding:10px 8px;min-height:48px;min-width:110px;}",
    ".cf-trial .secondary{min-height:48px;font-size:12px;padding:10px 18px;}",
    ".cf-trial label{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--cyan);display:block;margin-bottom:4px;}",
    ".cf-result{margin-top:10px;font-family:var(--font-m);font-size:12px;line-height:1.7;padding:10px 12px;border:1px solid var(--line);display:none;}",
    ".cf-result.show{display:block;}",
    ".cf-result.pass{border-color:var(--acid);color:var(--acid);}",
    ".cf-result.fail{border-color:var(--orange);color:var(--orange);}",
    ".cf-result .hint{color:var(--steel);display:block;margin-top:6px;}",
    ".cf-scorebar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px;border:1px dashed var(--orange);padding:12px 14px;background:rgba(255,107,44,.05);}",
    ".cf-scorebar .pts{font-family:var(--font-m);font-size:20px;color:var(--orange);}",
    ".cf-scorebar .txt{font-size:12px;color:var(--paper);line-height:1.6;}",
    ".cf-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--panel);border:1px solid var(--acid);color:var(--acid);font-family:var(--font-m);font-size:12px;padding:10px 18px;z-index:200;opacity:0;pointer-events:none;transition:opacity .1s;}",
    ".cf-toast.show{opacity:1;}",
    "@media (max-width:900px){.cf-panel{padding:14px;}.cf-way{grid-template-columns:52px 1fr auto;}}"
  ].join("\n");

  /* ---------------- UI state ---------------- */
  var ui = null;
  var CF_MISS_PENALTY = 120;

  function cfBuild() {
    if (ui) return ui;
    var st = document.createElement("style");
    st.textContent = CF_CSS;
    document.head.appendChild(st);

    var box = document.querySelector(".dossier .actions");
    if (box && !cf$("cfBtn")) {
      var b = cfEl("button", "secondary", "Run the Cache Forge");
      b.id = "cfBtn";
      b.addEventListener("click", function () { cf$("cfOverlay").classList.add("open"); });
      box.appendChild(b);
    }

    var ov = cfEl("div", "cf-overlay");
    ov.id = "cfOverlay";
    var panel = cfEl("div", "cf-panel");
    ov.appendChild(panel);
    document.body.appendChild(ov);

    panel.innerHTML =
      '<button class="cf-close" id="cfClose">CLOSE [x]</button>' +
      "<h3>The Cache Forge</h3>" +
      '<p class="cf-sub">A set-associative L1 data-cache bench for the kind of ' +
      '<a href="https://dillingerstaffing.github.io/portfolio/" target="_blank" rel="noopener">RV32I pipeline work</a> ' +
      "that pays the bills: real LRU replacement, real address decomposition, real AMAT math " +
      "(hit 1 cycle, miss penalty " + CF_MISS_PENALTY + " cycles). " +
      "Pick a workload, tune the silicon, and watch every load land: <b>cyan</b> is a hit, <b>orange</b> is a miss. " +
      "Free-forge in EXPLORE, then qualify in TRIALS: three workloads, three pass marks, one Cache Architect certificate.</p>";

    /* tabs */
    var tabs = cfEl("div", "cf-tabs");
    var tExp = cfEl("button", "cf-tab on", "EXPLORE");
    var tTri = cfEl("button", "cf-tab", "TRIALS");
    tabs.appendChild(tExp); tabs.appendChild(tTri);
    panel.appendChild(tabs);

    var pageExp = cfEl("div", null, "");
    var pageTri = cfEl("div", null, "");
    pageTri.style.display = "none";
    panel.appendChild(pageExp);
    panel.appendChild(pageTri);

    tExp.addEventListener("click", function () {
      tExp.classList.add("on"); tTri.classList.remove("on");
      pageExp.style.display = ""; pageTri.style.display = "none";
    });
    tTri.addEventListener("click", function () {
      tTri.classList.add("on"); tExp.classList.remove("on");
      pageTri.style.display = ""; pageExp.style.display = "none";
    });
    cf$("cfClose").addEventListener("click", function () {
      cfStopRun();
      ov.classList.remove("open");
    });

    ui = { ov: ov, tExp: tExp, tTri: tTri, pageExp: pageExp, pageTri: pageTri };
    cfBuildExplore();
    cfBuildTrials();
    return ui;
  }

  function cfSelect(opts, val) {
    var s = document.createElement("select");
    opts.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o; op.textContent = o;
      s.appendChild(op);
    });
    s.value = val;
    return s;
  }

  /* ================= EXPLORE ================= */
  var ex = null;

  function cfBuildExplore() {
    var p = ui.pageExp;

    /* controls */
    var ctl = cfEl("div", "cf-ctl");
    function field(title) {
      var f = cfEl("div", "cf-field", "<h4>" + cfEsc(title) + "</h4>");
      ctl.appendChild(f);
      return f;
    }
    var fs = field("Cache size"); ex = {};
    ex.selSize = cfSelect(["4", "8", "16", "32"], "8"); fs.appendChild(ex.selSize);
    var fa = field("Associativity");
    ex.selAssoc = cfSelect(["1", "2", "4", "8"], "4"); fa.appendChild(ex.selAssoc);
    var fb = field("Block size");
    ex.selBlock = cfSelect(["16", "32", "64", "128"], "64"); fb.appendChild(ex.selBlock);
    var ft = field("Workload");
    ex.selTrace = document.createElement("select");
    Object.keys(CF_TRACES).forEach(function (k) {
      var op = document.createElement("option");
      op.value = k; op.textContent = CF_TRACES[k].label;
      ex.selTrace.appendChild(op);
    });
    ft.appendChild(ex.selTrace);
    var fsp = field("Run speed");
    ex.rngSpeed = document.createElement("input");
    ex.rngSpeed.type = "range"; ex.rngSpeed.min = "1"; ex.rngSpeed.max = "300"; ex.rngSpeed.value = "40";
    var vsp = cfEl("div", "val", "40 loads/tick");
    ex.rngSpeed.addEventListener("input", function () { vsp.textContent = ex.rngSpeed.value + " loads/tick"; });
    fsp.appendChild(ex.rngSpeed); fsp.appendChild(vsp);
    p.appendChild(ctl);

    ex.traceDesc = cfEl("p", "cf-sub", "");
    p.appendChild(ex.traceDesc);

    /* toolbar */
    var tb = cfEl("div", "cf-toolbar");
    ex.btnStep = cfEl("button", "secondary", "STEP 1");
    ex.btnRun = cfEl("button", "secondary cf-run", "RUN");
    ex.btnReset = cfEl("button", "secondary", "RESET");
    tb.appendChild(ex.btnStep); tb.appendChild(ex.btnRun); tb.appendChild(ex.btnReset);
    p.appendChild(tb);

    /* tiles */
    var tiles = cfEl("div", "cf-tiles");
    var names = [["LOADS", "tLoads"], ["HITS", "tHits"], ["MISSES", "tMiss"], ["HIT RATE", "tRate"], ["AMAT", "tAmat"]];
    ex.tiles = {};
    names.forEach(function (n) {
      var t = cfEl("div", "cf-tile", "<h4>" + n[0] + "</h4><p>0</p>");
      ex.tiles[n[1]] = t.querySelector("p");
      tiles.appendChild(t);
    });
    p.appendChild(tiles);

    /* address breakdown */
    ex.brk = cfEl("div", "cf-break", '<span class="lbl">LAST LOAD</span><br>press STEP or RUN');
    p.appendChild(ex.brk);

    /* set grid */
    var gb = cfEl("div", "cf-gridbox", "<h4>Set occupancy (one cell per set, brighter = fuller)</h4>");
    ex.grid = cfEl("div", "cf-grid");
    gb.appendChild(ex.grid);
    var leg = cfEl("div", "cf-legend",
      '<span><i style="background:var(--panel)"></i>empty</span>' +
      '<span><i style="background:#8aa832"></i>filling</span>' +
      '<span><i style="background:var(--acid)"></i>full</span>' +
      '<span><i style="background:var(--cyan)"></i>last hit</span>' +
      '<span><i style="background:var(--orange)"></i>last miss</span>');
    gb.appendChild(leg);
    p.appendChild(gb);

    /* way detail */
    var wb = cfEl("div", "cf-ways", "<h4>Last touched set: way detail</h4>");
    ex.ways = cfEl("div", null, '<p class="cf-sub">No load yet.</p>');
    wb.appendChild(ex.ways);
    p.appendChild(wb);

    ex.btnStep.addEventListener("click", function () { cfStep(1); });
    ex.btnRun.addEventListener("click", function () {
      if (ex.timer) { cfStopRun(); } else { cfStartRun(); }
    });
    ex.btnReset.addEventListener("click", cfResetExplore);
    [ex.selSize, ex.selAssoc, ex.selBlock, ex.selTrace].forEach(function (s) {
      s.addEventListener("change", cfResetExplore);
    });

    cfResetExplore();
  }

  function cfCfg() {
    return {
      sizeKB: parseInt(ex.selSize.value, 10),
      assoc: parseInt(ex.selAssoc.value, 10),
      blockB: parseInt(ex.selBlock.value, 10)
    };
  }

  function cfResetExplore() {
    cfStopRun();
    var cfg = cfCfg();
    ex.cache = cfNewCache(cfg.sizeKB, cfg.assoc, cfg.blockB);
    ex.cfg = cfg;
    ex.traceKey = ex.selTrace.value;
    ex.trace = cfGetTrace(ex.traceKey);
    ex.pos = 0; ex.hits = 0; ex.misses = 0; ex.last = null;
    ex.occ = new Array(ex.cache.sets).fill(0);
    ex.traceDesc.innerHTML = "<b>" + cfEsc(CF_TRACES[ex.traceKey].label) + "</b>: " +
      cfEsc(CF_TRACES[ex.traceKey].desc) + " (" + ex.trace.length + " loads)";
    cfRenderGrid();
    cfRenderStats();
    ex.brk.innerHTML = '<span class="lbl">LAST LOAD</span><br>press STEP or RUN';
    ex.ways.innerHTML = '<p class="cf-sub">No load yet.</p>';
    ex.btnRun.textContent = "RUN";
    ex.btnRun.classList.remove("running");
  }

  function cfRenderStats() {
    var n = ex.pos;
    var rate = n ? ex.hits / n : 0;
    var amat = n ? 1 + (1 - rate) * CF_MISS_PENALTY : 1;
    ex.tiles.tLoads.textContent = String(n);
    ex.tiles.tHits.textContent = String(ex.hits);
    ex.tiles.tMiss.textContent = String(ex.misses);
    ex.tiles.tRate.textContent = (rate * 100).toFixed(1) + "%";
    ex.tiles.tAmat.textContent = amat.toFixed(2) + "c";
    ex.tiles.tRate.className = rate >= 0.9 ? "good" : (rate >= 0.5 ? "" : "bad");
    ex.tiles.tAmat.className = amat <= 4 ? "good" : (amat <= 30 ? "" : "bad");
  }

  function cfRenderGrid() {
    ex.grid.innerHTML = "";
    ex.cells = [];
    for (var s = 0; s < ex.cache.sets; s++) {
      var c = cfEl("div", "cf-cell");
      ex.grid.appendChild(c);
      ex.cells.push(c);
    }
    cfPaintOcc(-1);
  }

  function cfPaintOcc(lastSet, lastKind) {
    for (var s = 0; s < ex.cells.length; s++) {
      var occ = ex.occ[s], a = ex.cfg.assoc;
      var cls = "cf-cell";
      var frac = occ / a;
      if (frac >= 1) cls += " full";
      else if (frac >= 0.66) cls += " p3";
      else if (frac >= 0.33) cls += " p2";
      else if (frac > 0) cls += " p1";
      if (s === lastSet) cls += (lastKind === "hit" ? " hit" : " miss");
      ex.cells[s].className = cls;
    }
  }

  function cfRenderBreak(addr, res) {
    var d = cfDecompose(addr, ex.cfg.blockB, ex.cache.sets);
    var tagHex = cfHex(d.tag, Math.max(1, Math.ceil(d.tagB / 4)));
    var kind = res.hit ? '<span class="hit">HIT</span>' : '<span class="miss">MISS</span>';
    ex.brk.innerHTML =
      '<span class="lbl">LAST LOAD</span> ' + kind + "<br>" +
      cfHex(addr, 8) + " = tag " + tagHex + " | set " + d.set + " | offset " + d.offset + "<br>" +
      '<span class="lbl">ADDRESS SPLIT</span> tag ' + d.tagB + "b | index " + d.idxB + "b | offset " + d.offB + "b" +
      (res.hit ? "" : ' &nbsp;<span class="lbl">EVICTED WAY ' + res.way + (res.evicted >= 0 ? " (tag " + cfHex(res.evicted, 4) + ")" : " (empty slot)") + "</span>");
  }

  function cfRenderWays(setIdx, res) {
    var ways = ex.cache.lines[setIdx];
    ex.ways.innerHTML = "";
    var head = cfEl("p", "cf-sub", "Set " + setIdx + " of " + ex.cache.sets + ", " + ex.cfg.assoc + "-way");
    ex.ways.appendChild(head);
    ways.forEach(function (w, i) {
      var row = cfEl("div", "cf-way" + (i === res.way ? (res.hit ? " hit" : " miss") : ""),
        '<span>WAY ' + i + "</span>" +
        '<span class="tag">' + (w.tag < 0 ? "(empty)" : "tag " + cfHex(w.tag, 6)) + "</span>" +
        '<span class="st">' + (i === res.way ? (res.hit ? "HIT" : "MISS, REPLACED") : "LRU #" + i) + "</span>");
      ex.ways.appendChild(row);
    });
  }

  function cfStep(n) {
    if (ex.pos >= ex.trace.length) { cfToast("Trace exhausted: RESET to forge again"); return; }
    for (var k = 0; k < n && ex.pos < ex.trace.length; k++) {
      var addr = ex.trace[ex.pos];
      var res = cfAccess(ex.cache, addr);
      if (res.hit) ex.hits++; else ex.misses++;
      /* occupancy bookkeeping */
      var filled = 0;
      var ways = ex.cache.lines[res.set];
      for (var w = 0; w < ways.length; w++) if (ways[w].tag >= 0) filled++;
      ex.occ[res.set] = filled;
      ex.last = { addr: addr, res: res };
      ex.pos++;
    }
    var last = ex.last;
    cfPaintOcc(last.res.set, last.res.hit ? "hit" : "miss");
    cfRenderStats();
    cfRenderBreak(last.addr, last.res);
    cfRenderWays(last.res.set, last.res);
    if (ex.pos >= ex.trace.length) {
      cfStopRun();
      var rate = ex.hits / ex.trace.length;
      cfToast("Trace done: " + (rate * 100).toFixed(1) + "% hits, AMAT " + (1 + (1 - rate) * CF_MISS_PENALTY).toFixed(2) + " cycles");
    }
  }

  function cfStartRun() {
    ex.btnRun.textContent = "PAUSE";
    ex.btnRun.classList.add("running");
    ex.timer = setInterval(function () {
      cfStep(parseInt(ex.rngSpeed.value, 10));
    }, 70);
  }
  function cfStopRun() {
    if (ex && ex.timer) { clearInterval(ex.timer); ex.timer = null; }
    if (ex && ex.btnRun) { ex.btnRun.textContent = "RUN"; ex.btnRun.classList.remove("running"); }
  }

  /* ================= TRIALS ================= */
  var tr = null;

  function cfBuildTrials() {
    var p = ui.pageTri;
    tr = { score: 0, passed: [false, false, false], cards: [] };

    var bar = cfEl("div", "cf-scorebar",
      '<span class="pts" id="cfPts">0 / 300</span>' +
      '<span class="txt">Qualification score. Pass all three trials and the <b>Cache Architect</b> certificate unlocks. ' +
      "Each trial runs its full workload instantly against the config you set in its card.</span>");
    p.appendChild(bar);
    tr.ptsEl = bar.querySelector("#cfPts");

    CF_TRIALS.forEach(function (t) {
      var card = cfEl("div", "cf-trial");
      card.innerHTML =
        "<h4>" + cfEsc(t.name) + "</h4>" +
        '<p class="goal">' + cfEsc(t.goal) + ' Workload: <b>' + cfEsc(CF_TRACES[t.trace].label) + "</b>.</p>";
      var row = cfEl("div", "row");
      function lab(title, sel) {
        var wrap = cfEl("div", null, "");
        wrap.innerHTML = "<label>" + cfEsc(title) + "</label>";
        wrap.appendChild(sel);
        row.appendChild(wrap);
      }
      var sSize = cfSelect(["4", "8", "16", "32"], "8");
      var sAssoc = cfSelect(["1", "2", "4", "8"], "4");
      var sBlock = cfSelect(["16", "32", "64", "128"], "64");
      lab("Cache size (KB)", sSize);
      lab("Associativity", sAssoc);
      lab("Block size (B)", sBlock);
      var btn = cfEl("button", "secondary", "RUN TRIAL");
      row.appendChild(btn);
      card.appendChild(row);
      var res = cfEl("div", "cf-result");
      card.appendChild(res);
      btn.addEventListener("click", function () {
        var cfg = {
          sizeKB: parseInt(sSize.value, 10),
          assoc: parseInt(sAssoc.value, 10),
          blockB: parseInt(sBlock.value, 10)
        };
        var r = cfFullSim(cfGetTrace(t.trace), cfg);
        var ok = t.pass(r, cfg);
        res.className = "cf-result show " + (ok ? "pass" : "fail");
        res.innerHTML = (ok ? "PASS: " : "FAIL: ") + cfEsc(t.metric(r, cfg)) +
          '<span class="hint">' + cfEsc(t.hint) + "</span>";
        if (ok && !tr.passed[t.id]) {
          tr.passed[t.id] = true;
          tr.score += 100;
          tr.ptsEl.textContent = tr.score + " / 300";
          cfToast("Trial " + (t.id + 1) + " passed: +100");
          if (tr.score >= 300) cfUnlockCert();
        }
      });
      p.appendChild(card);
      tr.cards.push(card);
    });

    tr.certBtn = cfEl("button", "secondary", "Download Cache Architect certificate");
    tr.certBtn.style.display = "none";
    tr.certBtn.style.marginTop = "10px";
    tr.certBtn.style.minHeight = "52px";
    tr.certBtn.addEventListener("click", cfDownloadCert);
    p.appendChild(tr.certBtn);
  }

  function cfUnlockCert() {
    cfToast("SWEEP: all three trials passed");
    tr.certBtn.style.display = "";
    var bar = tr.ptsEl.parentElement;
    var note = cfEl("span", "txt", " <b>Cache Architect</b> certificate unlocked. Download it below.");
    bar.appendChild(note);
  }

  function cfDownloadCert() {
    var cfgNote = tr.cards.map(function (c, i) { return "Trial " + (i + 1) + ": " + (tr.passed[i] ? "PASS" : "FAIL"); }).join("\n");
    var lines = [
      "===============================================",
      "  THE CACHE FORGE - THE PROVING GROUND",
      "  CACHE ARCHITECT CERTIFICATE",
      "===============================================",
      "",
      "Awarded to the tuner who qualified all three",
      "workloads on the L1 bench:",
      "",
      cfgNote,
      "",
      "Trials: HOT LOOP (600 loads), COLUMN WALK (4096 loads,",
      "64x64 int matrix), DOUBLE SWEEP (3072 loads, 6KB array).",
      "Miss penalty 120 cycles. Real set-associative LRU sim.",
      "",
      "Score: 300 / 300. Full sweep. Ship it.",
      "",
      "Issued " + new Date().toISOString().slice(0, 10) + " by The Proving Ground"
    ];
    var blob = new Blob([lines.join("\n")], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = "cache-forge-certificate.txt";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      (window.URL || window.webkitURL).revokeObjectURL(a.href);
      a.remove();
    }, 500);
    cfToast("Certificate downloaded");
  }

  /* ---------------- init ---------------- */
  function cfInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    cfBuild();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", cfInit);
    } else {
      cfInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      CF: {
        newCache: cfNewCache, access: cfAccess, decompose: cfDecompose,
        traceLoop: cfTraceLoop, traceMatrix: cfTraceMatrix, traceSweep: cfTraceSweep,
        fullSim: cfFullSim, trials: CF_TRIALS, log2i: cfLog2i
      }
    });
  }

})();
/* ============================================================
   THE MEMORY BIN LAB
   GDDR timing qualification bench for the TAPEOUT GPU refurb
   line: a real DRAM command-scheduler simulation. Tune tCL,
   tRCD, tRP, tRAS on three memory modules, watch ACT/RD/WR/PRE
   commands flow across 8 banks on a live trace, then qualify
   each module with a 4000-transaction deterministic pass.
   Pass mark: errors within the ECC budget AND bandwidth at or
   above the module's grade target. Grade is set by silicon
   margin (cycles of headroom over each module's hidden floor).
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- tiny helpers (module-local) ---------------- */
  function mb$(id) { return document.getElementById(id); }
  function mbEl(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function mbEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function mbHex(n, pad) {
    var h = (n >>> 0).toString(16).toUpperCase();
    while (h.length < pad) h = "0" + h;
    return "0x" + h;
  }
  function mbToast(msg) {
    var t = mb$("mbToastBox");
    if (!t) {
      t = mbEl("div", "mb-toast");
      t.id = "mbToastBox";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ---------------- deterministic RNG ---------------- */
  function mbRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mbHashTim(tim) {
    var h = 2166136261;
    [tim.tCL, tim.tRCD, tim.tRP, tim.tRAS].forEach(function (v) {
      h ^= v & 0xff; h = Math.imul(h, 16777619);
    });
    return h >>> 0;
  }

  /* ---------------- module definitions ---------------- */
  var MB_BANKS = 16, MB_ROWS = 4096, MB_BYTES = 128, MB_ECC = 2;
  var MB_MODULES = [
    { sku: "M12A-8G", desc: "8Gb entry die, 12Gbps grade", clockMHz: 1500, targetGBs: 38.5,
      safe: { tCL: 26, tRCD: 26, tRP: 22, tRAS: 48 },
      floor: { tCL: 24, tRCD: 24, tRP: 20, tRAS: 42 }, local: 0.55, seed: 12001 },
    { sku: "M14A-16G", desc: "16Gb mid die, 14Gbps grade", clockMHz: 1750, targetGBs: 40.5,
      safe: { tCL: 26, tRCD: 26, tRP: 22, tRAS: 48 },
      floor: { tCL: 22, tRCD: 22, tRP: 18, tRAS: 40 }, local: 0.45, seed: 14001 },
    { sku: "M16X-24G", desc: "24Gb hot die, 16Gbps grade", clockMHz: 2000, targetGBs: 46.0,
      safe: { tCL: 26, tRCD: 26, tRP: 22, tRAS: 48 },
      floor: { tCL: 20, tRCD: 20, tRP: 16, tRAS: 36 }, local: 0.35, seed: 16001 }
  ];
  var MB_RANGES = {
    tCL:  { min: 16, max: 30, label: "tCL (CAS latency)" },
    tRCD: { min: 16, max: 30, label: "tRCD (RAS to CAS)" },
    tRP:  { min: 12, max: 26, label: "tRP (precharge)" },
    tRAS: { min: 28, max: 56, label: "tRAS (row active)" }
  };

  /* ---------------- simulation core (pure, testable) ---------------- */
  function mbDeficit(floor, tim) {
    var d = 0;
    ["tCL", "tRCD", "tRP", "tRAS"].forEach(function (k) {
      if (tim[k] < floor[k]) d += floor[k] - tim[k];
    });
    return d;
  }
  function mbMargin(floor, tim) {
    var m = 1e9;
    ["tCL", "tRCD", "tRP", "tRAS"].forEach(function (k) {
      var v = tim[k] - floor[k];
      if (v < m) m = v;
    });
    return m;
  }

  function mbSim(mod, tim, nTxns, wantTrace) {
    var rng = mbRng((mod.seed ^ mbHashTim(tim)) >>> 0);
    /* generate the transaction stream up front */
    var lastRowG = [];
    var b;
    for (b = 0; b < MB_BANKS; b++) lastRowG.push(0);
    var txns = [];
    for (var i = 0; i < nTxns; i++) {
      var bank = (rng() * MB_BANKS) | 0;
      var row = rng() < mod.local ? lastRowG[bank] : ((rng() * MB_ROWS) | 0);
      lastRowG[bank] = row;
      txns.push({ bank: bank, row: row, wr: rng() < 0.3, phase: null, issue: 0 });
    }
    /* bank state */
    var openRow = [], tAct = [], tCol = [], lastAct = [];
    for (b = 0; b < MB_BANKS; b++) {
      openRow.push(-1); tAct.push(0); tCol.push(0); lastAct.push(-1e9);
    }
    var deficit = mbDeficit(mod.floor, tim);
    var pErr = deficit > 0 ? 1 - Math.exp(-deficit / 200) : 0;
    var trace = wantTrace ? [] : null;
    var WIN = 8, next = 0, cur = 0;
    var win = [];
    var errors = 0, latSum = 0, reads = 0, rowHits = 0, cmds = 0, done = 0;

    function refreshPhase(t) {
      /* The window reorders transactions, so a phase snapshotted at enqueue
         can be stale by issue time. Re-derive the next legal command from
         live bank state; every issued command is then protocol-legal. */
      if (t.phase === "done") return;
      if (openRow[t.bank] === t.row) t.phase = "col";
      else if (openRow[t.bank] === -1) t.phase = "act";
      else t.phase = "pre";
    }
    function enqueuePhase(t) {
      refreshPhase(t);
    }
    function earliest(t) {
      var bk = t.bank;
      if (t.phase === "pre") return Math.max(cur, lastAct[bk] + tim.tRAS);
      if (t.phase === "act") return Math.max(cur, tAct[bk]);
      return Math.max(cur, tCol[bk]);
    }
    function issueCmd(t, e) {
      var bk = t.bank;
      if (t.phase === "pre") {
        if (trace) trace.push({ c: "P", bank: bk });
        openRow[bk] = -1;
        tAct[bk] = e + tim.tRP;
        t.phase = "act";
      } else if (t.phase === "act") {
        if (trace) trace.push({ c: "A", bank: bk });
        lastAct[bk] = e;
        tCol[bk] = e + tim.tRCD;
        openRow[bk] = t.row;
        t.didAct = true;
        t.phase = "col";
      } else {
        if (trace) trace.push({ c: t.wr ? "W" : "R", bank: bk });
        if (!t.didAct) rowHits++;
        if (!t.wr) { latSum += (e + tim.tCL) - t.issue; reads++; }
        t.phase = "done";
      }
      cmds++;
      return e + 1;
    }

    while (done < nTxns) {
      while (win.length < WIN && next < nTxns) {
        var t = txns[next++];
        t.issue = cur;
        enqueuePhase(t);
        win.push(t);
      }
      /* FR-FCFS: pick the pending txn whose next command can issue earliest */
      var best = -1, bestE = 1e18;
      for (var w = 0; w < win.length; w++) {
        refreshPhase(win[w]);
        var e = earliest(win[w]);
        if (e < bestE) { bestE = e; best = w; }
      }
      var bt = win[best];
      cur = issueCmd(bt, Math.max(cur, bestE));
      if (bt.phase === "done") {
        if (pErr > 0 && rng() < pErr) errors++;
        win.splice(best, 1);
        done++;
      }
    }
    var cycles = cur + (reads ? tim.tCL : 0);
    var bytes = nTxns * MB_BYTES;
    return {
      txns: nTxns, cycles: cycles, cmds: cmds,
      gbs: bytes / cycles * mod.clockMHz / 1000,
      avgLat: reads ? latSum / reads : 0,
      rowHitPct: nTxns ? 100 * rowHits / nTxns : 0,
      errors: errors, margin: mbMargin(mod.floor, tim),
      deficit: deficit, trace: trace
    };
  }

  function mbGrade(res) {
    if (res.margin >= 3) return "A";
    if (res.margin >= 0) return "B";
    return "C";
  }
  function mbVerdict(mod, res) {
    if (res.errors > MB_ECC)
      return { pass: false, why: res.errors + " bit errors (ECC budget " + MB_ECC + ")" };
    if (res.gbs < mod.targetGBs)
      return { pass: false, why: res.gbs.toFixed(1) + " GB/s under the " + mod.targetGBs.toFixed(1) + " GB/s target" };
    return { pass: true, why: "qualified" };
  }

  /* ---------------- styles ---------------- */
  var MB_CSS = [
    ".mb-overlay{position:fixed;inset:0;background:rgba(4,7,7,.93);z-index:95;display:none;overflow-y:auto;padding:18px 12px;}",
    ".mb-overlay.open{display:block;}",
    ".mb-panel{max-width:1140px;margin:0 auto;background:var(--panel);border:1px solid var(--line);padding:22px;}",
    ".mb-panel h3{font-family:var(--font-d);font-size:26px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.02em;color:var(--acid);}",
    ".mb-sub{font-size:12px;line-height:1.65;color:var(--steel);margin:0 0 14px;max-width:82ch;}",
    ".mb-sub a{color:var(--cyan);text-decoration:none;border-bottom:1px dotted var(--cyan);}",
    ".mb-close{float:right;background:var(--panel-2);border:1px solid var(--line);color:var(--paper);font:inherit;font-size:12px;padding:10px 16px;cursor:pointer;min-height:44px;}",
    ".mb-deck{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:12px;}",
    ".mb-mod{border:1px solid var(--line);background:var(--panel-2);padding:12px 14px;cursor:pointer;min-height:44px;}",
    ".mb-mod h4{margin:0 0 4px;font-family:var(--font-d);font-size:16px;color:var(--paper);}",
    ".mb-mod p{margin:0 0 6px;font-size:11px;color:var(--steel);line-height:1.5;}",
    ".mb-mod.sel{border-color:var(--acid);}",
    ".mb-mod .stamp{font-size:10px;letter-spacing:.12em;font-weight:700;}",
    ".mb-mod .stamp.pass{color:var(--acid);}",
    ".mb-mod .stamp.fail{color:var(--orange);}",
    ".mb-ctl{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px;}",
    ".mb-field{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;}",
    ".mb-field h4{margin:0 0 6px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".mb-field input[type=range]{width:100%;accent-color:var(--acid);min-height:44px;}",
    ".mb-field .val{font-family:var(--font-m);font-size:13px;color:var(--acid);}",
    ".mb-field .val.neg{color:var(--orange);}",
    ".mb-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;}",
    ".mb-toolbar .secondary{min-height:48px;font-size:12px;padding:10px 18px;}",
    ".mb-run{border-color:var(--acid) !important;color:var(--acid) !important;font-weight:700;}",
    ".mb-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px;}",
    ".mb-tile{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;}",
    ".mb-tile h4{margin:0 0 4px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".mb-tile p{margin:0;font-family:var(--font-m);font-size:18px;color:var(--paper);}",
    ".mb-tile p.good{color:var(--acid);}.mb-tile p.bad{color:var(--orange);}",
    ".mb-banks{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;margin-bottom:12px;}",
    ".mb-bank{border:1px solid var(--line);background:var(--panel);padding:8px 10px;font-family:var(--font-m);font-size:11px;color:var(--steel);}",
    ".mb-bank b{display:block;font-size:10px;letter-spacing:.1em;color:var(--cyan);margin-bottom:4px;}",
    ".mb-bank.open{border-color:var(--cyan);color:var(--paper);}",
    ".mb-tracebox{border:1px solid var(--line);background:var(--panel);padding:12px;margin-bottom:12px;}",
    ".mb-tracebox h4{margin:0 0 8px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".mb-trace{display:flex;flex-wrap:wrap;gap:2px;min-height:26px;}",
    ".mb-c{width:14px;height:22px;display:inline-block;border:1px solid #0a0f0e;font-family:var(--font-m);font-size:9px;line-height:22px;text-align:center;color:#04110f;}",
    ".mb-c.A{background:var(--acid);}.mb-c.R{background:var(--cyan);}.mb-c.W{background:var(--orange);}.mb-c.P{background:var(--line);color:#0a0f0e;}",
    ".mb-legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:10px;color:var(--steel);letter-spacing:.06em;}",
    ".mb-legend i{display:inline-block;width:10px;height:10px;margin-right:4px;vertical-align:-1px;}",
    ".mb-verdict{border:1px solid var(--line);padding:14px 16px;margin-bottom:12px;font-family:var(--font-m);font-size:13px;line-height:1.7;display:none;}",
    ".mb-verdict.show{display:block;}",
    ".mb-verdict.pass{border-color:var(--acid);background:rgba(199,255,56,.05);}",
    ".mb-verdict.fail{border-color:var(--orange);background:rgba(255,107,44,.06);}",
    ".mb-verdict .big{font-family:var(--font-d);font-size:20px;letter-spacing:.06em;}",
    ".mb-verdict.pass .big{color:var(--acid);}.mb-verdict.fail .big{color:var(--orange);}",
    ".mb-log{border:1px solid var(--line);background:var(--panel);padding:12px 14px;margin-bottom:12px;font-family:var(--font-m);font-size:12px;line-height:1.8;color:var(--steel);max-height:150px;overflow-y:auto;}",
    ".mb-log .p{color:var(--acid);}.mb-log .f{color:var(--orange);}",
    ".mb-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);background:var(--panel);border:1px solid var(--acid);color:var(--paper);padding:12px 20px;font-size:13px;opacity:0;pointer-events:none;transition:opacity .12s,transform .12s;z-index:200;max-width:90vw;}",
    ".mb-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}",
    "@media (max-width:640px){.mb-panel{padding:14px;}.mb-panel h3{font-size:20px;}}"
  ].join("\n");

  /* ---------------- UI ---------------- */
  var ui = null, probeTimer = null;

  function mbBuild() {
    if (ui) return ui;
    var st = document.createElement("style");
    st.textContent = MB_CSS;
    document.head.appendChild(st);

    var box = document.querySelector(".dossier .actions");
    if (box && !mb$("mbBtn")) {
      var b = mbEl("button", "secondary", "Run the Memory Bin Lab");
      b.id = "mbBtn";
      b.addEventListener("click", function () { mb$("mbOverlay").classList.add("open"); });
      box.appendChild(b);
    }

    var ov = mbEl("div", "mb-overlay");
    ov.id = "mbOverlay";
    var panel = mbEl("div", "mb-panel");
    ov.appendChild(panel);
    document.body.appendChild(ov);

    panel.innerHTML =
      '<button class="mb-close" id="mbClose">CLOSE [x]</button>' +
      "<h3>The Memory Bin Lab</h3>" +
      '<p class="mb-sub">A GDDR timing qualification bench for the GPU refurb line at ' +
      '<a href="https://dillingerstaffing.github.io/tapeout/" target="_blank" rel="noopener">TAPEOUT</a>: ' +
      "every pulled card gets its memory re-binned before it ships. This is the bench that does it. " +
      "Pick a module, tune the four timings, probe the command bus live " +
      "(<b style='color:var(--acid)'>A</b>=activate, <b style='color:var(--cyan)'>R</b>=read, " +
      "<b style='color:var(--orange)'>W</b>=write, <b style='color:var(--steel)'>P</b>=precharge), " +
      "then qualify: 4000 deterministic transactions, zero luck. Pass mark is errors inside the ECC budget " +
      "and bandwidth on target. Your grade is pure silicon margin: cycles of headroom over the die's hidden floor. " +
      "Qualify all three modules for the Memory Bin Master certificate.</p>";

    /* module deck */
    var deck = mbEl("div", "mb-deck");
    panel.appendChild(deck);

    /* timing controls */
    var ctl = mbEl("div", "mb-ctl");
    panel.appendChild(ctl);

    ui = { ov: ov, deck: deck, ctl: ctl, modIdx: 0, sliders: {}, vals: {}, tiles: {}, banks: [], trace: null, verdict: null, log: null, results: [{}, {}, {}], masterBtn: null };

    MB_MODULES.forEach(function (m, i) {
      var card = mbEl("div", "mb-mod", "<h4>" + mbEsc(m.sku) + '</h4><p>' + mbEsc(m.desc) +
        "<br>Target: " + m.targetGBs.toFixed(1) + " GB/s at " + m.clockMHz + " MHz</p>" +
        '<span class="stamp" id="mbStamp' + i + '">UNTESTED</span>');
      if (i === 0) card.classList.add("sel");
      card.addEventListener("click", function () { mbSelectMod(i); });
      deck.appendChild(card);
      ui["card" + i] = card;
    });

    Object.keys(MB_RANGES).forEach(function (k) {
      var r = MB_RANGES[k];
      var f = mbEl("div", "mb-field", "<h4>" + mbEsc(r.label) + "</h4>");
      var inp = document.createElement("input");
      inp.type = "range"; inp.min = r.min; inp.max = r.max; inp.value = 26;
      if (k === "tRP") inp.value = 22;
      if (k === "tRAS") inp.value = 48;
      var v = mbEl("div", "val", inp.value + " cyc");
      inp.addEventListener("input", function () {
        v.textContent = inp.value + " cyc";
        mbUpdateMargin();
      });
      f.appendChild(inp); f.appendChild(v);
      ctl.appendChild(f);
      ui.sliders[k] = inp; ui.vals[k] = v;
    });

    /* toolbar */
    var tb = mbEl("div", "mb-toolbar");
    var btnProbe = mbEl("button", "secondary", "PROBE LIVE (240)");
    var btnQual = mbEl("button", "secondary mb-run", "QUALIFY MODULE (4000)");
    var btnSafe = mbEl("button", "secondary", "RESET TO SAFE");
    var btnCard = mbEl("button", "secondary", "DOWNLOAD BIN CARD");
    btnCard.style.display = "none";
    tb.appendChild(btnProbe); tb.appendChild(btnQual); tb.appendChild(btnSafe); tb.appendChild(btnCard);
    panel.appendChild(tb);
    ui.btnCard = btnCard;

    btnProbe.addEventListener("click", mbProbe);
    btnQual.addEventListener("click", mbQualify);
    btnSafe.addEventListener("click", function () {
      var s = MB_MODULES[ui.modIdx].safe;
      Object.keys(s).forEach(function (k) {
        ui.sliders[k].value = s[k];
        ui.vals[k].textContent = s[k] + " cyc";
      });
      mbUpdateMargin();
      mbToast("Timings reset to safe JEDEC values");
    });
    btnCard.addEventListener("click", mbDownloadCard);

    /* meters */
    var tiles = mbEl("div", "mb-tiles");
    panel.appendChild(tiles);
    [["BANDWIDTH", "gbs", "GB/s"], ["AVG READ LAT", "lat", "cyc"], ["ROW HIT", "hit", "%"],
     ["ERRORS", "err", ""], ["MARGIN", "mgn", "cyc"], ["COMMANDS", "cmd", ""]].forEach(function (t) {
      var d = mbEl("div", "mb-tile", "<h4>" + t[0] + "</h4><p>-</p>");
      tiles.appendChild(d);
      ui.tiles[t[1]] = d.querySelector("p");
    });

    /* bank grid */
    var bg = mbEl("div", "mb-banks");
    panel.appendChild(bg);
    for (var bi = 0; bi < MB_BANKS; bi++) {
      var bk = mbEl("div", "mb-bank", "<b>BANK " + bi + "</b><span>IDLE</span>");
      bg.appendChild(bk);
      ui.banks.push(bk);
    }

    /* trace */
    var tbox = mbEl("div", "mb-tracebox", "<h4>COMMAND BUS TRACE</h4>");
    var tr = mbEl("div", "mb-trace");
    tbox.appendChild(tr);
    var leg = mbEl("div", "mb-legend",
      '<span><i style="background:var(--acid)"></i>A activate</span>' +
      '<span><i style="background:var(--cyan)"></i>R read</span>' +
      '<span><i style="background:var(--orange)"></i>W write</span>' +
      '<span><i style="background:var(--line)"></i>P precharge</span>');
    tbox.appendChild(leg);
    panel.appendChild(tbox);
    ui.trace = tr;

    /* verdict */
    var vd = mbEl("div", "mb-verdict");
    panel.appendChild(vd);
    ui.verdict = vd;

    /* attempt log */
    var lg = mbEl("div", "mb-log", "attempt log: quiet so far. probe or qualify to make some noise.");
    lg.dataset.empty = "1";
    panel.appendChild(lg);
    ui.log = lg;

    /* master certificate */
    var mb2 = mbEl("div", "mb-toolbar");
    var master = mbEl("button", "secondary mb-run", "DOWNLOAD MEMORY BIN MASTER CERTIFICATE");
    master.style.display = "none";
    master.addEventListener("click", mbDownloadMaster);
    mb2.appendChild(master);
    panel.appendChild(mb2);
    ui.masterBtn = master;

    mb$("mbClose").addEventListener("click", function () {
      mbStopProbe();
      ov.classList.remove("open");
    });

    mbUpdateMargin();
    return ui;
  }

  function mbSelectMod(i) {
    ui.modIdx = i;
    for (var j = 0; j < MB_MODULES.length; j++) {
      ui["card" + j].classList.toggle("sel", j === i);
    }
    mbUpdateMargin();
    mbToast("Module " + MB_MODULES[i].sku + " on the bench");
  }

  function mbTimings() {
    var t = {};
    Object.keys(ui.sliders).forEach(function (k) { t[k] = parseInt(ui.sliders[k].value, 10); });
    return t;
  }

  function mbUpdateMargin() {
    var m = MB_MODULES[ui.modIdx];
    var mg = mbMargin(m.floor, mbTimings());
    var p = ui.tiles.mgn;
    p.textContent = (mg >= 0 ? "+" : "") + mg;
    p.className = mg >= 0 ? "good" : "bad";
  }

  function mbLog(html, cls) {
    if (ui.log.dataset.empty) { ui.log.innerHTML = ""; delete ui.log.dataset.empty; }
    var d = mbEl("div", cls || null, html);
    ui.log.appendChild(d);
    ui.log.scrollTop = ui.log.scrollHeight;
  }
  function mbSetTiles(res) {
    ui.tiles.gbs.textContent = res.gbs.toFixed(1);
    ui.tiles.gbs.className = res.gbs >= MB_MODULES[ui.modIdx].targetGBs ? "good" : "";
    ui.tiles.lat.textContent = res.avgLat.toFixed(1);
    ui.tiles.lat.className = "";
    ui.tiles.hit.textContent = res.rowHitPct.toFixed(1);
    ui.tiles.hit.className = "";
    ui.tiles.err.textContent = String(res.errors);
    ui.tiles.err.className = res.errors > MB_ECC ? "bad" : (res.errors > 0 ? "" : "good");
    ui.tiles.mgn.textContent = (res.margin >= 0 ? "+" : "") + res.margin;
    ui.tiles.mgn.className = res.margin >= 0 ? "good" : "bad";
    ui.tiles.cmd.textContent = String(res.cmds);
    ui.tiles.cmd.className = "";
  }

  function mbStopProbe() {
    if (probeTimer) { clearInterval(probeTimer); probeTimer = null; }
  }

  function mbProbe() {
    mbBuild();
    mbStopProbe();
    var m = MB_MODULES[ui.modIdx];
    var res = mbSim(m, mbTimings(), 240, true);
    var trace = res.trace;
    ui.trace.innerHTML = "";
    ui.banks.forEach(function (bk) {
      bk.classList.remove("open");
      bk.querySelector("span").textContent = "IDLE";
    });
    ui.verdict.classList.remove("show");
    var openRows = {};
    var idx = 0;
    probeTimer = setInterval(function () {
      var n = Math.min(idx + 24, trace.length);
      for (; idx < n; idx++) {
        var t = trace[idx];
        var c = mbEl("span", "mb-c " + t.c, t.c);
        ui.trace.appendChild(c);
        while (ui.trace.children.length > 160) ui.trace.removeChild(ui.trace.firstChild);
        var bk = ui.banks[t.bank];
        if (t.c === "A") { bk.classList.add("open"); openRows[t.bank] = true; bk.querySelector("span").textContent = "ROW OPEN"; }
        if (t.c === "P") { bk.classList.remove("open"); delete openRows[t.bank]; bk.querySelector("span").textContent = "IDLE"; }
      }
      if (idx >= trace.length) {
        mbStopProbe();
        mbSetTiles(res);
        mbLog("probe " + mbEsc(m.sku) + ": " + res.gbs.toFixed(1) + " GB/s, " +
          res.errors + " errors, margin " + (res.margin >= 0 ? "+" : "") + res.margin);
      }
    }, 60);
    mbToast("Probing " + m.sku + ": 240 transactions on the bus");
  }

  function mbQualify() {
    mbBuild();
    mbStopProbe();
    var m = MB_MODULES[ui.modIdx];
    var tim = mbTimings();
    var res = mbSim(m, tim, 4000, false);
    mbSetTiles(res);
    var v = mbVerdict(m, res);
    var vd = ui.verdict;
    vd.className = "mb-verdict show " + (v.pass ? "pass" : "fail");
    var grade = v.pass ? mbGrade(res) : "-";
    vd.innerHTML = '<div class="big">' + (v.pass ? "PASS" : "FAIL") + " : " + mbEsc(m.sku) + "</div>" +
      mbEsc(v.why) + "<br>" +
      "bandwidth " + res.gbs.toFixed(1) + " GB/s (target " + m.targetGBs.toFixed(1) + "), " +
      "errors " + res.errors + " (budget " + MB_ECC + "), " +
      "margin " + (res.margin >= 0 ? "+" : "") + res.margin + " cyc" +
      (v.pass ? ", bin grade <b>" + grade + "</b>" : "") + "<br>" +
      "timings tCL/tRCD/tRP/tRAS = " + tim.tCL + "/" + tim.tRCD + "/" + tim.tRP + "/" + tim.tRAS;
    var stamp = mb$("mbStamp" + ui.modIdx);
    var prev = ui.results[ui.modIdx];
    if (v.pass && (!prev.pass || mbGradeRank(grade) < mbGradeRank(prev.grade))) {
      ui.results[ui.modIdx] = { pass: true, grade: grade, res: res, tim: tim };
    } else if (!v.pass && !prev.pass) {
      ui.results[ui.modIdx] = { pass: false };
    }
    var cur = ui.results[ui.modIdx];
    stamp.textContent = cur.pass ? ("PASS : GRADE " + cur.grade) : "FAIL";
    stamp.className = "stamp " + (cur.pass ? "pass" : "fail");
    ui.btnCard.style.display = cur.pass ? "" : "none";
    mbLog((v.pass ? '<span class="p">PASS</span>' : '<span class="f">FAIL</span>') + " " +
      mbEsc(m.sku) + " @ " + tim.tCL + "/" + tim.tRCD + "/" + tim.tRP + "/" + tim.tRAS +
      ": " + res.gbs.toFixed(1) + " GB/s, " + res.errors + " err" + (v.pass ? ", grade " + grade : ""),
      v.pass ? "p" : "f");
    var done = ui.results.filter(function (r) { return r.pass; }).length;
    if (done === MB_MODULES.length) {
      ui.masterBtn.style.display = "";
      mbToast("All three modules qualified. Memory Bin Master earned.");
    } else {
      mbToast(v.pass ? (m.sku + " qualified, grade " + grade + " (" + done + "/3)") : (m.sku + " failed: " + v.why));
    }
  }

  function mbGradeRank(g) { return g === "A" ? 0 : (g === "B" ? 1 : 2); }

  function mbDownloadCard() {
    var m = MB_MODULES[ui.modIdx];
    var r = ui.results[ui.modIdx];
    if (!r.pass) return;
    var lines = [
      "===============================================",
      "  THE MEMORY BIN LAB - THE PROVING GROUND",
      "  MEMORY BIN CARD",
      "===============================================",
      "",
      "Module: " + m.sku + " (" + m.desc + ")",
      "Qualified timings (tCL/tRCD/tRP/tRAS): " +
        r.tim.tCL + "/" + r.tim.tRCD + "/" + r.tim.tRP + "/" + r.tim.tRAS + " cycles",
      "Measured bandwidth: " + r.res.gbs.toFixed(1) + " GB/s (target " + m.targetGBs.toFixed(1) + ")",
      "Avg read latency: " + r.res.avgLat.toFixed(1) + " cycles",
      "Row hit rate: " + r.res.rowHitPct.toFixed(1) + "%",
      "Bit errors: " + r.res.errors + " (ECC budget " + MB_ECC + ")",
      "Silicon margin: " + (r.res.margin >= 0 ? "+" : "") + r.res.margin + " cycles",
      "BIN GRADE: " + r.grade,
      "",
      "4000-transaction deterministic qualification, 8 banks,",
      "128-byte accesses, real command scheduling.",
      "",
      "Issued " + new Date().toISOString().slice(0, 10) + " by The Proving Ground"
    ];
    mbDownload(lines.join("\n"), "memory-bin-card-" + m.sku + ".txt");
    mbToast("Bin card downloaded");
  }

  function mbDownloadMaster() {
    var lines = [
      "===============================================",
      "  THE MEMORY BIN LAB - THE PROVING GROUND",
      "  MEMORY BIN MASTER CERTIFICATE",
      "===============================================",
      "",
      "Awarded to the tuner who qualified all three",
      "memory modules on the bin bench:",
      ""
    ];
    MB_MODULES.forEach(function (m, i) {
      var r = ui.results[i];
      lines.push(m.sku + ": PASS, grade " + r.grade + ", " + r.res.gbs.toFixed(1) +
        " GB/s @ " + r.tim.tCL + "/" + r.tim.tRCD + "/" + r.tim.tRP + "/" + r.tim.tRAS);
    });
    lines.push("");
    lines.push("Three for three. The refurb line trusts your hands.");
    lines.push("");
    lines.push("Issued " + new Date().toISOString().slice(0, 10) + " by The Proving Ground");
    mbDownload(lines.join("\n"), "memory-bin-master-certificate.txt");
    mbToast("Certificate downloaded");
  }

  function mbDownload(text, name) {
    var blob = new Blob([text], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      (window.URL || window.webkitURL).revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  /* ---------------- init ---------------- */
  function mbInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    mbBuild();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mbInit);
    } else {
      mbInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      MB: {
        sim: mbSim, modules: MB_MODULES, deficit: mbDeficit,
        margin: mbMargin, verdict: mbVerdict, grade: mbGrade
      }
    });
  }

})();
/* ============================================================
   THE SPILL BIN
   An RV32I register allocation bench for the freelance
   portfolio's pipeline work: a real graph-coloring register
   allocator. You are the allocator. Map virtual registers onto
   K physical registers, spill the rest to the stack, and stay
   inside the spill budget. Real liveness analysis, real
   interference graph, real Chaitin-Briggs solver running the
   shop baseline you are graded against. Three qualification
   trials, hint tokens, and downloadable allocation reports.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- tiny helpers (module-local) ---------------- */
  function sb$(id) { return document.getElementById(id); }
  function sbEl(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function sbEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function sbToast(msg) {
    var t = sb$("sbToastBox");
    if (!t) {
      t = sbEl("div", "sb-toast");
      t.id = "sbToastBox";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ---------------- deterministic RNG ---------------- */
  function sbRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ============================================================
     PURE LOGIC: liveness, interference, Chaitin-Briggs
     prog: [{op, d (vreg|null), u:[vregs]}]
     args: vregs live on entry
     ============================================================ */
  function sbVregsOf(prog, args) {
    var seen = {}, out = [];
    function add(v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } }
    (args || []).forEach(add);
    prog.forEach(function (ins) { add(ins.d); (ins.u || []).forEach(add); });
    out.sort(function (a, b) {
      return parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10);
    });
    return out;
  }

  function sbLiveness(prog, args) {
    var n = prog.length, liveIn = [], liveOut = [];
    var i, j, ins, s;
    for (i = 0; i < n; i++) { liveIn.push({}); liveOut.push({}); }
    (args || []).forEach(function (v) { liveIn[0][v] = 1; });
    for (i = n - 1; i >= 0; i--) {
      ins = prog[i];
      s = {};
      if (i + 1 < n) { for (var v in liveIn[i + 1]) s[v] = 1; }
      liveOut[i] = s;
      s = {};
      for (var v2 in liveOut[i]) s[v2] = 1;
      if (ins.d) delete s[ins.d];
      (ins.u || []).forEach(function (v3) { s[v3] = 1; });
      liveIn[i] = s;
    }
    return { liveIn: liveIn, liveOut: liveOut };
  }

  function sbInterference(prog, args) {
    var lv = sbLiveness(prog, args), adj = {}, vregs = sbVregsOf(prog, args);
    vregs.forEach(function (v) { adj[v] = {}; });
    prog.forEach(function (ins, i) {
      if (!ins.d) return;
      for (var v in lv.liveOut[i]) {
        if (v === ins.d) continue;
        adj[ins.d][v] = 1; adj[v][ins.d] = 1;
      }
    });
    return adj;
  }

  function sbSpillCosts(prog, args) {
    var costs = {}, vregs = sbVregsOf(prog, args);
    vregs.forEach(function (v) { costs[v] = 0; });
    prog.forEach(function (ins) {
      if (ins.d) costs[ins.d] += 3;
      (ins.u || []).forEach(function (v) { costs[v] += 2; });
    });
    (args || []).forEach(function (v) { costs[v] += 2; });
    return costs;
  }

  function sbLiveRange(prog, args, v) {
    var lv = sbLiveness(prog, args), first = -1, last = -1;
    for (var i = 0; i < prog.length; i++) {
      if (lv.liveIn[i][v] || lv.liveOut[i][v] ||
          prog[i].d === v || (prog[i].u || []).indexOf(v) >= 0) {
        if (first < 0) first = i;
        last = i;
      }
    }
    return { first: first, last: last };
  }

  /* Chaitin-Briggs graph coloring with spill heuristic.
     Returns {assign: {v: colorIndex | -1 (spilled)}, cost} */
  function sbSolve(prog, args, K) {
    var adj = sbInterference(prog, args);
    var costs = sbSpillCosts(prog, args);
    var vregs = sbVregsOf(prog, args);
    var deg = {}, alive = {}, stack = [], spilled = {};
    vregs.forEach(function (v) {
      deg[v] = Object.keys(adj[v]).length;
      alive[v] = 1;
    });
    var remaining = vregs.length, guard = 0;
    while (remaining > 0 && guard++ < 10000) {
      var pick = null, i;
      for (i = 0; i < vregs.length; i++) {
        var v = vregs[i];
        if (alive[v] && deg[v] < K) { pick = v; break; }
      }
      if (pick === null) {
        var best = null, bestScore = Infinity;
        for (i = 0; i < vregs.length; i++) {
          var w = vregs[i];
          if (!alive[w]) continue;
          var score = costs[w] / Math.max(1, deg[w]);
          if (score < bestScore) { bestScore = score; best = w; }
        }
        pick = best;
        spilled[pick] = 1;
      }
      stack.push(pick);
      alive[pick] = 0;
      remaining--;
      for (var nb in adj[pick]) { if (alive[nb]) deg[nb]--; }
    }
    var assign = {};
    var cost = 0;
    while (stack.length) {
      var v2 = stack.pop();
      if (spilled[v2]) { assign[v2] = -1; cost += costs[v2]; continue; }
      var used = {};
      for (var nb2 in adj[v2]) {
        if (assign[nb2] !== undefined && assign[nb2] >= 0) used[assign[nb2]] = 1;
      }
      var c = 0;
      while (used[c]) c++;
      assign[v2] = c;
    }
    return { assign: assign, cost: cost, adj: adj, costs: costs, vregs: vregs };
  }

  function sbVerify(prog, args, K, assign) {
    var adj = sbInterference(prog, args);
    var vregs = sbVregsOf(prog, args);
    var conflicts = [];
    vregs.forEach(function (v) {
      if (assign[v] === undefined || assign[v] === null) {
        conflicts.push({ v: v, why: "unassigned" });
      }
    });
    var seen = {};
    vregs.forEach(function (v) {
      for (var nb in adj[v]) {
        var key = v < nb ? v + "|" + nb : nb + "|" + v;
        if (seen[key]) continue;
        seen[key] = 1;
        if (assign[v] !== undefined && assign[v] === assign[nb] && assign[v] >= 0) {
          conflicts.push({ v: v, nb: nb, why: "color" });
        }
      }
    });
    return conflicts;
  }

  /* ---------------- trial programs ----------------
     args: vregs live on entry (function arguments) */
  function I(op, d, u) { return { op: op, d: d, u: u || [] }; }

  var SB_TRIALS = [
    {
      name: "FIRST SHIFT",
      desc: "A small leaf function, eight virtual registers, four physical. No spilling required if you read the ranges right.",
      K: 4, budget: 14, par: 0,
      args: ["v0", "v1"],
      prog: [
        I("add", "v2", ["v0", "v1"]),
        I("mul", "v3", ["v2", "v0"]),
        I("sub", "v4", ["v1", "v3"]),
        I("xor", "v5", ["v2", "v4"]),
        I("add", "v6", ["v3", "v5"]),
        I("or", "v7", ["v6", "v0"]),
        I("ret", null, ["v7"])
      ]
    },
    {
      name: "DOUBLE SHIFT",
      desc: "Eleven virtuals fighting over four physical registers in a checksum kernel. Something has to spill. Pick the cheapest victim.",
      K: 4, budget: 8, par: 5,
      args: ["v0", "v1"],
      prog: [
        I("add", "v2", ["v0", "v1"]),
        I("mul", "v3", ["v0", "v1"]),
        I("sub", "v4", ["v1", "v0"]),
        I("xor", "v5", ["v0", "v1"]),
        I("sll", "v6", ["v5", "v2"]),
        I("xor", "v7", ["v6", "v5"]),
        I("xor", "v8", ["v7", "v4"]),
        I("xor", "v9", ["v8", "v3"]),
        I("xor", "v10", ["v9", "v2"]),
        I("ret", null, ["v10"])
      ]
    },
    {
      name: "GRAVEYARD SHIFT",
      desc: "Fifteen virtuals, five physical registers, one gnarly crypto round. The shop solver spills twice to fit it. Match the par and you run this bench.",
      K: 5, budget: 15, par: 10,
      args: ["v0", "v1"],
      prog: [
        I("add", "v2", ["v0", "v1"]),
        I("mul", "v3", ["v0", "v1"]),
        I("sub", "v4", ["v1", "v0"]),
        I("xor", "v5", ["v0", "v1"]),
        I("or", "v6", ["v0", "v1"]),
        I("and", "v7", ["v1", "v0"]),
        I("sll", "v8", ["v7", "v2"]),
        I("xor", "v9", ["v8", "v7"]),
        I("xor", "v10", ["v9", "v6"]),
        I("xor", "v11", ["v10", "v5"]),
        I("xor", "v12", ["v11", "v4"]),
        I("xor", "v13", ["v12", "v3"]),
        I("xor", "v14", ["v13", "v2"]),
        I("ret", null, ["v14"])
      ]
    }
  ];

  /* ---------------- explore-mode program generator ---------------- */
  var SB_OPS = ["add", "sub", "mul", "xor", "or", "and", "sll", "srl"];
  function sbRandomProg(seed, nV, nIns) {
    var rng = sbRng(seed);
    var prog = [], next = 2, live = ["v0", "v1"], i;
    for (i = 0; i < nIns; i++) {
      var op = SB_OPS[Math.floor(rng() * SB_OPS.length)];
      var d = "v" + (next++);
      var u = [];
      if (live.length === 0) live.push("v0");
      u.push(live[Math.floor(rng() * live.length)]);
      if (rng() < 0.8 && live.length > 0) {
        var u2 = live[Math.floor(rng() * live.length)];
        if (u2 !== u[0]) u.push(u2);
      }
      prog.push(I(op, d, u));
      live.push(d);
      if (live.length > 6 && rng() < 0.45) {
        live.splice(Math.floor(rng() * live.length), 1);
      }
      if (next - 2 >= nV) break;
    }
    prog.push(I("ret", null, [live[live.length - 1]]));
    return { prog: prog, args: ["v0", "v1"] };
  }

  /* ---------------- palette: one color per physical register ---------------- */
  var SB_COLORS = ["#c6ff4a", "var(--ice)", "#ff8b3d", "#ff5470",
                   "#b78bff", "#ffd23f", "#5affc7", "#ff9de2"];

  var SB_CSS = [
    ".sb-overlay{position:fixed;inset:0;z-index:60;display:none;background:rgba(5,8,7,.88);overflow-y:auto;padding:18px 12px;}",
    ".sb-overlay.open{display:block;}",
    ".sb-panel{max-width:1060px;margin:0 auto;background:#0d1312;border:1px solid var(--line);padding:22px 22px 28px;}",
    ".sb-close{float:right;background:none;border:1px solid var(--line);color:var(--paper);font:inherit;font-size:11px;letter-spacing:.12em;padding:8px 12px;cursor:pointer;}",
    ".sb-close:hover{border-color:var(--acid);color:var(--acid);}",
    ".sb-panel h3{font-family:var(--font-d);font-size:30px;margin:0 0 6px;text-transform:uppercase;letter-spacing:-.01em;color:var(--paper);}",
    ".sb-panel h3 .sb-acid{color:var(--acid);}",
    ".sb-sub{font-size:12px;line-height:1.7;color:var(--steel);margin:0 0 16px;max-width:72ch;}",
    ".sb-sub a{color:var(--acid);}",
    ".sb-tabs{display:flex;gap:8px;margin-bottom:16px;}",
    ".sb-tab{background:none;border:1px solid var(--line);color:var(--steel);font:inherit;font-size:11px;letter-spacing:.14em;padding:10px 18px;cursor:pointer;}",
    ".sb-tab.on{border-color:var(--acid);color:var(--acid);}",
    ".sb-ctl{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px;}",
    ".sb-field h5{margin:0 0 6px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".sb-field select{background:var(--black);border:1px solid var(--line);color:var(--paper);padding:10px;font-size:14px;min-height:44px;}",
    ".sb-btn{background:none;border:1px solid var(--line);color:var(--paper);font:inherit;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:12px 16px;cursor:pointer;min-height:44px;}",
    ".sb-btn:hover{border-color:var(--acid);color:var(--acid);}",
    ".sb-btn.primary{border-color:var(--acid);color:var(--acid);}",
    ".sb-btn.warn{border-color:var(--orange);color:var(--orange);}",
    ".sb-btn:disabled{opacity:.35;cursor:default;}",
    ".sb-runhead{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between;margin:0 0 8px;}",
    ".sb-runhead h4{font-family:var(--font-d);font-size:19px;margin:0;text-transform:uppercase;color:var(--paper);}",
    ".sb-stats{font-family:var(--font-m);font-size:11px;color:var(--steel);letter-spacing:.04em;}",
    ".sb-stats b{color:var(--acid);}",
    ".sb-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;}",
    ".sb-col h5{margin:0 0 8px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);font-weight:600;}",
    ".sb-prog{font-family:var(--font-m);font-size:12px;line-height:1.9;background:var(--black);border:1px solid var(--line);padding:10px 12px;max-height:300px;overflow-y:auto;}",
    ".sb-prog .ln{white-space:pre;color:var(--steel);}",
    ".sb-prog .ln .num{color:var(--steel);margin-right:10px;}",
    ".sb-prog .ln.live{color:var(--paper);background:rgba(198,255,74,.07);}",
    ".sb-prog .ln.live .num{color:var(--acid);}",
    ".sb-ranges{margin-top:10px;border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;}",
    ".rg-row{display:grid;grid-template-columns:44px 44px minmax(0,1fr);gap:8px;align-items:center;padding:5px 4px;cursor:pointer;border:1px solid transparent;min-height:44px;}",
    ".rg-row:hover{background:rgba(255,255,255,.03);}",
    ".rg-row.sel{border-color:var(--cyan);}",
    ".rg-lab{font-family:var(--font-m);font-size:12px;color:var(--paper);}",
    ".rg-cost{font-family:var(--font-m);font-size:10px;color:var(--steel);}",
    ".rg-bar{position:relative;height:16px;background:rgba(255,255,255,.04);}",
    ".rg-fill{position:absolute;top:0;bottom:0;background:var(--line);}",
    ".rg-row.done .rg-fill{opacity:1;}",
    ".rg-row.spilled .rg-fill{background:repeating-linear-gradient(45deg,#5a2f16,#5a2f16 4px,#2c1a0e 4px,#2c1a0e 8px);}",
    ".sb-graph{border:1px solid var(--line);background:var(--black);padding:6px;}",
    ".sb-graph svg{display:block;width:100%;height:auto;}",
    ".sb-graph .nd{cursor:pointer;}",
    ".sb-chips{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 10px;align-items:stretch;}",
    ".sb-chip{border:1px solid var(--line);background:var(--panel-2);color:var(--paper);font:inherit;min-width:52px;min-height:48px;padding:8px 10px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;}",
    ".sb-chip .dot{width:18px;height:18px;border:1px solid rgba(0,0,0,.4);}",
    ".sb-chip small{font-size:10px;letter-spacing:.1em;}",
    ".sb-chip:hover{border-color:var(--paper);}",
    ".sb-chip.spill{border-style:dashed;border-color:var(--orange);color:var(--orange);}",
    ".sb-chip.ghost{border-style:dashed;color:var(--steel);}",
    ".sb-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;}",
    ".sb-verdict{margin-top:14px;}",
    ".sb-stamp{display:inline-block;font-family:var(--font-d);font-size:22px;text-transform:uppercase;letter-spacing:.06em;padding:10px 18px;border:2px solid;margin-bottom:8px;}",
    ".sb-stamp.pass{color:var(--acid);border-color:var(--acid);}",
    ".sb-stamp.fail{color:var(--orange);border-color:var(--orange);}",
    ".sb-verdict p{font-size:12px;line-height:1.7;color:var(--steel);margin:0 0 4px;max-width:70ch;}",
    ".sb-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}",
    ".sb-card{border:1px solid var(--line);background:var(--panel-2);padding:16px;display:flex;flex-direction:column;gap:8px;}",
    ".sb-card h4{font-family:var(--font-d);font-size:18px;margin:0;text-transform:uppercase;}",
    ".sb-card p{font-size:12px;line-height:1.65;color:var(--steel);margin:0;flex:1;}",
    ".sb-card .meta{font-family:var(--font-m);font-size:11px;color:var(--steel);}",
    ".sb-card .best{font-family:var(--font-m);font-size:11px;letter-spacing:.1em;}",
    ".sb-card .best.gold{color:var(--acid);}",
    ".sb-card .best.silver{color:var(--steel);}",
    ".sb-card .best.shop{color:var(--orange);}",
    ".sb-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);background:#101715;border:1px solid var(--acid);color:var(--paper);font-size:12px;padding:12px 18px;z-index:80;opacity:0;pointer-events:none;transition:opacity .1s,transform .1s;max-width:92vw;}",
    ".sb-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}",
    "@keyframes sbShake{0%,100%{transform:translateX(0);}25%{transform:translateX(-6px);}75%{transform:translateX(6px);}}",
    ".sb-shake{animation:sbShake .25s ease 2;}",
    "@media (max-width:900px){.sb-cols{grid-template-columns:minmax(0,1fr);}.sb-cards{grid-template-columns:minmax(0,1fr);}.sb-panel{padding:16px 14px 22px;}}"
  ].join("\n");

  /* ---------------- persistent best grades ---------------- */
  function sbBestLoad() {
    try { return JSON.parse(localStorage.getItem("sbBest") || "{}"); }
    catch (e) { return {}; }
  }
  function sbBestSave(b) {
    try { localStorage.setItem("sbBest", JSON.stringify(b)); } catch (e) {}
  }
  var SB_GRADE_RANK = { "GOLD": 3, "SILVER": 2, "SHOP-BUILT": 1 };

  /* ---------------- overlay shell ---------------- */
  var sbExpSeed = 1001;

  function sbBuildShell() {
    var st = document.createElement("style");
    st.textContent = SB_CSS;
    document.head.appendChild(st);

    var box = document.querySelector(".dossier .actions");
    if (box && !sb$("sbBtn")) {
      var b = sbEl("button", "secondary", "Run the Spill Bin");
      b.id = "sbBtn";
      b.addEventListener("click", function () { sb$("sbOverlay").classList.add("open"); });
      box.appendChild(b);
    }

    var ov = sbEl("div", "sb-overlay");
    ov.id = "sbOverlay";
    var panel = sbEl("div", "sb-panel");
    ov.appendChild(panel);
    document.body.appendChild(ov);

    panel.innerHTML =
      '<button class="sb-close" id="sbClose">CLOSE [x]</button>' +
      '<h3>The Spill <span class="sb-acid">Bin</span></h3>' +
      '<p class="sb-sub">Every function is a bar fight over registers: more live values than ' +
      'physical registers, and somebody spills to the stack. This bench puts you in the ' +
      'allocator seat for the same register pressure behind the ' +
      '<a href="https://dillingerstaffing.github.io/portfolio/" target="_blank" rel="noopener">RV32I pipeline work</a> ' +
      'in the portfolio. Read the live ranges, color the interference graph, spill the cheapest ' +
      'victims, stay inside the budget. Free-build in EXPLORE, then qualify on three shifts in TRIALS. ' +
      'The shop solver (a real Chaitin-Briggs allocator running under the bench) sets every par.</p>' +
      '<div class="sb-tabs">' +
      '<button class="sb-tab on" id="sbTabExp">EXPLORE</button>' +
      '<button class="sb-tab" id="sbTabTri">TRIALS</button>' +
      '</div>' +
      '<div id="sbPageExp"></div>' +
      '<div id="sbPageTri" style="display:none"></div>';

    sb$("sbClose").addEventListener("click", function () {
      ov.classList.remove("open");
    });
    var tExp = sb$("sbTabExp"), tTri = sb$("sbTabTri");
    tExp.addEventListener("click", function () {
      tExp.classList.add("on"); tTri.classList.remove("on");
      sb$("sbPageExp").style.display = ""; sb$("sbPageTri").style.display = "none";
    });
    tTri.addEventListener("click", function () {
      tTri.classList.add("on"); tExp.classList.remove("on");
      sb$("sbPageTri").style.display = ""; sb$("sbPageExp").style.display = "none";
    });

    sbBuildExplore(sb$("sbPageExp"));
    sbBuildTrials(sb$("sbPageTri"));
  }

  function sbBuildExplore(page) {
    var ctl = sbEl("div", "sb-ctl");
    var f = sbEl("div", "sb-field", "<h5>Physical registers</h5>");
    var sel = document.createElement("select");
    ["3", "4", "5", "6", "7", "8"].forEach(function (n) {
      var o = document.createElement("option");
      o.value = n; o.textContent = n + " (R0..R" + (parseInt(n, 10) - 1) + ")";
      sel.appendChild(o);
    });
    sel.value = "5";
    f.appendChild(sel);
    ctl.appendChild(f);
    var nb = sbEl("button", "sb-btn", "New program");
    ctl.appendChild(nb);
    page.appendChild(ctl);
    var wrap = sbEl("div", null, "");
    page.appendChild(wrap);

    function deal() {
      var K = parseInt(sel.value, 10);
      var g = sbRandomProg(sbExpSeed++, 8 + (sbExpSeed % 5), 12 + (sbExpSeed % 5));
      wrap.innerHTML = "";
      sbNewBoard("sbE", wrap, {
        mode: "explore", name: "OPEN BENCH",
        desc: "Free build. Match the shop solver and take gold.",
        K: K, prog: g.prog, args: g.args
      });
    }
    nb.addEventListener("click", deal);
    sel.addEventListener("change", deal);
    deal();
  }

  function sbBuildTrials(page) {
    var cards = sbEl("div", "sb-cards");
    cards.id = "sbCards";
    page.appendChild(cards);
    var runWrap = sbEl("div", null, "");
    runWrap.id = "sbRunWrap";
    runWrap.style.display = "none";
    page.appendChild(runWrap);
    sbRenderTrialCards();
  }

  function sbRenderTrialCards() {
    var cards = sb$("sbCards");
    if (!cards) return;
    var best = sbBestLoad();
    cards.innerHTML = "";
    SB_TRIALS.forEach(function (t, i) {
      var card = sbEl("div", "sb-card");
      var b = best[String(i)];
      var bHtml = b ? '<div class="best ' + b.toLowerCase().replace("-", "") + '">BEST: ' + sbEsc(b) + '</div>'
                    : '<div class="best" style="color:var(--steel)">BEST: UNQUALIFIED</div>';
      card.innerHTML =
        "<h4>" + sbEsc(t.name) + "</h4>" +
        "<p>" + sbEsc(t.desc) + "</p>" +
        '<div class="meta">VIRTUALS ' + sbVregsOf(t.prog, t.args).length +
        " · PHYSICAL " + t.K + " · BUDGET " + t.budget + "u · PAR " + t.par + "u</div>" +
        bHtml;
      var rb = sbEl("button", "sb-btn primary", "Run this shift");
      rb.addEventListener("click", function () { sbStartTrial(i); });
      card.appendChild(rb);
      cards.appendChild(card);
    });
  }

  function sbStartTrial(i) {
    var t = SB_TRIALS[i];
    sb$("sbCards").style.display = "none";
    var rw = sb$("sbRunWrap");
    rw.style.display = "";
    rw.innerHTML = "";
    var back = sbEl("button", "sb-btn", "Back to shifts");
    back.addEventListener("click", function () {
      rw.style.display = "none";
      sb$("sbCards").style.display = "";
      sbRenderTrialCards();
    });
    rw.appendChild(back);
    var wrap = sbEl("div", null, "");
    rw.appendChild(wrap);
    sbNewBoard("sbT", wrap, {
      mode: "trial", trialIdx: i, name: t.name, desc: t.desc,
      K: t.K, budget: t.budget, par: t.par, prog: t.prog, args: t.args
    });
  }

  /* ============================================================
     BOARD: one live bench per explore deal or trial run
     ============================================================ */
  function sbSolver(st) {
    if (!st.solver) st.solver = sbSolve(st.cfg.prog, st.cfg.args, st.cfg.K);
    return st.solver;
  }
  function sbSpillCost(st) {
    var c = 0;
    st.vregs.forEach(function (v) { if (st.assign[v] === -1) c += st.costs[v]; });
    return c;
  }
  function sbIsLive(st, v, i) {
    var ins = st.cfg.prog[i];
    return !!(st.live.liveIn[i][v] || st.live.liveOut[i][v] ||
      ins.d === v || (ins.u || []).indexOf(v) >= 0);
  }

  function sbNewBoard(px, wrap, cfg) {
    var st = {
      px: px, cfg: cfg,
      vregs: sbVregsOf(cfg.prog, cfg.args),
      adj: sbInterference(cfg.prog, cfg.args),
      costs: sbSpillCosts(cfg.prog, cfg.args),
      live: sbLiveness(cfg.prog, cfg.args),
      ranges: {},
      assign: {}, sel: null,
      hintsLeft: cfg.mode === "trial" ? 3 : 999,
      hintsUsed: 0, attempts: 0, shopUsed: false,
      verdict: null, solver: null
    };
    st.vregs.forEach(function (v) { st.ranges[v] = sbLiveRange(cfg.prog, cfg.args, v); });

    wrap.innerHTML =
      '<div class="sb-runhead"><h4>' + sbEsc(cfg.name) + '</h4>' +
      '<div class="sb-stats" id="' + px + 'Stats"></div></div>' +
      '<div class="sb-cols">' +
      '<div class="sb-col"><h5>Program and live ranges (tap a row to select)</h5>' +
      '<div class="sb-prog" id="' + px + 'Prog"></div>' +
      '<div class="sb-ranges" id="' + px + 'Ranges"></div></div>' +
      '<div class="sb-col"><h5>Interference graph (tap a node, then a color)</h5>' +
      '<div class="sb-graph" id="' + px + 'Graph"></div></div>' +
      "</div>" +
      '<div class="sb-chips" id="' + px + 'Chips"></div>' +
      '<div class="sb-actions" id="' + px + 'Actions"></div>' +
      '<div class="sb-verdict" id="' + px + 'Verdict"></div>';

    sbBuildChips(st);
    sbBuildActions(st);
    sb$(px + "Graph").addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-v]") : null;
      if (t) sbSelect(st, t.getAttribute("data-v"));
    });
    sbRenderAll(st);
    return st;
  }

  function sbBuildChips(st) {
    var box = sb$(st.px + "Chips");
    box.innerHTML = "";
    for (var c = 0; c < st.cfg.K; c++) {
      (function (cc) {
        var b = sbEl("button", "sb-chip", "");
        b.innerHTML = '<span class="dot" style="background:' + SB_COLORS[cc] + '"></span><small>R' + cc + "</small>";
        b.addEventListener("click", function () { sbAssign(st, cc); });
        box.appendChild(b);
      })(c);
    }
    var spill = sbEl("button", "sb-chip spill", "<small>SPILL</small><small>to stack</small>");
    spill.addEventListener("click", function () { sbSpill(st); });
    var clear = sbEl("button", "sb-chip ghost", "<small>CLEAR</small>");
    clear.addEventListener("click", function () { sbClear(st); });
    var hint = sbEl("button", "sb-chip ghost", "");
    hint.id = st.px + "HintBtn";
    hint.addEventListener("click", function () { sbHint(st); });
    var shop = sbEl("button", "sb-chip ghost", "<small>ASK THE</small><small>SHOP</small>");
    shop.addEventListener("click", function () { sbShop(st); });
    box.appendChild(spill);
    box.appendChild(clear);
    box.appendChild(hint);
    box.appendChild(shop);
  }

  function sbBuildActions(st) {
    var box = sb$(st.px + "Actions");
    box.innerHTML = "";
    var main = sbEl("button", "sb-btn primary", st.cfg.mode === "trial" ? "Commit allocation" : "Grade this build");
    main.addEventListener("click", function () { sbCommit(st); });
    var reset = sbEl("button", "sb-btn", "Reset bench");
    reset.addEventListener("click", function () { sbReset(st); });
    var dl = sbEl("button", "sb-btn", "Download report");
    dl.addEventListener("click", function () { sbDownloadReport(st); });
    box.appendChild(main);
    box.appendChild(reset);
    box.appendChild(dl);
  }

  /* ---------------- rendering ---------------- */
  function sbRenderAll(st) {
    sbRenderStats(st);
    sbRenderProg(st);
    sbRenderRanges(st);
    sbRenderGraph(st);
    sbRenderVerdict(st);
    var hb = sb$(st.px + "HintBtn");
    if (hb) hb.innerHTML = "<small>HINT</small><small>" + (st.hintsLeft > 90 ? "free" : st.hintsLeft + " left") + "</small>";
  }

  function sbRenderStats(st) {
    var done = 0, sp = 0;
    st.vregs.forEach(function (v) {
      if (st.assign[v] !== undefined) done++;
      if (st.assign[v] === -1) sp++;
    });
    var cost = sbSpillCost(st);
    var h = "BENCH <b>" + done + "/" + st.vregs.length + "</b> · SPILLED " + sp +
      " · SPILL COST <b>" + cost + "u</b>";
    if (st.cfg.mode === "trial") {
      h += " / BUDGET " + st.cfg.budget + "u · PAR " + st.cfg.par + "u · HINTS " + st.hintsLeft + " · ATTEMPTS " + st.attempts;
    } else {
      h += " · SHOP BASELINE " + sbSolver(st).cost + "u";
    }
    if (st.sel) h += ' · SELECTED <b>' + st.sel + "</b>";
    sb$(st.px + "Stats").innerHTML = h;
  }

  function sbRenderProg(st) {
    var h = "";
    st.cfg.prog.forEach(function (ins, i) {
      var num = (i < 10 ? "0" : "") + i;
      var txt = ins.op + (ins.d ? " " + ins.d : "") +
        (ins.u && ins.u.length ? (ins.d ? ", " : " ") + ins.u.join(", ") : "");
      var cls = "ln" + (st.sel && sbIsLive(st, st.sel, i) ? " live" : "");
      h += '<div class="' + cls + '"><span class="num">' + num + "</span>" + sbEsc(txt) + "</div>";
    });
    sb$(st.px + "Prog").innerHTML = h;
  }

  function sbRenderRanges(st) {
    var box = sb$(st.px + "Ranges");
    box.innerHTML = "";
    var n = st.cfg.prog.length;
    st.vregs.forEach(function (v) {
      var r = st.ranges[v];
      var cls = "rg-row" + (st.sel === v ? " sel" : "") +
        (st.assign[v] === -1 ? " spilled" : "") +
        (st.assign[v] >= 0 ? " done" : "");
      var row = sbEl("div", cls, "");
      var left = (r.first / n * 100).toFixed(1);
      var width = ((r.last - r.first + 1) / n * 100).toFixed(1);
      var col = st.assign[v] >= 0 ? SB_COLORS[st.assign[v]] : "";
      row.innerHTML =
        '<span class="rg-lab">' + v + '</span>' +
        '<span class="rg-cost">' + st.costs[v] + 'u</span>' +
        '<span class="rg-bar"><span class="rg-fill" style="left:' + left + "%;width:" + width + "%;" +
        (col ? "background:" + col + ";" : "") + '"></span></span>';
      row.addEventListener("click", function () { sbSelect(st, v); });
      box.appendChild(row);
    });
  }

  function sbRenderGraph(st) {
    var box = sb$(st.px + "Graph");
    var N = st.vregs.length;
    var W = 420, H = 400, cx = W / 2, cy = H / 2;
    var R = N <= 8 ? 138 : 152;
    var nr = N > 12 ? 19 : 23;
    var pos = {};
    st.vregs.forEach(function (v, i) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / N;
      pos[v] = [cx + R * Math.cos(a), cy + R * Math.sin(a)];
    });
    var h = '<svg viewBox="0 0 ' + W + " " + H + '">';
    var seen = {};
    st.vregs.forEach(function (v) {
      Object.keys(st.adj[v]).forEach(function (nb) {
        var key = v < nb ? v + "|" + nb : nb + "|" + v;
        if (seen[key]) return;
        seen[key] = 1;
        var hot = st.sel && (v === st.sel || nb === st.sel);
        h += '<line x1="' + pos[v][0].toFixed(1) + '" y1="' + pos[v][1].toFixed(1) +
          '" x2="' + pos[nb][0].toFixed(1) + '" y2="' + pos[nb][1].toFixed(1) +
          '" stroke="' + (hot ? "var(--ice)" : "var(--line)") + '" stroke-width="' + (hot ? 2.5 : 1.5) + '"/>';
      });
    });
    st.vregs.forEach(function (v) {
      var a = st.assign[v];
      var fill = a >= 0 ? SB_COLORS[a] : "#141b1a";
      var isSel = st.sel === v;
      var isNb = !!(st.sel && st.adj[st.sel][v]);
      var stroke = isSel ? "#f2ede3" : (isNb ? "var(--ice)" : "#5a6a67");
      var sw = (isSel || isNb) ? 3 : 1.5;
      var dash = a === -1 ? ' stroke-dasharray="5,4"' : "";
      var op = a === -1 ? ' opacity="0.55"' : "";
      var p = pos[v];
      var tc = a >= 0 ? "#0b0e0d" : "var(--steel)";
      h += '<g class="nd" data-v="' + v + '"' + op + ">" +
        '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + nr +
        '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + "/>" +
        '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] - 2).toFixed(1) +
        '" text-anchor="middle" font-size="13" font-family="monospace" fill="' + tc + '">' + v + "</text>" +
        '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + 13).toFixed(1) +
        '" text-anchor="middle" font-size="9" font-family="monospace" fill="' + tc + '">' + st.costs[v] + "u</text></g>";
    });
    box.innerHTML = h + "</svg>";
  }

  function sbRenderVerdict(st) {
    var box = sb$(st.px + "Verdict");
    if (!st.verdict) { box.innerHTML = ""; return; }
    var v = st.verdict;
    var stamp = v.ok
      ? '<span class="sb-stamp pass">' + sbEsc(v.grade) + "</span>"
      : '<span class="sb-stamp fail">Rejected</span>';
    box.innerHTML = stamp + "<p>" + sbEsc(v.text) + "</p>";
  }

  /* ---------------- interaction ---------------- */
  function sbSelect(st, v) {
    st.sel = (st.sel === v) ? null : v;
    st.verdict = null;
    sbRenderAll(st);
  }

  function sbAssign(st, c) {
    var v = st.sel;
    if (!v) { sbToast("Tap a register node first, then a color."); return; }
    var bad = null;
    Object.keys(st.adj[v]).forEach(function (nb) { if (st.assign[nb] === c) bad = nb; });
    if (bad) {
      sbToast(v + " fights " + bad + " for R" + c + ": both are live at once. Spill one or pick another color.");
      var g = sb$(st.px + "Graph");
      g.classList.remove("sb-shake");
      void g.offsetWidth;
      g.classList.add("sb-shake");
      return;
    }
    st.assign[v] = c;
    st.verdict = null;
    sbRenderAll(st);
  }

  function sbSpill(st) {
    var v = st.sel;
    if (!v) { sbToast("Tap a register node first, then SPILL."); return; }
    st.assign[v] = -1;
    st.verdict = null;
    sbToast(v + " spilled to the stack (" + st.costs[v] + "u).");
    sbRenderAll(st);
  }

  function sbClear(st) {
    if (st.sel && st.assign[st.sel] !== undefined) {
      delete st.assign[st.sel];
      st.verdict = null;
      sbRenderAll(st);
    }
  }

  function sbHint(st) {
    if (st.hintsLeft <= 0) { sbToast("No hints left on this shift."); return; }
    var sol = sbSolver(st);
    var cand = null, bestD = -1;
    st.vregs.forEach(function (v) {
      if (st.assign[v] !== undefined) return;
      var d = Object.keys(st.adj[v]).length;
      if (d > bestD) { bestD = d; cand = v; }
    });
    if (!cand) { sbToast("Nothing left to hint at."); return; }
    st.hintsLeft--;
    st.hintsUsed++;
    var s = sol.assign[cand];
    st.assign[cand] = s;
    st.sel = cand;
    st.verdict = null;
    sbToast(s === -1
      ? "Shop says: spill " + cand + " (" + st.costs[cand] + "u)."
      : "Shop says: " + cand + " takes R" + s + ".");
    sbRenderAll(st);
  }

  function sbShop(st) {
    var sol = sbSolver(st);
    st.vregs.forEach(function (v) {
      if (st.assign[v] === undefined) st.assign[v] = sol.assign[v];
    });
    st.shopUsed = true;
    st.verdict = null;
    sbToast("The shop built it. Best grade now: SHOP-BUILT.");
    sbRenderAll(st);
  }

  function sbReset(st) {
    st.assign = {};
    st.sel = null;
    st.verdict = null;
    st.hintsLeft = st.cfg.mode === "trial" ? 3 : 999;
    st.hintsUsed = 0;
    st.attempts = 0;
    st.shopUsed = false;
    sbRenderAll(st);
  }

  function sbCommit(st) {
    var un = st.vregs.filter(function (v) { return st.assign[v] === undefined; });
    if (un.length) {
      sbToast(un.length + " virtual register(s) still on the bench: " +
        un.slice(0, 4).join(", ") + (un.length > 4 ? ", ..." : ""));
      return;
    }
    st.attempts++;
    var cost = sbSpillCost(st);
    var clash = sbVerify(st.cfg.prog, st.cfg.args, st.cfg.K, st.assign).filter(function (c) { return c.why === "color"; })[0];
    if (clash) {
      st.verdict = {
        ok: false,
        text: "COLOR CLASH: " + clash.v + " and " + clash.nb + " are live at the same time, but both hold R" + st.assign[clash.v] + ". That is not a valid allocation: interfering ranges must hold different colors. Re-color or spill one of them and commit again."
      };
      sbRenderAll(st);
      return;
    }
    if (st.cfg.mode === "trial") {
      if (cost > st.cfg.budget) {
        st.verdict = {
          ok: false,
          text: "OVER BUDGET by " + (cost - st.cfg.budget) + "u. The foreman rejects this allocation. " +
            "Un-spill something expensive, or find a cheaper victim."
        };
      } else {
        var grade = (cost <= st.cfg.par && !st.shopUsed) ? "GOLD"
          : (st.shopUsed ? "SHOP-BUILT" : "SILVER");
        st.verdict = {
          ok: true, grade: grade,
          text: "QUALIFIED on " + st.cfg.name + " with spill cost " + cost + "u " +
            "(budget " + st.cfg.budget + "u, par " + st.cfg.par + "u) in " + st.attempts + " attempt(s)."
        };
        var best = sbBestLoad();
        var k = String(st.cfg.trialIdx);
        if (!best[k] || SB_GRADE_RANK[grade] > SB_GRADE_RANK[best[k]]) {
          best[k] = grade;
          sbBestSave(best);
        }
      }
    } else {
      var S = sbSolver(st).cost;
      var g2 = cost <= S ? "GOLD" : (cost <= Math.ceil(S * 1.5) ? "SILVER" : "BRONZE");
      st.verdict = {
        ok: true, grade: g2,
        text: "Spill cost " + cost + "u against a shop baseline of " + S + "u. " +
          (g2 === "GOLD" ? "You match the shop solver. Take the gold."
            : (g2 === "SILVER" ? "Within shouting distance of the shop."
              : "The shop did it cheaper. Study the ranges and try again."))
      };
    }
    sbRenderAll(st);
  }

  /* ---------------- report download ---------------- */
  function sbDownloadReport(st) {
    var L = [];
    L.push("THE SPILL BIN: REGISTER ALLOCATION REPORT");
    L.push("==========================================");
    L.push("Run: " + st.cfg.name + (st.cfg.mode === "trial" ? " (qualification trial)" : " (open bench)"));
    L.push("Date: " + new Date().toISOString().slice(0, 10));
    var head = "Physical registers: " + st.cfg.K;
    if (st.cfg.mode === "trial") head += "   Budget: " + st.cfg.budget + "u   Par: " + st.cfg.par + "u";
    L.push(head);
    L.push("Attempts: " + st.attempts + "   Hints used: " + st.hintsUsed +
      "   Shop-built: " + (st.shopUsed ? "yes" : "no"));
    L.push("");
    L.push("PROGRAM");
    st.cfg.prog.forEach(function (ins, i) {
      L.push("  " + (i < 10 ? "0" : "") + i + "  " + ins.op + (ins.d ? " " + ins.d : "") +
        (ins.u && ins.u.length ? (ins.d ? ", " : " ") + ins.u.join(", ") : ""));
    });
    L.push("");
    L.push("ALLOCATION");
    st.vregs.forEach(function (v) {
      var a = st.assign[v];
      L.push("  " + v + " -> " + (a === undefined ? "UNASSIGNED"
        : (a === -1 ? "SPILLED (" + st.costs[v] + "u)" : "R" + a)));
    });
    var sp = st.vregs.filter(function (v) { return st.assign[v] === -1; });
    L.push("");
    L.push("SPILLS (" + sp.length + "): " +
      (sp.length ? sp.map(function (v) { return v + " (" + st.costs[v] + "u)"; }).join(", ") : "none"));
    L.push("SPILL COST: " + sbSpillCost(st) + "u");
    L.push("VERDICT: " + (st.verdict
      ? (st.verdict.ok ? st.verdict.grade + ", " : "REJECTED, ") + st.verdict.text
      : "not yet committed"));
    sbDownload(L.join("\n"), "spill-bin-report.txt");
  }

  function sbDownload(text, name) {
    var blob = new Blob([text], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      (window.URL || window.webkitURL).revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  /* ---------------- init ---------------- */
  function sbInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    sbBuildShell();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", sbInit);
    } else {
      sbInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      SB: {
        solve: sbSolve, verify: sbVerify, inter: sbInterference,
        costs: sbSpillCosts, vregs: sbVregsOf, range: sbLiveRange,
        trials: SB_TRIALS, rand: sbRandomProg
      }
    });
  }

})();

/* ================= THE RISC-V PLAYGROUND (BENCH 08 adapter) =================
   Thin launcher for the shared RISC-V lab module (riscv-lab.js, loaded
   before this file). The lab itself moved to window.RiscvLab.mount; this
   adapter only owns the bench launcher button (id rpBtn, which the bench
   index and #bench= deep links click) and the mount call. */
(function pgRiscvBench() {
  "use strict";
  function $(id) { return document.getElementById(id); }

  var lab = null; /* { panel, open, close } once mounted */
  function ensureLab() {
    if (lab) return lab;
    if (typeof window.RiscvLab === "undefined") return null;
    lab = window.RiscvLab.mount(document.body, { chrome: "overlay" });
    return lab;
  }

  function rvBtnInit() {
    if (typeof document === "undefined") return;
    var box = document.querySelector(".dossier .actions");
    if (!box || $("rpBtn")) return;
    var b = document.createElement("button");
    b.className = "secondary";
    b.id = "rpBtn";
    b.textContent = "Run the RISC-V Playground";
    b.addEventListener("click", function () {
      var l = ensureLab();
      if (l) l.open();
    });
    box.appendChild(b);
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", rvBtnInit);
    } else {
      rvBtnInit();
    }
  }
})();
/* ================= THE PAGE WALKER (BENCH 09) =================
   Sv32-style virtual memory on the bench. A real two-level page-table
   walk with PTE flag decoding, superpage leaves, permission checks, and
   page faults: the same walk xv6 performs on every memory access.
   Training rig uses 16-entry tables (the sv32 algorithm, small enough to
   read on one screen). EXPLORE walks random addresses; TRIALS qualifies
   on three fixed jobs. */

(function () {
  "use strict";

  /* ---------------- pure core: no DOM ---------------- */

  function pwRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pwRi(rng, n) { return Math.floor(rng() * n); }
  function pwHex(n, pad) {
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < pad) s = "0" + s;
    return "0x" + s;
  }
  function pwBin(n, bits) {
    var s = (n >>> 0).toString(2);
    while (s.length < bits) s = "0" + s;
    return s;
  }

  var PW_V = 0x80, PW_R = 0x40, PW_W = 0x20, PW_X = 0x10,
      PW_U = 0x08, PW_G = 0x04, PW_A = 0x02, PW_D = 0x01;

  function pwFlagBits(str) {
    var b = 0;
    if (str.indexOf("V") >= 0) b |= PW_V;
    if (str.indexOf("R") >= 0) b |= PW_R;
    if (str.indexOf("W") >= 0) b |= PW_W;
    if (str.indexOf("X") >= 0) b |= PW_X;
    if (str.indexOf("U") >= 0) b |= PW_U;
    if (str.indexOf("G") >= 0) b |= PW_G;
    if (str.indexOf("A") >= 0) b |= PW_A;
    if (str.indexOf("D") >= 0) b |= PW_D;
    return b;
  }
  function pwPte(ppn, fstr) { return (((ppn & 0xFF) << 8) | pwFlagBits(fstr)) & 0xFFFF; }
  function pwPpn(pte) { return (pte >>> 8) & 0xFF; }
  function pwFlagStr(pte) {
    var o = [];
    if (pte & PW_V) o.push("V");
    if (pte & PW_R) o.push("R");
    if (pte & PW_W) o.push("W");
    if (pte & PW_X) o.push("X");
    if (pte & PW_U) o.push("U");
    if (pte & PW_G) o.push("G");
    if (pte & PW_A) o.push("A");
    if (pte & PW_D) o.push("D");
    return o.length ? o.join(" ") : "none";
  }
  function pwKind(pte) {
    if (!(pte & PW_V)) return "INVALID";
    if (pte & (PW_R | PW_W | PW_X)) return "LEAF";
    return "TABLE";
  }
  function pwNeed(access) { return access === "READ" ? PW_R : access === "WRITE" ? PW_W : PW_X; }
  function pwPermFor(access) { return access === "READ" ? "R" : access === "WRITE" ? "W" : "X"; }
  function pwFaultName(access) {
    return access === "READ" ? "LOAD PAGE FAULT" : access === "WRITE" ? "STORE PAGE FAULT" : "INSTRUCTION PAGE FAULT";
  }

  function pwDecoyLeaf(rng) {
    var perms = ["VR", "VRW", "VRX", "VRWX", "VRU", "VX"];
    return pwPte(pwRi(rng, 256), perms[pwRi(rng, perms.length)]);
  }
  function pwDecoyRoot(rng, forbid) {
    var root = [];
    for (var i = 0; i < 16; i++) {
      if (i === forbid) { root.push(0); continue; }
      var r = rng();
      if (r < 0.55) root.push(0);
      else if (r < 0.82) root.push(pwPte(pwRi(rng, 4), "V"));
      else root.push(pwDecoyLeaf(rng));
    }
    return root;
  }
  function pwDecoyL1(rng, forbid) {
    var t = [];
    for (var i = 0; i < 16; i++) {
      if (i === forbid) { t.push(0); continue; }
      t.push(rng() < 0.6 ? 0 : pwDecoyLeaf(rng));
    }
    return t;
  }

  /* kind: l2 | super | faultperm | faultinvalid */
  function pwGenTables(seed, spec) {
    var rng = pwRng(seed >>> 0);
    var va = spec.va >>> 0, access = spec.access, kind = spec.kind;
    var vpn1 = (va >>> 12) & 15, vpn0 = (va >>> 8) & 15;
    var tables = { root: pwDecoyRoot(rng, vpn1), l1: {} };
    var k, t, leafPerm;
    function leafFor(acc) { return acc === "READ" ? "VR" : acc === "WRITE" ? "VRW" : "VRX"; }
    if (kind === "l2") {
      k = pwRi(rng, 4);
      tables.root[vpn1] = pwPte(k, "V");
      for (t = 0; t < 4; t++) tables.l1[t] = pwDecoyL1(rng, t === k ? vpn0 : -1);
      tables.l1[k][vpn0] = pwPte(pwRi(rng, 256), leafFor(access));
    } else if (kind === "super") {
      tables.root[vpn1] = pwPte(pwRi(rng, 16) << 4, leafFor(access));
      for (t = 0; t < 4; t++) tables.l1[t] = pwDecoyL1(rng, -1);
    } else if (kind === "faultperm") {
      k = pwRi(rng, 4);
      tables.root[vpn1] = pwPte(k, "V");
      for (t = 0; t < 4; t++) tables.l1[t] = pwDecoyL1(rng, t === k ? vpn0 : -1);
      leafPerm = access === "WRITE" ? "VR" : access === "EXECUTE" ? "VRW" : "VX";
      tables.l1[k][vpn0] = pwPte(pwRi(rng, 256), leafPerm);
    } else {
      tables.root[vpn1] = 0;
      for (t = 0; t < 4; t++) tables.l1[t] = pwDecoyL1(rng, -1);
    }
    return tables;
  }

  function pwWalk(tables, va, access) {
    va = va >>> 0;
    var vpn1 = (va >>> 12) & 15, vpn0 = (va >>> 8) & 15, off = va & 255;
    var steps = [];
    function fault(why) { return { ok: false, fault: pwFaultName(access), why: why, steps: steps, pa: null }; }
    var pte = tables.root[vpn1] & 0xFFFF;
    steps.push({ level: 1, index: vpn1, pte: pte });
    if (!(pte & PW_V)) return fault("level-1 PTE at index " + vpn1 + " is invalid (V=0), the page is not present");
    if (pte & (PW_R | PW_W | PW_X)) {
      if ((pte & PW_W) && !(pte & PW_R)) return fault("reserved PTE encoding (W=1, R=0)");
      if (pwPpn(pte) & 15) return fault("misaligned superpage PPN (low PPN bits must be zero)");
      if (!(pte & pwNeed(access))) {
        return fault("leaf PTE grants [" + pwFlagStr(pte) + "] but this " +
          access.toLowerCase() + " needs " + pwPermFor(access));
      }
      var ppn = (((pwPpn(pte) >>> 4) << 4) | vpn0) & 0xFF;
      return { ok: true, pa: (((ppn << 8) | off) & 0xFFFF), super: true, ppn: ppn, steps: steps, fault: null };
    }
    var t = pwPpn(pte) & 15;
    var l1 = tables.l1[t];
    if (!l1) return fault("level-1 PTE points at table " + t + ", which is not present");
    var pte2 = l1[vpn0] & 0xFFFF;
    steps.push({ level: 2, index: vpn0, pte: pte2, table: t });
    if (!(pte2 & PW_V)) return fault("level-2 PTE at index " + vpn0 + " is invalid (V=0), the page is not present");
    if (!(pte2 & (PW_R | PW_W | PW_X))) return fault("non-leaf PTE at the last level, the walk cannot continue");
    if ((pte2 & PW_W) && !(pte2 & PW_R)) return fault("reserved PTE encoding (W=1, R=0)");
    if (!(pte2 & pwNeed(access))) {
      return fault("leaf PTE grants [" + pwFlagStr(pte2) + "] but this " +
        access.toLowerCase() + " needs " + pwPermFor(access));
    }
    return { ok: true, pa: ((((pwPpn(pte2) << 8) | off) & 0xFFFF)), super: false, ppn: pwPpn(pte2), steps: steps, fault: null };
  }

  var PW_JOBS = [
    { id: "t1", name: "Trial 1: First Steps", seed: 0xC0FFEE, va: 0x3A7C, access: "READ", kind: "l2",
      brief: "A plain two-level walk. Read VPN1 and VPN0 out of the address, step both tables, commit the physical address." },
    { id: "t2", name: "Trial 2: The Superpage", seed: 0x5EED, va: 0x94B2, access: "EXECUTE", kind: "super",
      brief: "The level-1 entry is a leaf: a superpage. Its low PPN nibble comes from VPN0. Fetch permission required." },
    { id: "t3", name: "Trial 3: Fault Lines", seed: 0xFA07, va: 0x6D1E, access: "WRITE", kind: "faultperm",
      brief: "Something is wrong with this mapping. Walk it, find the denial, and raise the page fault instead of translating." }
  ];

  /* ---------------- CSS ---------------- */

  var PW_CSS = [
    ".pw-overlay{position:fixed;inset:0;z-index:9995;background:rgba(5,8,10,.94);display:none;}",
    ".pw-overlay.open{display:flex;}",
    ".pw-panel{flex:1;min-height:0;width:100%;max-width:1080px;margin:0 auto;display:flex;flex-direction:column;background:#0a0c0e;border:1px solid var(--line);overflow:hidden;}",
    "@media(min-width:700px){.pw-panel{border-radius:4px;}}",
    ".pw-bar{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);flex:none;flex-wrap:wrap;background:var(--panel);}",
    ".pw-title{font-family:var(--font-d);font-size:13px;font-weight:700;letter-spacing:.14em;color:var(--paper);white-space:nowrap;}",
    ".pw-title b{color:var(--ember);}",
    ".pw-tabs{display:flex;gap:6px;flex:1;flex-wrap:wrap;}",
    ".pw-tab{font-family:var(--font-m);font-size:11px;font-weight:600;letter-spacing:.1em;padding:12px 16px;min-height:48px;border:1px solid transparent;background:none;color:var(--steel);cursor:pointer;border-radius:4px;}",
    ".pw-tab.on{color:var(--ember);border-color:rgba(255,90,31,.4);background:rgba(255,90,31,.08);}",
    ".pw-tab:active{transform:scale(.96);}",
    ".pw-close{font-family:var(--font-m);font-size:12px;font-weight:700;letter-spacing:.08em;min-height:48px;min-width:48px;padding:12px 18px;border-radius:4px;border:1px solid var(--ember);background:var(--ember);color:#0a0c0e;cursor:pointer;}",
    ".pw-close:active{transform:scale(.96);}",
    ".pw-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;}",
    ".pw-sub{font-family:var(--font-m);font-size:11px;color:var(--steel);letter-spacing:.04em;line-height:1.8;margin:0 0 12px;}",
    ".pw-sub b{color:var(--paper);font-weight:600;letter-spacing:.08em;font-size:10px;}",
    ".pw-sub a{color:var(--ice);}",
    ".pw-cards{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:12px;}",
    "@media(min-width:700px){.pw-cards{grid-template-columns:repeat(3,1fr);}}",
    ".pw-card{border:1px solid var(--line);border-radius:4px;padding:14px;background:var(--panel);}",
    ".pw-card h5{margin:0 0 6px;font-family:var(--font-d);font-size:14px;color:var(--paper);}",
    ".pw-card p{margin:0 0 10px;font-size:12px;color:var(--steel);line-height:1.6;}",
    ".pw-card .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
    ".pw-pstat{font-family:var(--font-m);font-size:10px;font-weight:700;letter-spacing:.12em;padding:6px 12px;border-radius:2px;border:1px solid var(--line);color:var(--steel);}",
    ".pw-pstat.pass{color:var(--mint);border-color:rgba(125,224,168,.5);}",
    ".pw-pstat.fail{color:var(--bad);border-color:rgba(255,122,122,.5);}",
    ".pw-mini{font-family:var(--font-m);font-size:11px;font-weight:700;letter-spacing:.06em;min-height:48px;padding:12px 16px;border-radius:4px;border:1px solid rgba(242,237,227,.2);background:var(--panel-2);color:var(--paper);cursor:pointer;}",
    ".pw-mini:active{transform:scale(.96);}",
    ".pw-mini.go{background:var(--ember);border-color:var(--ember);color:#0a0c0e;}",
    ".pw-fields{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}",
    ".pw-field{border:1px solid var(--line);border-radius:4px;padding:8px 12px;background:var(--panel);min-width:0;}",
    ".pw-field .k{display:block;font-family:var(--font-m);font-size:9px;letter-spacing:.16em;color:var(--dim);margin-bottom:4px;}",
    ".pw-field .v{font-family:var(--font-m);font-size:14px;color:var(--paper);}",
    ".pw-field .v em{font-style:normal;color:var(--ember);}",
    ".pw-cols{display:grid;grid-template-columns:1fr;gap:12px;}",
    "@media(min-width:900px){.pw-cols{grid-template-columns:1.05fr .95fr;}}",
    ".pw-pane{border:1px solid var(--line);border-radius:4px;background:var(--panel);overflow:hidden;min-width:0;}",
    ".pw-pane h5{margin:0;padding:10px 12px;font-family:var(--font-m);font-size:11px;letter-spacing:.14em;color:var(--paper);border-bottom:1px solid var(--line);font-weight:600;}",
    ".pw-pane h5 small{display:block;color:var(--dim);letter-spacing:.04em;margin-top:3px;font-weight:400;}",
    ".pw-rows{max-height:420px;overflow-y:auto;-webkit-overflow-scrolling:touch;}",
    ".pw-row{display:grid;grid-template-columns:44px 1fr 1fr auto;gap:8px;align-items:center;width:100%;min-height:48px;padding:8px 12px;background:none;border:none;border-bottom:1px solid rgba(242,237,227,.06);cursor:pointer;text-align:left;transition:transform 100ms,background 100ms;}",
    ".pw-row:active{transform:scale(.98);}",
    ".pw-row:hover{background:rgba(255,90,31,.05);}",
    ".pw-row.sel{background:rgba(255,90,31,.12);box-shadow:inset 3px 0 0 var(--ember);}",
    ".pw-idx{font-family:var(--font-m);font-size:12px;color:var(--dim);}",
    ".pw-row.sel .pw-idx{color:var(--ember);font-weight:700;}",
    ".pw-pte{font-family:var(--font-m);font-size:13px;color:var(--paper);}",
    ".pw-flags{font-family:var(--font-m);font-size:11px;color:var(--steel);}",
    ".pw-kind{font-family:var(--font-m);font-size:10px;font-weight:700;letter-spacing:.1em;padding:5px 10px;border-radius:2px;border:1px solid;}",
    ".pw-kind.kINVALID{color:var(--dim);border-color:rgba(107,116,128,.5);}",
    ".pw-kind.kLEAF{color:var(--mint);border-color:rgba(125,224,168,.5);}",
    ".pw-kind.kTABLE{color:var(--ice);border-color:rgba(124,196,255,.5);}",
    ".pw-log{font-family:var(--font-m);font-size:11px;line-height:1.8;color:var(--steel);padding:10px 12px;max-height:190px;overflow-y:auto;background:var(--ink);white-space:pre-wrap;word-break:break-word;}",
    ".pw-log .ok{color:var(--mint);}",
    ".pw-log .bad{color:var(--bad);}",
    ".pw-leaf{padding:12px;border-top:1px solid var(--line);}",
    ".pw-dec{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-family:var(--font-m);font-size:12px;margin-bottom:12px;}",
    ".pw-dec dt{color:var(--dim);letter-spacing:.08em;font-size:10px;}",
    ".pw-dec dd{margin:0;color:var(--paper);}",
    ".pw-dec dd.good{color:var(--mint);}",
    ".pw-dec dd.bad{color:var(--bad);}",
    ".pw-commit{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;}",
    ".pw-commit label{font-family:var(--font-m);font-size:10px;letter-spacing:.12em;color:var(--dim);display:flex;flex-direction:column;gap:6px;flex:1;min-width:180px;}",
    ".pw-commit input{font-family:var(--font-m);font-size:16px;padding:12px;min-height:48px;border-radius:4px;border:1px solid var(--line);background:var(--ink);color:var(--paper);width:100%;box-sizing:border-box;}",
    ".pw-commit input:focus{outline:2px solid var(--ember);outline-offset:1px;}",
    ".pw-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}",
    ".pw-btn{font-family:var(--font-m);font-size:12px;font-weight:700;letter-spacing:.06em;min-height:48px;padding:12px 18px;border-radius:4px;border:1px solid rgba(242,237,227,.22);background:var(--panel-2);color:var(--paper);cursor:pointer;}",
    ".pw-btn:active{transform:scale(.96);}",
    ".pw-btn.primary{background:var(--ember);border-color:var(--ember);color:#0a0c0e;}",
    ".pw-btn.warn{border-color:rgba(255,122,122,.55);color:var(--bad);}",
    ".pw-btn:disabled{opacity:.4;cursor:default;}",
    ".pw-verdict{font-family:var(--font-m);font-size:13px;line-height:1.7;margin-top:12px;padding:12px 14px;border-radius:4px;border:1px solid var(--line);display:none;}",
    ".pw-verdict.show{display:block;}",
    ".pw-verdict.pass{border-color:rgba(125,224,168,.55);color:var(--mint);}",
    ".pw-verdict.fail{border-color:rgba(255,122,122,.55);color:var(--bad);}",
    ".pw-verdict b{letter-spacing:.1em;}",
    ".pw-cert{margin-top:12px;border:1px solid rgba(255,90,31,.5);border-radius:4px;padding:16px;background:rgba(255,90,31,.06);display:none;}",
    ".pw-cert.show{display:block;}",
    ".pw-cert h4{margin:0 0 6px;font-family:var(--font-d);color:var(--ember);letter-spacing:.1em;font-size:15px;}",
    ".pw-cert p{margin:0 0 12px;font-size:12px;color:var(--steel);line-height:1.7;}",
    "button:focus-visible,.pw-commit input:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
    "@media (prefers-reduced-motion:reduce){.pw-panel *{transition:none !important;}}"
  ];

  /* ---------------- DOM helpers ---------------- */

  function pw$(id) { return document.getElementById(id); }
  function pwEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function pwEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function pwField(k, vHtml) {
    return '<div class="pw-field"><span class="k">' + pwEsc(k) + '</span><span class="v">' + vHtml + "</span></div>";
  }

  /* ---------------- board ---------------- */

  function pwNewBoard(page, opts) {
    var px = opts.mode === "trial" ? "pwT" : "pwE";
    var st = {
      px: px, mode: opts.mode, job: opts.job || null,
      va: 0, access: "READ", tables: null,
      view: null, hist: [], sel: -1,
      logLines: [], attempts: 0, passed: false, verdict: null
    };
    page.innerHTML =
      '<div class="pw-board">' +
      '<div class="pw-fields" id="' + px + 'Addr"></div>' +
      '<div class="pw-cols">' +
      '<div class="pw-pane" id="' + px + 'TPane"><h5 id="' + px + 'THead">Table</h5><div class="pw-rows" id="' + px + 'Rows"></div></div>' +
      '<div class="pw-pane"><h5>Walk log<small>every step the walker takes, in order</small></h5>' +
      '<div class="pw-log" id="' + px + 'Log">Walker idle.</div>' +
      '<div id="' + px + 'Side"></div></div>' +
      "</div>" +
      '<div class="pw-actions">' +
      '<button class="pw-btn primary" id="' + px + 'Step">Step into entry</button>' +
      '<button class="pw-btn" id="' + px + 'Back" style="display:none">Back up</button>' +
      '<button class="pw-btn warn" id="' + px + 'Fault">Raise page fault</button>' +
      (opts.mode === "explore" ? '<button class="pw-btn" id="' + px + 'New">New address</button>' : "") +
      '<button class="pw-btn" id="' + px + 'Dl">Download report</button>' +
      "</div>" +
      '<div class="pw-verdict" id="' + px + 'Verdict"></div>' +
      "</div>";
    pw$(px + "Step").addEventListener("click", function () { pwStep(st); });
    pw$(px + "Back").addEventListener("click", function () { pwBack(st); });
    pw$(px + "Fault").addEventListener("click", function () { pwRaiseFault(st); });
    pw$(px + "Dl").addEventListener("click", function () { pwDownloadReport(st); });
    if (opts.mode === "explore") pw$(px + "New").addEventListener("click", function () { pwNewExplore(st); });
    if (opts.mode === "trial") pwStartJob(st, opts.job);
    else pwNewExplore(st);
    return st;
  }

  function pwSetAddr(st) {
    var va = st.va >>> 0;
    var vpn1 = (va >>> 12) & 15, vpn0 = (va >>> 8) & 15, off = va & 255;
    pw$(st.px + "Addr").innerHTML =
      pwField("VIRTUAL ADDRESS", pwHex(va, 4)) +
      pwField("VPN1 [15:12]", "<em>" + pwBin(vpn1, 4) + "</em> = " + vpn1) +
      pwField("VPN0 [11:8]", "<em>" + pwBin(vpn0, 4) + "</em> = " + vpn0) +
      pwField("OFFSET [7:0]", pwBin(off, 8) + " = " + pwHex(off, 2).slice(2)) +
      pwField("ACCESS", st.access);
  }

  function pwLog(st, msg, cls) {
    st.logLines.push(msg);
    var box = pw$(st.px + "Log");
    var line = pwEl("div", cls || "", msg);
    if (st.logLines.length === 1) box.innerHTML = "";
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function pwRootView(st) {
    var vpn1 = (st.va >>> 12) & 15;
    return { kind: "table", entries: st.tables.root, level: 1, trueIndex: vpn1,
             title: "Level 1: root page table",
             sub: "Index it with VPN1. 16 entries, one true path." };
  }

  function pwRenderView(st) {
    var v = st.view, px = st.px;
    var pane = pw$(px + "TPane"), side = pw$(px + "Side");
    side.innerHTML = "";
    if (v.kind === "table") {
      pane.style.display = "";
      pw$(px + "THead").innerHTML = pwEsc(v.title) + "<small>" + pwEsc(v.sub) + "</small>";
      var box = pw$(px + "Rows");
      box.innerHTML = "";
      for (var i = 0; i < v.entries.length; i++) {
        (function (idx) {
          var pte = v.entries[idx] & 0xFFFF;
          var b = pwEl("button", "pw-row" + (st.sel === idx ? " sel" : ""));
          b.setAttribute("aria-pressed", st.sel === idx ? "true" : "false");
          b.setAttribute("aria-label", "Table entry " + idx + ", " + pwKind(pte) + ", PTE " + pwHex(pte, 4));
          b.appendChild(pwEl("span", "pw-idx", String(idx)));
          b.appendChild(pwEl("span", "pw-pte", pwHex(pte, 4).slice(2)));
          b.appendChild(pwEl("span", "pw-flags", pwFlagStr(pte)));
          b.appendChild(pwEl("span", "pw-kind k" + pwKind(pte), pwKind(pte)));
          b.addEventListener("click", function () { pwSelect(st, idx); });
          box.appendChild(b);
        })(i);
      }
      pw$(px + "Step").style.display = v.noStep ? "none" : "";
    } else {
      pane.style.display = "none";
      var wrap = pwEl("div", "pw-leaf");
      if (v.kind === "leaf") {
        wrap.appendChild(pwLeafPanel(st, v));
      } else {
        var h = pwEl("h5", null, "Walk ends here");
        h.style.cssText = "font-family:var(--font-m);font-size:11px;letter-spacing:.14em;color:var(--paper);margin:0 0 8px;";
        var p = pwEl("p", null, v.msg);
        p.style.cssText = "font-family:var(--font-m);font-size:12px;color:var(--steel);line-height:1.7;margin:0;";
        wrap.appendChild(h); wrap.appendChild(p);
      }
      side.appendChild(wrap);
      pw$(px + "Step").style.display = "none";
    }
    pw$(px + "Back").style.display = st.hist.length ? "" : "none";
  }

  function pwLeafPanel(st, v) {
    var pte = v.pte, frag = document.createDocumentFragment();
    var h = pwEl("h5", null, "Leaf PTE, level " + v.level + ", index " + v.index + (v.super ? " (superpage)" : ""));
    h.style.cssText = "font-family:var(--font-m);font-size:11px;letter-spacing:.14em;color:var(--paper);margin:0 0 10px;";
    frag.appendChild(h);
    var dl = pwEl("dl", "pw-dec");
    function row(k, txt, cls) {
      var dt = pwEl("dt", null, k), dd = pwEl("dd", cls || "", txt);
      dl.appendChild(dt); dl.appendChild(dd);
    }
    row("PTE", pwHex(pte, 4));
    row("PPN", pwHex(pwPpn(pte), 2).slice(2) + (v.super ? " (high nibble only, low nibble comes from VPN0)" : ""));
    row("FLAGS", pwFlagStr(pte));
    row("COVERAGE", v.super ? "4 KiB superpage (VPN0 + OFFSET)" : "256 byte page");
    var need = pwPermFor(st.access);
    var grants = (pte & pwNeed(st.access)) !== 0;
    row("PERMISSION", grants
      ? "grants " + st.access + " (" + need + "=1): translation proceeds"
      : "denies " + st.access + " (" + need + "=0): this walk ends in a " + pwFaultName(st.access),
      grants ? "good" : "bad");
    frag.appendChild(dl);
    if (v.truePath) {
      var box = pwEl("div", "pw-commit");
      var lab = pwEl("label", null, "PHYSICAL ADDRESS (HEX)");
      var inp = pwEl("input", null, "");
      inp.id = st.px + "CommitInput";
      inp.setAttribute("placeholder", "0x0000");
      inp.setAttribute("inputmode", "text");
      inp.setAttribute("autocomplete", "off");
      inp.setAttribute("spellcheck", "false");
      lab.appendChild(inp);
      var btn = pwEl("button", "pw-btn primary", "Commit translation");
      btn.id = st.px + "CommitBtn";
      btn.addEventListener("click", function () { pwCommit(st); });
      box.appendChild(lab); box.appendChild(btn);
      frag.appendChild(box);
      var hint = pwEl("p", null, v.super
        ? "PA = ((leaf PPN high nibble : VPN0) : OFFSET)"
        : "PA = (leaf PPN : OFFSET)");
      hint.style.cssText = "font-family:var(--font-m);font-size:11px;color:var(--dim);margin:10px 0 0;";
      frag.appendChild(hint);
    } else {
      var note = pwEl("p", null, "Decoy entry, off the true path. Step back up and read the VPN fields again.");
      note.style.cssText = "font-family:var(--font-m);font-size:12px;color:var(--steel);margin:0;";
      frag.appendChild(note);
    }
    return frag;
  }

  function pwSelect(st, idx) {
    st.sel = idx;
    pwRenderView(st);
  }

  function pwStep(st) {
    var v = st.view;
    if (!v || v.kind !== "table" || v.noStep) return;
    var i = st.sel;
    if (i < 0) { toast("Pick a table row first, then step into it."); return; }
    var pte = v.entries[i] & 0xFFFF;
    if (i === v.trueIndex) {
      if (!(pte & PW_V)) {
        pwLog(st, "L" + v.level + ": index " + i + " -> 0x0000, V=0. Page not present.", "bad");
        st.hist.push(v);
        st.view = { kind: "dead",
          msg: "The true entry is invalid (V=0), so the page is not present. There is no translation to commit: raise the page fault." };
      } else if (pte & (PW_R | PW_W | PW_X)) {
        var sup = v.level === 1;
        pwLog(st, "L" + v.level + ": index " + i + " -> leaf " + pwHex(pte, 4) +
          " [" + pwFlagStr(pte) + "]" + (sup ? " SUPERPAGE" : ""), "ok");
        st.hist.push(v);
        st.view = { kind: "leaf", pte: pte, level: v.level, index: i, super: sup, truePath: true };
      } else {
        var t = pwPpn(pte) & 15;
        pwLog(st, "L1: index " + i + " -> pointer, table " + t + ".", "ok");
        st.hist.push(v);
        st.view = { kind: "table", entries: st.tables.l1[t], level: 2, trueIndex: (st.va >>> 8) & 15,
                    title: "Level 2: page table " + t, sub: "Index it with VPN0. One true path." };
      }
    } else {
      var k = pwKind(pte);
      pwLog(st, "Index " + i + " is a decoy (the VPN fields point at " + v.trueIndex + "). Looking anyway.");
      st.hist.push(v);
      if (k === "INVALID") {
        st.view = { kind: "dead", msg: "Entry " + i + " is 0x0000: not a mapping, just a decoy. Step back up and trust the VPN fields." };
      } else if (k === "TABLE") {
        var t2 = pwPpn(pte) & 15;
        st.view = { kind: "table", entries: st.tables.l1[t2] || [], level: 0, trueIndex: -1, noStep: true,
                    title: "Decoy table " + t2, sub: "Off the true path. Nothing here translates this address." };
      } else {
        st.view = { kind: "leaf", pte: pte, level: v.level, index: i, super: false, truePath: false };
      }
    }
    st.sel = -1;
    pwRenderView(st);
  }

  function pwBack(st) {
    var v = st.hist.pop();
    if (!v) return;
    st.view = v;
    st.sel = -1;
    pwLog(st, "Backed up a level.");
    pwRenderView(st);
  }

  function pwVerdict(st, ok, html) {
    var box = pw$(st.px + "Verdict");
    box.className = "pw-verdict show " + (ok ? "pass" : "fail");
    box.innerHTML = "<b>" + (ok ? "PASS" : "FAIL") + "</b> " + html;
  }

  function pwPass(st, msg) {
    st.passed = true;
    pwLog(st, "Verdict: PASS. " + msg, "ok");
    pwVerdict(st, true, pwEsc(msg) + " <span style=\"color:var(--dim)\">(" + st.attempts + " attempt" +
      (st.attempts === 1 ? "" : "s") + ")</span>");
    if (st.mode === "trial") pwTrialPassed(st);
  }

  function pwFail(st, msg) {
    pwLog(st, "Verdict: FAIL. " + msg, "bad");
    pwVerdict(st, false, pwEsc(msg));
    if (st.mode === "trial") pwTrialCard(st.job.id, false);
  }

  function pwCommit(st) {
    var inp = pw$(st.px + "CommitInput");
    var raw = inp ? inp.value.trim().replace(/^0x/i, "") : "";
    st.attempts++;
    if (!/^[0-9a-fA-F]{1,4}$/.test(raw)) {
      pwFail(st, "That is not a 16-bit hex value. Type the physical address as hex, for example 0x1A40.");
      return;
    }
    var want = pwWalk(st.tables, st.va, st.access);
    var got = parseInt(raw, 16) & 0xFFFF;
    if (!want.ok) {
      pwFail(st, "There is no translation to commit. The true walk ends in " + want.fault + ": " + want.why + ".");
    } else if (got === want.pa) {
      pwPass(st, "Translated " + pwHex(st.va, 4) + " to " + pwHex(want.pa, 4) +
        (want.super ? " through the superpage." : " through both levels."));
    } else {
      pwFail(st, pwHex(got, 4) + " is not this address. Recheck the PPN bits and the offset, then walk it again.");
    }
  }

  function pwRaiseFault(st) {
    st.attempts++;
    var want = pwWalk(st.tables, st.va, st.access);
    if (!want.ok) {
      pwPass(st, "Correct: " + want.fault + ". " + want.why + ".");
    } else {
      pwFail(st, "No fault here: this address translates cleanly to " + pwHex(want.pa, 4) + ". Walk the tables and commit it.");
    }
  }

  /* ---------------- explore + trials ---------------- */

  function pwStartJob(st, job) {
    st.va = job.va; st.access = job.access;
    st.tables = pwGenTables(job.seed, { va: job.va, access: job.access, kind: job.kind });
    st.hist = []; st.sel = -1; st.logLines = []; st.attempts = 0; st.passed = false;
    pwSetAddr(st);
    pw$(st.px + "Log").innerHTML = "";
    pwLog(st, job.name + ": " + job.brief);
    st.view = pwRootView(st);
    pwRenderView(st);
    pw$(st.px + "Verdict").className = "pw-verdict";
    pw$(st.px + "Verdict").innerHTML = "";
  }

  function pwNewExplore(st) {
    var seed = ((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0) || 1;
    var rng = pwRng(seed);
    var kinds = ["l2", "super", "faultperm", "faultinvalid"];
    var accesses = ["READ", "WRITE", "EXECUTE"];
    var kind = kinds[pwRi(rng, kinds.length)];
    st.va = pwRi(rng, 65536);
    st.access = accesses[pwRi(rng, accesses.length)];
    st.tables = pwGenTables(seed ^ 0x9E37, { va: st.va, access: st.access, kind: kind });
    st.hist = []; st.sel = -1; st.logLines = []; st.attempts = 0; st.passed = false;
    pwSetAddr(st);
    pw$(st.px + "Log").innerHTML = "";
    pwLog(st, "New address on the bench. Walk it: read the VPN fields, step the tables, then commit or raise the fault.");
    st.view = pwRootView(st);
    pwRenderView(st);
    pw$(st.px + "Verdict").className = "pw-verdict";
    pw$(st.px + "Verdict").innerHTML = "";
  }

  function pwTrialCard(id, passed) {
    for (var i = 0; i < PW_JOBS.length; i++) {
      if (PW_JOBS[i].id === id) {
        var s = pw$("pwCardStat" + i);
        if (s) {
          s.textContent = passed ? "PASS" : (s.textContent === "PASS" ? "PASS" : "OPEN");
          s.className = "pw-pstat" + (passed ? " pass" : (s.textContent === "PASS" ? " pass" : ""));
        }
      }
    }
  }

  function pwTrialPassed(st) {
    pwTrialCard(st.job.id, true);
    var all = PW_JOBS.every(function (j) {
      var s = pw$("pwCardStat" + PW_JOBS.indexOf(j));
      return s && s.textContent === "PASS";
    });
    if (all) {
      var cert = pw$("pwCert");
      cert.classList.add("show");
      pwLog(st, "All three trials passed. The walker is qualified.", "ok");
    }
  }

  function pwBuildTrials(page) {
    var cards = pwEl("div", "pw-cards");
    PW_JOBS.forEach(function (job, i) {
      var c = pwEl("div", "pw-card");
      var h = pwEl("h5", null, job.name);
      var p = pwEl("p", null, job.brief);
      var row = pwEl("div", "row");
      var stat = pwEl("span", "pw-pstat", "OPEN");
      stat.id = "pwCardStat" + i;
      var open = pwEl("button", "pw-mini go", "Walk this trial");
      open.id = "pwOpen" + i;
      open.addEventListener("click", function () {
        pwNewBoard(pw$("pwTrialBoard"), { mode: "trial", job: job });
        toast("Trial selected: " + job.name);
      });
      row.appendChild(stat); row.appendChild(open);
      c.appendChild(h); c.appendChild(p); c.appendChild(row);
      cards.appendChild(c);
    });
    page.appendChild(cards);
    var board = pwEl("div", null, "");
    board.id = "pwTrialBoard";
    page.appendChild(board);
    var cert = pwEl("div", "pw-cert", "");
    cert.id = "pwCert";
    cert.innerHTML =
      "<h4>PAGE WALKER, QUALIFIED</h4>" +
      "<p>Three walks, three verdicts, zero faults mishandled. " +
      "This bench now certifies the walker on sv32-style two-level translation: " +
      "index math, PTE flag decoding, superpages, permission checks, and fault raising.</p>";
    var dl = pwEl("button", "pw-btn primary", "Download certificate");
    dl.addEventListener("click", pwDownloadCert);
    cert.appendChild(dl);
    page.appendChild(cert);
  }

  /* ---------------- reports ---------------- */

  function pwTableDump(tables) {
    var L = [];
    L.push("ROOT PAGE TABLE (level 1)");
    for (var i = 0; i < 16; i++) {
      var pte = tables.root[i] & 0xFFFF;
      L.push("  [" + i + "] " + pwHex(pte, 4).slice(2) + "  " + pwFlagStr(pte) + "  " + pwKind(pte));
    }
    for (var t = 0; t < 4; t++) {
      L.push("TABLE " + t + " (level 2)");
      for (var j = 0; j < 16; j++) {
        var p2 = (tables.l1[t][j] & 0xFFFF);
        L.push("  [" + j + "] " + pwHex(p2, 4).slice(2) + "  " + pwFlagStr(p2) + "  " + pwKind(p2));
      }
    }
    return L.join("\n");
  }

  function pwDownload(text, name) {
    var blob = new Blob([text], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      (window.URL || window.webkitURL).revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function pwBoardForReport(st) {
    var L = [];
    L.push("THE PAGE WALKER: WALK REPORT");
    L.push("=============================");
    L.push((st.mode === "trial" ? st.job.name : "Open bench walk") + "   access " + st.access);
    L.push("Virtual address: " + pwHex(st.va, 4) + "   VPN1=" + ((st.va >>> 12) & 15) +
      " VPN0=" + ((st.va >>> 8) & 15) + " OFFSET=" + pwHex(st.va & 255, 2));
    var truth = pwWalk(st.tables, st.va, st.access);
    L.push("True outcome: " + (truth.ok
      ? "translates to " + pwHex(truth.pa, 4) + (truth.super ? " (superpage)" : "")
      : truth.fault + ": " + truth.why));
    L.push("Attempts: " + st.attempts + "   Verdict: " + (st.passed ? "PASS" : "not passed"));
    L.push("");
    L.push("WALK LOG");
    st.logLines.forEach(function (ln) { L.push("  " + ln); });
    L.push("");
    L.push(pwTableDump(st.tables));
    return L.join("\n");
  }

  var pwLastTrialBoard = null;
  function pwDownloadReport(st) {
    pwDownload(pwBoardForReport(st), "page-walker-report.txt");
    toast("Walk report downloaded.");
  }

  function pwDownloadCert() {
    var L = [];
    L.push("THE PAGE WALKER: QUALIFICATION CERTIFICATE");
    L.push("===========================================");
    L.push("The holder walked three sv32-style two-level page tables to a verdict:");
    PW_JOBS.forEach(function (j) {
      var truth = pwWalk(pwGenTables(j.seed, { va: j.va, access: j.access, kind: j.kind }), j.va, j.access);
      L.push("  " + j.name + ": " + (truth.ok ? "translated to " + pwHex(truth.pa, 4) : truth.fault) + " ... PASS");
    });
    L.push("");
    L.push("Index math, PTE flag decoding, superpages, permission checks, fault raising:");
    L.push("all demonstrated live on the bench. The MMU has no complaints.");
    L.push("Date: " + new Date().toISOString().slice(0, 10));
    pwDownload(L.join("\n"), "page-walker-certificate.txt");
    toast("Certificate downloaded.");
  }

  /* ---------------- shell ---------------- */

  function pwBuildShell() {
    var css = document.createElement("style");
    css.textContent = PW_CSS.join("\n");
    document.head.appendChild(css);

    var box = document.querySelector(".dossier .actions");
    if (box && !pw$("pwBtn")) {
      var b = pwEl("button", "secondary", "Run the Page Walker");
      b.id = "pwBtn";
      b.addEventListener("click", function () { pw$("pwOverlay").classList.add("open"); });
      box.appendChild(b);
    }

    var ov = pwEl("div", "pw-overlay");
    ov.id = "pwOverlay";
    var panel = pwEl("div", "pw-panel");
    ov.appendChild(panel);
    document.body.appendChild(ov);

    var bar = pwEl("div", "pw-bar");
    var title = pwEl("div", "pw-title", "");
    title.innerHTML = "THE PAGE <b>WALKER</b>";
    var tabs = pwEl("div", "pw-tabs");
    var tExp = pwEl("button", "pw-tab on", "EXPLORE");
    tExp.id = "pwTabExp";
    var tTri = pwEl("button", "pw-tab", "TRIALS");
    tTri.id = "pwTabTri";
    tabs.appendChild(tExp); tabs.appendChild(tTri);
    var close = pwEl("button", "pw-close", "CLOSE [x]");
    bar.appendChild(title); bar.appendChild(tabs); bar.appendChild(close);
    panel.appendChild(bar);

    var body = pwEl("div", "pw-body");
    var sub = pwEl("p", "pw-sub", "");
    sub.innerHTML = "<b>HOW IT WORKS</b> Every load, store, and fetch walks the page tables. " +
      "Read VPN1 and VPN0 out of the virtual address, step the matching entries, decode the PTE flags, " +
      "and either commit the physical address or raise the page fault. " +
      "Same walk as sv32 (and xv6), on 16-entry training tables. " +
      "Built for the <a href=\"https://dillingerstaffing.github.io/portfolio/\" target=\"_blank\" rel=\"noopener\">RISC-V portfolio work</a>.";
    body.appendChild(sub);
    var pageExp = pwEl("div", null, "");
    pageExp.id = "pwPageExp";
    var pageTri = pwEl("div", null, "");
    pageTri.id = "pwPageTri";
    pageTri.style.display = "none";
    body.appendChild(pageExp);
    body.appendChild(pageTri);
    panel.appendChild(body);

    close.addEventListener("click", function () { ov.classList.remove("open"); });
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("open"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("open")) ov.classList.remove("open");
    });
    tExp.addEventListener("click", function () {
      tExp.classList.add("on"); tTri.classList.remove("on");
      pageExp.style.display = ""; pageTri.style.display = "none";
    });
    tTri.addEventListener("click", function () {
      tTri.classList.add("on"); tExp.classList.remove("on");
      pageTri.style.display = ""; pageExp.style.display = "none";
    });

    pwNewBoard(pageExp, { mode: "explore" });
    pwBuildTrials(pageTri);
  }

  function pwInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    pwBuildShell();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", pwInit);
    } else {
      pwInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      PW: {
        walk: pwWalk, gen: pwGenTables, jobs: PW_JOBS,
        hex: pwHex, bin: pwBin, kind: pwKind, flags: pwFlagStr,
        pte: pwPte, ppn: pwPpn
      }
    });
  }

})();
/* ================= THE TRAP GATE (BENCH 10) =================
   RISC-V trap delegation on the bench. A real mcause / medeleg /
   mideleg / mtvec dispatch engine: interrupts and synchronous
   exceptions arrive on the wire, and the firmware (you) decides which
   privilege mode handles each one. EXPLORE dispatches any trap live;
   TRIALS qualifies on three fixed routing jobs. */

(function () {
  "use strict";

  /* ---------------- pure core: no DOM ---------------- */

  var TG_BASE = 0x1000;

  var TG_CAUSES = [
    { key: "misalign",   name: "Instruction address misaligned", cause: 0,  interrupt: false },
    { key: "illegal",    name: "Illegal instruction",            cause: 2,  interrupt: false },
    { key: "breakpoint", name: "Breakpoint",                     cause: 3,  interrupt: false },
    { key: "loadacc",    name: "Load access fault",              cause: 5,  interrupt: false },
    { key: "storeacc",   name: "Store access fault",             cause: 7,  interrupt: false },
    { key: "ecallu",     name: "Environment call from U-mode",   cause: 8,  interrupt: false },
    { key: "ecalls",     name: "Environment call from S-mode",   cause: 9,  interrupt: false },
    { key: "ecallm",     name: "Environment call from M-mode",   cause: 11, interrupt: false },
    { key: "ipagefault", name: "Instruction page fault",         cause: 12, interrupt: false },
    { key: "lpagefault", name: "Load page fault",                cause: 13, interrupt: false },
    { key: "spagefault", name: "Store page fault",               cause: 15, interrupt: false },
    { key: "ssoft",      name: "Supervisor software interrupt",  cause: 1,  interrupt: true },
    { key: "msoft",      name: "Machine software interrupt",     cause: 3,  interrupt: true },
    { key: "stimer",     name: "Supervisor timer interrupt",     cause: 5,  interrupt: true },
    { key: "mtimer",     name: "Machine timer interrupt",        cause: 7,  interrupt: true },
    { key: "sexternal",  name: "Supervisor external interrupt",  cause: 9,  interrupt: true },
    { key: "mexternal",   name: "Machine external interrupt",     cause: 11, interrupt: true }
  ];

  function tgByKey(key) {
    for (var i = 0; i < TG_CAUSES.length; i++) {
      if (TG_CAUSES[i].key === key) return TG_CAUSES[i];
    }
    return null;
  }
  function tgHex(n, pad) {
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < pad) s = "0" + s;
    return "0x" + s;
  }
  function tgBit(n, b) { return ((n >>> 0) >>> b) & 1; }

  /* cfg: { mode: "direct" | "vectored", medeleg: u32, mideleg: u32 } */
  function tgDispatch(trap, cfg) {
    var csr = trap.interrupt ? "mideleg" : "medeleg";
    var mask = trap.interrupt ? (cfg.mideleg >>> 0) : (cfg.medeleg >>> 0);
    var delegated = tgBit(mask, trap.cause) === 1;
    var dest = delegated ? "S" : "M";
    var mcause = ((trap.cause >>> 0) | (trap.interrupt ? 0x80000000 : 0)) >>> 0;
    var vectored = cfg.mode === "vectored" && trap.interrupt;
    var pc = (TG_BASE + (vectored ? 4 * trap.cause : 0)) >>> 0;
    var cycles = cfg.mode === "vectored" ? 1 : 3;
    var trace = [];
    trace.push("mcause = " + tgHex(mcause, 8) + ": " +
      (trap.interrupt ? "interrupt bit set" : "synchronous exception") +
      ", code " + trap.cause + " (" + trap.name + ")");
    trace.push(csr + "[" + trap.cause + "] = " + (delegated ? 1 : 0) + ": trap " +
      (delegated ? "delegated, taken in S-mode" : "kept, taken in M-mode"));
    trace.push("mtvec " + (cfg.mode === "vectored" ? "VECTORED" : "DIRECT") +
      (cfg.mode === "vectored" && !trap.interrupt
        ? " (vectored mode only vectors interrupts, so this sync exception lands at BASE)" : "") +
      ": target PC = " + tgHex(pc, 8));
    trace.push("dispatch cost " + cycles + " cycle" + (cycles === 1 ? "" : "s") +
      (cfg.mode === "vectored" ? " (hardware vector)" : " (software cause decode)"));
    return { mcause: mcause, dest: dest, pc: pc, cycles: cycles,
             delegated: delegated, csr: csr, trace: trace };
  }

  var TG_TRIALS = [
    { id: "t1", name: "Trial 1: First Light", mode: "direct",
      brief: "You are the machine firmware on first boot. Nothing delegates: every trap is handled in M-mode. Set mtvec to DIRECT and keep every delegation bit in M.",
      traps: ["illegal", "ecallm", "mtimer", "loadacc", "misalign"],
      policy: { illegal: "M", ecallm: "M", mtimer: "M", loadacc: "M", misalign: "M" } },
    { id: "t2", name: "Trial 2: The Supervisor's Cut", mode: "vectored",
      brief: "An OS now runs in S-mode and wants its own traps: U-mode ecalls, the supervisor timer, and supervisor external interrupts delegate to S. Everything else stays in M. Firmware rule: VECTORED for speed.",
      traps: ["ecallu", "stimer", "sexternal", "illegal", "mexternal"],
      policy: { ecallu: "S", stimer: "S", sexternal: "S", illegal: "M", mexternal: "M" } },
    { id: "t3", name: "Trial 3: The Fault Line", mode: "vectored",
      brief: "The OS handles its own memory faults and the debugger lives in S-mode: page faults and breakpoints delegate. Illegal instructions and the machine timer stay with firmware. VECTORED.",
      traps: ["lpagefault", "spagefault", "breakpoint", "illegal", "mtimer"],
      policy: { lpagefault: "S", spagefault: "S", breakpoint: "S", illegal: "M", mtimer: "M" } }
  ];

  function tgTrialById(id) {
    for (var i = 0; i < TG_TRIALS.length; i++) {
      if (TG_TRIALS[i].id === id) return TG_TRIALS[i];
    }
    return null;
  }

  /* ---------------- CSS ---------------- */

  var TG_CSS = [
    ".tg-overlay{position:fixed;inset:0;z-index:9995;background:rgba(5,8,10,.94);display:none;}",
    ".tg-overlay.open{display:flex;}",
    ".tg-panel{flex:1;min-height:0;width:100%;max-width:900px;margin:0 auto;display:flex;flex-direction:column;background:#0a0c0e;border:1px solid var(--line);overflow:hidden;}",
    "@media(min-width:700px){.tg-panel{border-radius:4px;}}",
    ".tg-bar{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);flex:none;flex-wrap:wrap;background:var(--panel);}",
    ".tg-title{font-family:var(--font-d);font-size:13px;font-weight:700;letter-spacing:.14em;color:var(--paper);white-space:nowrap;}",
    ".tg-title b{color:var(--ember);}",
    ".tg-tabs{display:flex;gap:6px;flex:1;flex-wrap:wrap;}",
    ".tg-tab{font-family:var(--font-m);font-size:11px;font-weight:600;letter-spacing:.1em;padding:12px 16px;min-height:48px;border:1px solid transparent;background:none;color:var(--steel);cursor:pointer;border-radius:4px;}",
    ".tg-tab.on{color:var(--ember);border-color:rgba(255,90,31,.4);background:rgba(255,90,31,.08);}",
    ".tg-tab:active{transform:scale(.96);}",
    ".tg-close{font-family:var(--font-m);font-size:12px;font-weight:700;letter-spacing:.08em;min-height:48px;min-width:48px;padding:12px 18px;border-radius:4px;border:1px solid var(--ember);background:var(--ember);color:#0a0c0e;cursor:pointer;}",
    ".tg-close:active{transform:scale(.96);}",
    ".tg-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;}",
    ".tg-sub{font-family:var(--font-m);font-size:11px;color:var(--steel);letter-spacing:.04em;line-height:1.8;margin:0 0 12px;}",
    ".tg-sub b{color:var(--paper);font-weight:600;letter-spacing:.08em;font-size:10px;}",
    ".tg-sub a{color:var(--ice);}",
    ".tg-cards{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:12px;}",
    "@media(min-width:700px){.tg-cards{grid-template-columns:repeat(3,1fr);}}",
    ".tg-card{border:1px solid var(--line);border-radius:4px;padding:14px;background:var(--panel);}",
    ".tg-card h5{margin:0 0 6px;font-family:var(--font-d);font-size:14px;color:var(--paper);}",
    ".tg-card p{margin:0 0 10px;font-size:12px;color:var(--steel);line-height:1.6;}",
    ".tg-card .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
    ".tg-pstat{font-family:var(--font-m);font-size:10px;font-weight:700;letter-spacing:.12em;padding:6px 12px;border-radius:2px;border:1px solid var(--line);color:var(--steel);}",
    ".tg-pstat.pass{color:var(--mint);border-color:rgba(125,224,168,.5);}",
    ".tg-pstat.fail{color:var(--bad);border-color:rgba(255,122,122,.5);}",
    ".tg-mini{font-family:var(--font-m);font-size:11px;font-weight:700;letter-spacing:.06em;min-height:48px;padding:12px 16px;border-radius:4px;border:1px solid rgba(242,237,227,.2);background:var(--panel-2);color:var(--paper);cursor:pointer;}",
    ".tg-mini:active{transform:scale(.96);}",
    ".tg-mini.go{background:var(--ember);border-color:var(--ember);color:#0a0c0e;}",
    ".tg-brief{font-size:12px;color:var(--steel);line-height:1.7;margin:0 0 12px;max-width:70ch;}",
    ".tg-brief b{color:var(--paper);}",
    ".tg-sec{font-family:var(--font-m);font-size:10px;font-weight:700;letter-spacing:.14em;color:var(--dim);margin:14px 0 8px;}",
    ".tg-seg{display:inline-flex;border:1px solid var(--line);border-radius:4px;overflow:hidden;}",
    ".tg-seg button{font-family:var(--font-m);font-size:11px;font-weight:700;letter-spacing:.08em;min-height:48px;min-width:88px;padding:12px 18px;background:var(--panel-2);color:var(--steel);border:none;cursor:pointer;}",
    ".tg-seg button + button{border-left:1px solid var(--line);}",
    ".tg-seg button.on{background:var(--ember);color:#0a0c0e;}",
    ".tg-seg button:active{transform:scale(.96);}",
    ".tg-note{font-family:var(--font-m);font-size:11px;color:var(--dim);line-height:1.7;margin:8px 0 0;}",
    ".tg-rows{display:grid;grid-template-columns:1fr;gap:8px;margin:8px 0 12px;}",
    ".tg-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid var(--line);border-radius:4px;padding:10px 12px;background:var(--panel);}",
    ".tg-row .nm{flex:1;min-width:180px;font-family:var(--font-d);font-size:13px;color:var(--paper);}",
    ".tg-row .tag{font-family:var(--font-m);font-size:10px;letter-spacing:.1em;color:var(--dim);display:block;margin-top:2px;}",
    ".tg-row .tag i{font-style:normal;color:var(--ice);}",
    ".tg-res{font-family:var(--font-m);font-size:11px;line-height:1.7;color:var(--steel);margin:4px 0 0;flex-basis:100%;}",
    ".tg-res b{color:var(--paper);}",
    ".tg-res .ok{color:var(--mint);font-weight:700;}",
    ".tg-res .no{color:var(--bad);font-weight:700;}",
    ".tg-strikes{display:flex;align-items:center;gap:10px;margin:10px 0;flex-wrap:wrap;}",
    ".tg-strike{font-family:var(--font-m);font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--steel);border:1px solid var(--line);border-radius:2px;padding:6px 10px;}",
    ".tg-strike.hit{color:var(--bad);border-color:rgba(255,122,122,.6);}",
    ".tg-trace{list-style:none;margin:10px 0 0;padding:0;font-family:var(--font-m);font-size:11px;line-height:1.9;color:var(--steel);}",
    ".tg-trace li{border-left:2px solid var(--ember);padding-left:10px;margin-bottom:6px;}",
    ".tg-fields{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;}",
    ".tg-field{border:1px solid var(--line);border-radius:4px;padding:8px 12px;background:var(--panel);}",
    ".tg-field .k{display:block;font-family:var(--font-m);font-size:9px;letter-spacing:.16em;color:var(--dim);margin-bottom:4px;}",
    ".tg-field .v{font-family:var(--font-m);font-size:14px;color:var(--paper);}",
    ".tg-field .v em{font-style:normal;color:var(--ember);}",
    ".tg-select{font-family:var(--font-m);font-size:12px;min-height:48px;padding:12px;background:var(--panel-2);color:var(--paper);border:1px solid var(--line);border-radius:4px;max-width:100%;}",
    ".tg-cert{display:none;border:1px solid rgba(125,224,168,.5);border-radius:4px;padding:16px;background:rgba(125,224,168,.05);margin-top:14px;}",
    ".tg-cert.show{display:block;}",
    ".tg-cert h4{margin:0 0 6px;font-family:var(--font-d);color:var(--ember);letter-spacing:.1em;font-size:15px;}",
    ".tg-cert p{margin:0 0 12px;font-size:12px;color:var(--steel);line-height:1.7;}",
    "button:focus-visible,.tg-select:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
    "@media (prefers-reduced-motion:reduce){.tg-panel *{transition:none !important;}}"
  ];

  /* ---------------- DOM helpers ---------------- */

  function tg$(id) { return document.getElementById(id); }
  function tgEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function tgEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------------- explore board ---------------- */

  var TG_EXP = { key: "stimer", dest: "S", mode: "vectored" };

  function tgCfgFor(dest, trap) {
    var m = 0, i = 0;
    if (dest === "S") {
      if (trap.interrupt) i = (1 << trap.cause) >>> 0;
      else m = (1 << trap.cause) >>> 0;
    }
    return { medeleg: m >>> 0, mideleg: i >>> 0 };
  }

  function tgSeg(label, opts, cur, cb) {
    var wrap = tgEl("span", "tg-seg");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", label);
    opts.forEach(function (o) {
      var b = tgEl("button", null, o.label);
      b.type = "button";
      if (o.value === cur) b.classList.add("on");
      b.setAttribute("aria-pressed", o.value === cur ? "true" : "false");
      b.addEventListener("click", function () {
        var kids = wrap.querySelectorAll("button");
        for (var k = 0; k < kids.length; k++) {
          kids[k].classList.remove("on");
          kids[k].setAttribute("aria-pressed", "false");
        }
        b.classList.add("on");
        b.setAttribute("aria-pressed", "true");
        cb(o.value);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function tgBuildExplore(page) {
    var st = TG_EXP;

    var sec1 = tgEl("div", "tg-sec", "1. PICK A TRAP ON THE WIRE");
    page.appendChild(sec1);
    var sel = tgEl("select", "tg-select");
    sel.id = "tgExpSel";
    sel.setAttribute("aria-label", "Trap to dispatch");
    TG_CAUSES.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t.key;
      o.textContent = t.name + " (cause " + t.cause + (t.interrupt ? ", interrupt" : ", sync") + ")";
      if (t.key === st.key) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { st.key = sel.value; });
    page.appendChild(sel);

    var sec2 = tgEl("div", "tg-sec", "2. ROUTE IT: DELEGATE TO S-MODE OR KEEP IN M-MODE");
    page.appendChild(sec2);
    page.appendChild(tgSeg("Delegation", [
      { label: "KEEP IN M", value: "M" },
      { label: "DELEGATE TO S", value: "S" }
    ], st.dest, function (v) { st.dest = v; }));
    var note1 = tgEl("p", "tg-note",
      "Sets mideleg for interrupts or medeleg for sync exceptions: bit[cause] = 1 delegates to S-mode.");
    page.appendChild(note1);

    var sec3 = tgEl("div", "tg-sec", "3. SET MTVEC MODE");
    page.appendChild(sec3);
    page.appendChild(tgSeg("mtvec mode", [
      { label: "DIRECT", value: "direct" },
      { label: "VECTORED", value: "vectored" }
    ], st.mode, function (v) { st.mode = v; }));
    var note2 = tgEl("p", "tg-note",
      "Vectored mode jumps interrupts to BASE + 4 x cause. Sync exceptions always land at BASE. Direct mode decodes the cause in software (3 cycles).");
    page.appendChild(note2);

    var row = tgEl("div", "tg-strikes");
    var step = tgEl("button", "tg-mini go", "STEP THE TRAP");
    step.type = "button";
    row.appendChild(step);
    page.appendChild(row);

    var fields = tgEl("div", "tg-fields");
    page.appendChild(fields);
    var trace = tgEl("ol", "tg-trace");
    page.appendChild(trace);

    function render() {
      var trap = tgByKey(st.key);
      var masks = tgCfgFor(st.dest, trap);
      var cfg = { mode: st.mode, medeleg: masks.medeleg, mideleg: masks.mideleg };
      var d = tgDispatch(trap, cfg);
      fields.innerHTML = "";
      var f1 = tgEl("div", "tg-field");
      f1.innerHTML = '<span class="k">MIDELEG</span><span class="v">' + tgEsc(tgHex(masks.mideleg, 8)) + "</span>";
      var f2 = tgEl("div", "tg-field");
      f2.innerHTML = '<span class="k">MEDELEG</span><span class="v">' + tgEsc(tgHex(masks.medeleg, 8)) + "</span>";
      var f3 = tgEl("div", "tg-field");
      f3.innerHTML = '<span class="k">TAKEN IN</span><span class="v"><em>' + d.dest + "-MODE</em></span>";
      var f4 = tgEl("div", "tg-field");
      f4.innerHTML = '<span class="k">TARGET PC</span><span class="v">' + tgEsc(tgHex(d.pc, 8)) + "</span>";
      fields.appendChild(f1); fields.appendChild(f2); fields.appendChild(f3); fields.appendChild(f4);
      trace.innerHTML = "";
      d.trace.forEach(function (ln) {
        var li = tgEl("li", null, ln);
        trace.appendChild(li);
      });
    }
    step.addEventListener("click", render);
    render();
  }

  /* ---------------- trials board ---------------- */

  var TG_ST = {};
  TG_TRIALS.forEach(function (t) {
    TG_ST[t.id] = { mode: t.mode, bits: {}, strikes: 0, attempts: 0, passed: false, results: null };
    t.traps.forEach(function (k) { TG_ST[t.id].bits[k] = "M"; });
  });

  function tgCfgFromState(t, st) {
    var m = 0, i = 0, k, trap;
    for (var j = 0; j < t.traps.length; j++) {
      k = t.traps[j];
      if (st.bits[k] === "S") {
        trap = tgByKey(k);
        if (trap.interrupt) i |= (1 << trap.cause) >>> 0;
        else m |= (1 << trap.cause) >>> 0;
      }
    }
    return { mode: st.mode, medeleg: m >>> 0, mideleg: i >>> 0 };
  }

  function tgDownload(text, name) {
    var blob = new Blob([text], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      (window.URL || window.webkitURL).revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function tgTrialReport(t, st) {
    var L = [];
    L.push("THE TRAP GATE: TRIAL REPORT");
    L.push("===========================");
    L.push(t.name);
    L.push(t.brief);
    L.push("");
    var cfg = tgCfgFromState(t, st);
    L.push("Final config: mtvec " + st.mode.toUpperCase() +
      ", medeleg=" + tgHex(cfg.medeleg, 8) + ", mideleg=" + tgHex(cfg.mideleg, 8));
    L.push("Attempts: " + st.attempts + "   Strikes: " + st.strikes + "   Verdict: " +
      (st.passed ? "PASS" : "not passed"));
    if (st.results) {
      L.push("");
      L.push("LAST RUN");
      st.results.rows.forEach(function (r) {
        L.push("  [" + (r.ok ? "PASS" : "STRIKE") + "] " + r.trap.name +
          " -> " + r.d.dest + "-mode (PC " + tgHex(r.d.pc, 8) + ")" +
          (r.ok ? "" : "  required " + r.want + "-mode"));
      });
      L.push("  cycles: " + st.results.cycles + " (budget " + st.results.par + ")");
    }
    return L.join("\n");
  }

  function tgDownloadCert() {
    var L = [];
    L.push("THE TRAP GATE: QUALIFICATION CERTIFICATE");
    L.push("========================================");
    L.push("The holder routed three RISC-V trap waves between M-mode and S-mode");
    L.push("with zero misroutes, using real medeleg / mideleg / mtvec semantics:");
    TG_TRIALS.forEach(function (t) {
      L.push("  " + t.name + " ... PASS");
    });
    L.push("");
    L.push("mcause decoding, delegation bits, direct vs vectored mtvec:");
    L.push("all demonstrated live on the bench. No trap went unhandled.");
    L.push("Date: " + new Date().toISOString().slice(0, 10));
    tgDownload(L.join("\n"), "trap-gate-certificate.txt");
    toast("Certificate downloaded.");
  }

  function tgBuildTrialCard(host, t) {
    var st = TG_ST[t.id];
    var card = tgEl("div", "tg-card");
    card.id = "tgCard-" + t.id;
    var h = tgEl("h5", null, t.name);
    card.appendChild(h);
    var pstat = tgEl("span", "tg-pstat", "NOT RUN");
    pstat.id = "tgStat-" + t.id;
    var row = tgEl("div", "row");
    row.appendChild(pstat);
    var open = tgEl("button", "tg-mini go", "OPEN");
    open.type = "button";
    open.addEventListener("click", function () { tgOpenTrial(t.id); });
    row.appendChild(open);
    card.appendChild(row);
    host.appendChild(card);
  }

  var tgActiveTrial = null;

  function tgOpenTrial(id) {
    var t = tgTrialById(id);
    var st = TG_ST[id];
    tgActiveTrial = id;
    var host = tg$("tgTrialHost");
    host.innerHTML = "";

    var brief = tgEl("p", "tg-brief", "");
    brief.innerHTML = "<b>" + tgEsc(t.name.toUpperCase()) + "</b> " + tgEsc(t.brief);
    host.appendChild(brief);

    var sec1 = tgEl("div", "tg-sec", "MTVEC MODE");
    host.appendChild(sec1);
    host.appendChild(tgSeg("mtvec mode for " + t.name, [
      { label: "DIRECT", value: "direct" },
      { label: "VECTORED", value: "vectored" }
    ], st.mode, function (v) { st.mode = v; }));

    var sec2 = tgEl("div", "tg-sec", "ROUTE EACH TRAP (SETS THE DELEGATION BIT)");
    host.appendChild(sec2);
    var rows = tgEl("div", "tg-rows");
    t.traps.forEach(function (key) {
      var trap = tgByKey(key);
      var r = tgEl("div", "tg-row");
      var nm = tgEl("div", "nm", "");
      nm.innerHTML = tgEsc(trap.name) +
        '<span class="tag">CAUSE ' + trap.cause + " <i>" +
        (trap.interrupt ? "INTERRUPT" : "SYNC EXCEPTION") + "</i> VIA " +
        (trap.interrupt ? "mideleg" : "medeleg") + "[" + trap.cause + "]</span>";
      r.appendChild(nm);
      r.appendChild(tgSeg("Route " + trap.name, [
        { label: "M", value: "M" },
        { label: "S", value: "S" }
      ], st.bits[key], (function (k) {
        return function (v) { st.bits[k] = v; };
      })(key)));
      rows.appendChild(r);
    });
    host.appendChild(rows);

    var ctl = tgEl("div", "tg-strikes");
    var run = tgEl("button", "tg-mini go", "RUN THE WAVE");
    run.type = "button";
    var reset = tgEl("button", "tg-mini", "RESET");
    reset.type = "button";
    ctl.appendChild(run); ctl.appendChild(reset);
    var sk = tgEl("span", "tg-strike", "STRIKES 0 / 3");
    sk.id = "tgStrikes-" + t.id;
    ctl.appendChild(sk);
    var at = tgEl("span", "tg-strike", "ATTEMPTS 0");
    at.id = "tgAttempts-" + t.id;
    ctl.appendChild(at);
    host.appendChild(ctl);

    var res = tgEl("div", null, "");
    res.id = "tgRes-" + t.id;
    host.appendChild(res);

    run.addEventListener("click", function () { tgRunTrial(id); });
    reset.addEventListener("click", function () {
      st.strikes = 0; st.attempts = 0; st.passed = false; st.results = null;
      st.mode = t.mode;
      t.traps.forEach(function (k) { st.bits[k] = "M"; });
      tgOpenTrial(id);
      tgPaintCards();
      toast("Trial reset.");
    });
  }

  function tgRunTrial(id) {
    var t = tgTrialById(id);
    var st = TG_ST[id];
    st.attempts++;
    var cfg = tgCfgFromState(t, st);
    var rows = [];
    var strikes = 0;
    var cycles = 0;
    var par = t.traps.length * (t.mode === "vectored" ? 1 : 3);
    if (st.mode !== t.mode) {
      strikes++;
      rows.push({ ok: false, mode: true,
        msg: "mtvec is " + st.mode.toUpperCase() + ", the firmware rule for this wave is " +
             t.mode.toUpperCase() });
    }
    t.traps.forEach(function (key) {
      var trap = tgByKey(key);
      var d = tgDispatch(trap, cfg);
      cycles += d.cycles;
      var want = t.policy[key];
      var ok = d.dest === want;
      if (!ok) strikes++;
      rows.push({ ok: ok, trap: trap, d: d, want: want });
    });
    st.strikes += strikes;
    st.results = { rows: rows, cycles: cycles, par: par };
    var waveOk = strikes === 0 && cycles <= par;
    if (waveOk) st.passed = true;

    var res = tg$("tgRes-" + id);
    res.innerHTML = "";
    rows.forEach(function (r) {
      var p = tgEl("p", "tg-res", "");
      if (r.mode) {
        p.innerHTML = '<span class="no">STRIKE</span> ' + tgEsc(r.msg);
      } else {
        p.innerHTML = (r.ok ? '<span class="ok">ROUTE OK</span>' : '<span class="no">MISROUTE</span>') +
          " <b>" + tgEsc(r.trap.name) + "</b> landed in <b>" + r.d.dest +
          "-mode</b> (" + tgEsc(r.d.csr) + "[" + r.trap.cause + "]=" +
          (r.d.delegated ? "1" : "0") + ", PC " + tgHex(r.d.pc, 8) + ")" +
          (r.ok ? "" : ", the wave required <b>" + r.want + "-mode</b>");
      }
      res.appendChild(p);
    });
    var sum = tgEl("p", "tg-res", "");
    sum.innerHTML = "cycles <b>" + cycles + "</b> / budget " + par +
      (waveOk ? ' <span class="ok">WAVE CLEAN</span>'
              : (st.strikes >= 3 ? ' <span class="no">THREE STRIKES: WAVE FAILED</span>' : ""));
    res.appendChild(sum);

    var dl = tgEl("button", "tg-mini", "DOWNLOAD WAVE REPORT");
    dl.type = "button";
    dl.addEventListener("click", function () {
      tgDownload(tgTrialReport(t, st), "trap-gate-" + id + "-report.txt");
      toast("Wave report downloaded.");
    });
    res.appendChild(dl);

    tg$("tgStrikes-" + id).textContent = "STRIKES " + Math.min(st.strikes, 3) + " / 3";
    tg$("tgStrikes-" + id).classList.toggle("hit", st.strikes > 0);
    tg$("tgAttempts-" + id).textContent = "ATTEMPTS " + st.attempts;
    tgPaintCards();
    tgPaintCert();
  }

  function tgPaintCards() {
    TG_TRIALS.forEach(function (t) {
      var el = tg$("tgStat-" + t.id);
      if (!el) return;
      var st = TG_ST[t.id];
      el.classList.remove("pass", "fail");
      if (st.passed) { el.textContent = "PASS"; el.classList.add("pass"); }
      else if (st.strikes >= 3) { el.textContent = "FAILED"; el.classList.add("fail"); }
      else if (st.attempts > 0) { el.textContent = "IN PROGRESS"; }
      else { el.textContent = "NOT RUN"; }
    });
  }

  function tgPaintCert() {
    var all = TG_TRIALS.every(function (t) { return TG_ST[t.id].passed; });
    var c = tg$("tgCert");
    if (c) c.classList.toggle("show", all);
  }

  function tgBuildTrials(page) {
    var cards = tgEl("div", "tg-cards");
    TG_TRIALS.forEach(function (t) { tgBuildTrialCard(cards, t); });
    page.appendChild(cards);
    var host = tgEl("div", null, "");
    host.id = "tgTrialHost";
    page.appendChild(host);
    var cert = tgEl("div", "tg-cert", "");
    cert.id = "tgCert";
    cert.innerHTML = "<h4>TRAP GATE, QUALIFIED</h4>" +
      "<p>Three waves routed with zero misroutes. The delegation bits obey you.</p>";
    var cb = tgEl("button", "tg-mini go", "DOWNLOAD CERTIFICATE");
    cb.type = "button";
    cb.addEventListener("click", tgDownloadCert);
    cert.appendChild(cb);
    page.appendChild(cert);
    tgOpenTrial("t1");
  }

  /* ---------------- shell ---------------- */

  function tgBuildShell() {
    var css = document.createElement("style");
    css.textContent = TG_CSS.join("\n");
    document.head.appendChild(css);

    var box = document.querySelector(".dossier .actions");
    if (box && !tg$("tgBtn")) {
      var b = tgEl("button", "secondary", "Run the Trap Gate");
      b.id = "tgBtn";
      b.addEventListener("click", function () { tg$("tgOverlay").classList.add("open"); });
      box.appendChild(b);
    }

    var ov = tgEl("div", "tg-overlay");
    ov.id = "tgOverlay";
    var panel = tgEl("div", "tg-panel");
    ov.appendChild(panel);
    document.body.appendChild(ov);

    var bar = tgEl("div", "tg-bar");
    var title = tgEl("div", "tg-title", "");
    title.innerHTML = "THE TRAP <b>GATE</b>";
    var tabs = tgEl("div", "tg-tabs");
    var tExp = tgEl("button", "tg-tab on", "EXPLORE");
    tExp.id = "tgTabExp";
    var tTri = tgEl("button", "tg-tab", "TRIALS");
    tTri.id = "tgTabTri";
    tabs.appendChild(tExp); tabs.appendChild(tTri);
    var close = tgEl("button", "tg-close", "CLOSE [x]");
    bar.appendChild(title); bar.appendChild(tabs); bar.appendChild(close);
    panel.appendChild(bar);

    var body = tgEl("div", "tg-body");
    var sub = tgEl("p", "tg-sub", "");
    sub.innerHTML = "<b>HOW IT WORKS</b> Traps arrive as an mcause value: top bit set means interrupt, " +
      "low bits name the cause. mideleg bit[cause] delegates an interrupt to S-mode, " +
      "medeleg bit[cause] delegates a sync exception, and mtvec chooses DIRECT or VECTORED dispatch. " +
      "Route every wave exactly where the firmware policy demands. " +
      "Built for the <a href=\"https://dillingerstaffing.github.io/portfolio/\" target=\"_blank\" rel=\"noopener\">RISC-V portfolio work</a>.";
    body.appendChild(sub);
    var pageExp = tgEl("div", null, "");
    pageExp.id = "tgPageExp";
    var pageTri = tgEl("div", null, "");
    pageTri.id = "tgPageTri";
    pageTri.style.display = "none";
    body.appendChild(pageExp);
    body.appendChild(pageTri);
    panel.appendChild(body);

    close.addEventListener("click", function () { ov.classList.remove("open"); });
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("open"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("open")) ov.classList.remove("open");
    });
    tExp.addEventListener("click", function () {
      tExp.classList.add("on"); tTri.classList.remove("on");
      pageExp.style.display = ""; pageTri.style.display = "none";
    });
    tTri.addEventListener("click", function () {
      tTri.classList.add("on"); tExp.classList.remove("on");
      pageTri.style.display = ""; pageExp.style.display = "none";
    });

    tgBuildExplore(pageExp);
    tgBuildTrials(pageTri);
  }

  function tgInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    tgBuildShell();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", tgInit);
    } else {
      tgInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      TG: {
        dispatch: tgDispatch, trials: TG_TRIALS, causes: TG_CAUSES,
        byKey: tgByKey, hex: tgHex
      }
    });
  }

})();
/* ================= THE LINK LAB (BENCH 11) =================
   PCIe link training qualification for GPU bring-up. A real SerDes
   channel model lives under the hood: per-lane insertion loss,
   crosstalk aggressors, hard lane opens, speed-dependent loss
   budgets, and nine EQ presets that buy back dB. Three cards go
   on the bench. Train each link, read the per-lane BER against
   the 1e-12 budget, and certify only the link you can honestly
   sign. Built for the TAPEOUT bring-up bench. */

(function () {
  "use strict";

  /* ---------------- pure core: no DOM ---------------- */

  function llMulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var LL_SPEEDS = [
    { key: "g3", name: "Gen3", gt: 8,  budget: 14 },
    { key: "g4", name: "Gen4", gt: 16, budget: 11 },
    { key: "g5", name: "Gen5", gt: 32, budget: 8 }
  ];

  var LL_PRESETS = [
    { name: "P0", pre: 0,    de: 0    },
    { name: "P1", pre: 0,    de: -1   },
    { name: "P2", pre: 0,    de: -2.5 },
    { name: "P3", pre: 0,    de: -3.5 },
    { name: "P4", pre: 0,    de: -4.5 },
    { name: "P5", pre: 0,    de: -6   },
    { name: "P6", pre: -1.5, de: -3.5 },
    { name: "P7", pre: -1.5, de: -4.5 },
    { name: "P8", pre: -2,   de: -6   }
  ];

  function llEqGain(pi) {
    var p = LL_PRESETS[pi];
    var g = (-p.de) * 0.9 + (-p.pre) * 0.6;
    return g > 6 ? 6 : g;
  }

  function llMakeLanes(def) {
    var rng = llMulberry32(def.seed);
    var lanes = [];
    for (var i = 0; i < 16; i++) {
      var loss = def.base + rng() * def.jit;
      var hot = def.hot.indexOf(i) !== -1;
      if (hot) loss += 2.5;
      lanes.push({ idx: i, loss: loss, fault: def.faults.indexOf(i) !== -1, hot: hot });
    }
    return lanes;
  }

  /* Per-lane result: margin in dB against the 1e-12 BER budget. */
  function llLaneResult(lane, xtalk, speed, pi) {
    if (lane.fault) return { idx: lane.idx, margin: -99, pass: false, fault: true, berExp: 0 };
    var xt = (xtalk > 0 && (lane.idx % 2 === 1) && speed.gt >= 16) ? xtalk : 0;
    var margin = Math.round((llEqGain(pi) + speed.budget - lane.loss - xt) * 100) / 100;
    var pass = margin >= 0;
    var berExp = -(12 + Math.floor(margin));
    return { idx: lane.idx, margin: margin, pass: pass, fault: false, berExp: berExp };
  }

  function llTrainCard(trial, width, speedIdx, presetIdx) {
    var lanes = llMakeLanes(trial);
    var speed = LL_SPEEDS[speedIdx];
    var out = [];
    for (var i = 0; i < width; i++) out.push(llLaneResult(lanes[i], trial.xtalk, speed, presetIdx));
    return out;
  }

  function llCertify(results) {
    for (var i = 0; i < results.length; i++) if (!results[i].pass) return false;
    return results.length > 0;
  }

  function llScore(width, gt) { return width * gt; }

  var LL_TRIALS = [
    { id: "c1", name: "Trial 1: Golden Sample", seed: 1101, base: 4.0, jit: 1.4,
      faults: [], hot: [], xtalk: 0, par: 512,
      brief: "Reference card on short traces. Clean lanes train at full rate. Bring this one home at x16 Gen5." },
    { id: "c2", name: "Trial 2: The Marginal Lot", seed: 2202, base: 8.6, jit: 1.4,
      faults: [14], hot: [5, 10], xtalk: 0, par: 256,
      brief: "One lane is a hard open and two run hot. Find the widest link you can honestly sign. Signing a dead lane is a field flap." },
    { id: "c3", name: "Trial 3: Riser Rescue", seed: 3303, base: 13.6, jit: 1.6,
      faults: [], hot: [], xtalk: 2.6, par: 128,
      brief: "A long ribbon riser loads every lane with loss, and aggressor lanes bite at Gen4 and up. Slow the link before you blame the card." }
  ];

  var LL_WIDTHS = [16, 8, 4];

  /* ---------------- CSS ---------------- */

  var LL_CSS = [
    ".ll-overlay{position:fixed;inset:0;z-index:9995;background:rgba(5,8,10,.94);display:none;}",
    ".ll-overlay.open{display:flex;}",
    ".ll-panel{flex:1;min-height:0;width:100%;max-width:900px;margin:0 auto;display:flex;flex-direction:column;background:#0a0c0e;border:1px solid var(--line);overflow:hidden;}",
    "@media(min-width:700px){.ll-panel{border-radius:4px;}}",
    ".ll-bar{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);flex:none;flex-wrap:wrap;background:var(--panel);}",
    ".ll-title{font-family:var(--font-d);font-size:13px;font-weight:700;letter-spacing:.14em;color:var(--paper);white-space:nowrap;}",
    ".ll-title b{color:var(--ember);}",
    ".ll-close{font-family:var(--font-m);font-size:12px;font-weight:700;letter-spacing:.08em;min-height:48px;min-width:48px;padding:12px 18px;border-radius:4px;border:1px solid var(--ember);background:var(--ember);color:#0a0c0e;cursor:pointer;margin-left:auto;}",
    ".ll-close:active{transform:scale(.96);}",
    ".ll-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;}",
    ".ll-sub{font-family:var(--font-m);font-size:11px;color:var(--steel);letter-spacing:.04em;line-height:1.8;margin:0 0 12px;}",
    ".ll-sub b{color:var(--paper);font-weight:600;letter-spacing:.08em;font-size:10px;}",
    ".ll-sub a{color:var(--ice);}",
    ".ll-cards{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:12px;}",
    "@media(min-width:700px){.ll-cards{grid-template-columns:repeat(3,1fr);}}",
    ".ll-card{border:1px solid var(--line);border-radius:4px;padding:14px;background:var(--panel);}",
    ".ll-card h5{margin:0 0 6px;font-family:var(--font-d);font-size:14px;color:var(--paper);}",
    ".ll-card p{margin:0 0 10px;font-size:12px;color:var(--steel);line-height:1.6;}",
    ".ll-card .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
    ".ll-pstat{font-family:var(--font-m);font-size:10px;font-weight:700;letter-spacing:.12em;padding:6px 12px;border-radius:2px;border:1px solid var(--line);color:var(--steel);}",
    ".ll-pstat.pass{color:var(--mint);border-color:rgba(125,224,168,.5);}",
    ".ll-pstat.fail{color:var(--bad);border-color:rgba(255,122,122,.5);}",
    ".ll-mini{font-family:var(--font-m);font-size:11px;font-weight:700;letter-spacing:.06em;min-height:48px;padding:12px 16px;border-radius:4px;border:1px solid rgba(242,237,227,.2);background:var(--panel-2);color:var(--paper);cursor:pointer;}",
    ".ll-mini:active{transform:scale(.96);}",
    ".ll-mini.go{background:var(--ember);border-color:var(--ember);color:#0a0c0e;}",
    ".ll-work{border:1px solid var(--line);border-radius:4px;background:var(--panel);padding:14px;margin-bottom:12px;}",
    ".ll-work h4{margin:0 0 4px;font-family:var(--font-d);font-size:15px;color:var(--paper);}",
    ".ll-brief{font-size:12px;color:var(--steel);line-height:1.7;margin:0 0 4px;max-width:70ch;}",
    ".ll-sec{font-family:var(--font-m);font-size:10px;font-weight:700;letter-spacing:.14em;color:var(--dim);margin:14px 0 8px;}",
    ".ll-seg{display:inline-flex;border:1px solid var(--line);border-radius:4px;overflow:hidden;}",
    ".ll-seg button{font-family:var(--font-m);font-size:11px;font-weight:700;letter-spacing:.08em;min-height:48px;min-width:88px;padding:12px 18px;background:var(--panel-2);color:var(--steel);border:none;cursor:pointer;}",
    ".ll-seg button + button{border-left:1px solid var(--line);}",
    ".ll-seg button.on{background:var(--ember);color:#0a0c0e;}",
    ".ll-seg button:active{transform:scale(.96);}",
    ".ll-select{font-family:var(--font-m);font-size:12px;min-height:48px;padding:12px;background:var(--panel-2);color:var(--paper);border:1px solid var(--line);border-radius:4px;max-width:100%;}",
    ".ll-ctlrow{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;}",
    ".ll-go{font-family:var(--font-d);font-size:12px;font-weight:700;letter-spacing:.08em;min-height:48px;padding:12px 20px;border-radius:4px;border:1px solid var(--ember);background:var(--ember);color:#0a0c0e;cursor:pointer;}",
    ".ll-go:disabled{opacity:.35;cursor:default;}",
    ".ll-go:active:not(:disabled){transform:scale(.96);}",
    ".ll-go.ghost{background:none;color:var(--ember);}",
    ".ll-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:10px 0;}",
    "@media(min-width:700px){.ll-grid{grid-template-columns:repeat(8,minmax(0,1fr));}}",
    ".ll-lane{border:1px solid var(--line);border-radius:3px;padding:8px 6px;background:var(--ink);text-align:center;min-width:0;}",
    ".ll-lane .ln{display:block;font-family:var(--font-m);font-size:10px;font-weight:700;color:var(--dim);letter-spacing:.08em;}",
    ".ll-lane .st{display:block;font-family:var(--font-m);font-size:9px;font-weight:700;letter-spacing:.06em;margin-top:4px;color:var(--steel);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".ll-lane .ber{display:block;font-family:var(--font-m);font-size:9px;color:var(--dim);margin-top:2px;}",
    ".ll-lane.off{opacity:.35;}",
    ".ll-lane.off .st{color:var(--dim);}",
    ".ll-lane.busy{border-color:var(--ice);}",
    ".ll-lane.busy .st{color:var(--ice);}",
    ".ll-lane.ok{border-color:rgba(125,224,168,.55);}",
    ".ll-lane.ok .st{color:var(--mint);}",
    ".ll-lane.bad{border-color:rgba(255,122,122,.6);}",
    ".ll-lane.bad .st{color:var(--bad);}",
    ".ll-trace{list-style:none;margin:10px 0 0;padding:0;font-family:var(--font-m);font-size:11px;line-height:1.9;color:var(--steel);}",
    ".ll-trace li{border-left:2px solid var(--ember);padding-left:10px;margin-bottom:6px;}",
    ".ll-trace li b{color:var(--paper);}",
    ".ll-trace .ok{color:var(--mint);font-weight:700;}",
    ".ll-trace .no{color:var(--bad);font-weight:700;}",
    ".ll-sum{font-family:var(--font-m);font-size:11px;color:var(--steel);line-height:1.8;margin:8px 0 0;}",
    ".ll-sum b{color:var(--paper);}",
    ".ll-cert{display:none;border:1px solid rgba(125,224,168,.5);border-radius:4px;padding:16px;background:rgba(125,224,168,.05);margin-top:14px;}",
    ".ll-cert.show{display:block;}",
    ".ll-cert h4{margin:0 0 6px;font-family:var(--font-d);color:var(--ember);letter-spacing:.1em;font-size:15px;}",
    ".ll-cert p{margin:0 0 12px;font-size:12px;color:var(--steel);line-height:1.7;}",
    "button:focus-visible,.ll-select:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
    "@media (prefers-reduced-motion:reduce){.ll-panel *{transition:none !important;}}"
  ];

  /* ---------------- DOM helpers ---------------- */

  function ll$(id) { return document.getElementById(id); }
  function llEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function llReduced() {
    return typeof window !== "undefined" && window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* ---------------- state ---------------- */

  var LL_ST = {};
  LL_TRIALS.forEach(function (t) {
    LL_ST[t.id] = { width: 16, speed: 2, preset: 0, results: null, trained: false,
                    passed: false, strikes: 0, attempts: 0, training: false, score: 0 };
  });
  var LL_ACTIVE = "c1";

  function llTrial(id) {
    for (var i = 0; i < LL_TRIALS.length; i++) if (LL_TRIALS[i].id === id) return LL_TRIALS[i];
    return LL_TRIALS[0];
  }

  function llDownload(text, name) {
    var blob = new Blob([text], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      (window.URL || window.webkitURL).revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function llBerText(r) {
    if (r.fault) return "no link";
    return "1e" + r.berExp;
  }

  /* ---------------- trial cards and workspace ---------------- */

  function llRenderCards(host) {
    host.innerHTML = "";
    LL_TRIALS.forEach(function (t) {
      var st = LL_ST[t.id];
      var card = llEl("div", "ll-card");
      card.appendChild(llEl("h5", null, t.name));
      card.appendChild(llEl("p", null, t.brief));
      var row = llEl("div", "row");
      var pill = llEl("span", "ll-pstat" + (st.passed ? " pass" : (st.strikes > 0 ? " fail" : "")), "");
      pill.id = "llStat-" + t.id;
      pill.textContent = st.passed ? "LINK CERTIFIED" : (st.strikes > 0 ? "FIELD FLAP" : "NOT RUN");
      row.appendChild(pill);
      var open = llEl("button", "ll-mini go", "OPEN");
      open.type = "button";
      open.setAttribute("aria-label", "Open " + t.name);
      (function (id) {
        open.addEventListener("click", function () { llOpenTrial(id); });
      })(t.id);
      row.appendChild(open);
      card.appendChild(row);
      host.appendChild(card);
    });
  }

  function llSeg(host, options, current, onPick, aria) {
    var seg = llEl("div", "ll-seg");
    seg.setAttribute("role", "group");
    if (aria) seg.setAttribute("aria-label", aria);
    options.forEach(function (opt, i) {
      var b = llEl("button", null, opt);
      b.type = "button";
      if (i === current) b.classList.add("on");
      (function (idx) {
        b.addEventListener("click", function () { onPick(idx); });
      })(i);
      seg.appendChild(b);
    });
    host.appendChild(seg);
  }

  function llOpenTrial(id) {
    LL_ACTIVE = id;
    var t = llTrial(id), st = LL_ST[id];
    var work = ll$("llWork");
    work.innerHTML = "";
    work.appendChild(llEl("h4", null, t.name));
    work.appendChild(llEl("p", "ll-brief", t.brief));

    work.appendChild(llEl("div", "ll-sec", "LINK WIDTH"));
    llSeg(work, ["x16", "x8", "x4"], LL_WIDTHS.indexOf(st.width), function (i) {
      st.width = LL_WIDTHS[i]; llRevokeIfPassed(id); st.trained = false; st.results = null; llOpenTrial(id);
    }, "Link width");

    work.appendChild(llEl("div", "ll-sec", "LINK SPEED"));
    llSeg(work, LL_SPEEDS.map(function (s) { return s.name; }), st.speed, function (i) {
      st.speed = i; llRevokeIfPassed(id); st.trained = false; st.results = null; llOpenTrial(id);
    }, "Link speed");

    work.appendChild(llEl("div", "ll-sec", "TX EQUALIZATION PRESET"));
    var sel = llEl("select", "ll-select");
    sel.id = "llPreset-" + id;
    sel.setAttribute("aria-label", "TX equalization preset");
    LL_PRESETS.forEach(function (p, i) {
      var o = llEl("option", null, p.name + ": " + p.pre + " dB preshoot, " + p.de + " dB de-emphasis");
      o.value = String(i);
      if (i === st.preset) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      st.preset = parseInt(sel.value, 10); llRevokeIfPassed(id); st.trained = false; st.results = null; llOpenTrial(id);
    });
    work.appendChild(sel);

    var row = llEl("div", "ll-ctlrow");
    var run = llEl("button", "ll-go", "RUN TRAINING");
    run.id = "llRun-" + id;
    run.type = "button";
    if (st.training) run.disabled = true;
    run.addEventListener("click", function () { llRunTraining(id); });
    row.appendChild(run);
    var cert = llEl("button", "ll-go ghost", "CERTIFY LINK");
    cert.id = "llCert-" + id;
    cert.type = "button";
    cert.disabled = !st.trained || st.passed;
    cert.addEventListener("click", function () { llCertifyTrial(id); });
    row.appendChild(cert);
    work.appendChild(row);

    var grid = llEl("div", "ll-grid");
    grid.id = "llGrid-" + id;
    grid.setAttribute("role", "list");
    grid.setAttribute("aria-label", "Lane training status");
    for (var i = 0; i < 16; i++) {
      var cell = llEl("div", "ll-lane" + (i < st.width ? "" : " off"));
      cell.id = "llLane-" + id + "-" + i;
      cell.setAttribute("role", "listitem");
      cell.appendChild(llEl("span", "ln", "L" + (i < 10 ? "0" + i : i)));
      var stx = llEl("span", "st", i < st.width ? "IDLE" : "OFF");
      stx.id = "llLaneSt-" + id + "-" + i;
      cell.appendChild(stx);
      var ber = llEl("span", "ber", "");
      ber.id = "llLaneBer-" + id + "-" + i;
      cell.appendChild(ber);
      grid.appendChild(cell);
    }
    work.appendChild(grid);

    var sum = llEl("p", "ll-sum", "");
    sum.id = "llSum-" + id;
    work.appendChild(sum);

    var trace = llEl("ul", "ll-trace");
    trace.id = "llTrace-" + id;
    work.appendChild(trace);

    if (st.trained && st.results) llRenderResults(id);
  }

  function llSetLane(id, i, cls, status, ber) {
    var cell = ll$("llLane-" + id + "-" + i);
    if (!cell) return;
    cell.className = "ll-lane" + (cls ? " " + cls : "");
    var stx = ll$("llLaneSt-" + id + "-" + i);
    if (stx) stx.textContent = status;
    var b = ll$("llLaneBer-" + id + "-" + i);
    if (b) b.textContent = ber || "";
  }

  /* ---------------- training run ---------------- */

  function llTrace(id, html) {
    var ul = ll$("llTrace-" + id);
    if (!ul) return;
    var li = llEl("li", null, "");
    li.innerHTML = html;
    ul.appendChild(li);
  }

  function llRunTraining(id) {
    var t = llTrial(id), st = LL_ST[id];
    if (st.training) return;
    /* Retraining a signed trial revokes the signature: the new link is a
       different link. The old behavior (silent no-op) stranded users who
       certified below par with no way to improve. */
    var wasPassed = st.passed;
    if (wasPassed) {
      st.passed = false; st.score = 0;
      var cbx = ll$("llCertBox");
      if (cbx) cbx.classList.remove("show");
      llRenderCards(ll$("llCards"));
    }
    st.training = true;
    st.attempts += 1;
    var speed = LL_SPEEDS[st.speed], preset = LL_PRESETS[st.preset];
    var trace = ll$("llTrace-" + id);
    if (trace) trace.innerHTML = "";
    var sum = ll$("llSum-" + id);
    if (sum) sum.innerHTML = "";
    var certBtn = ll$("llCert-" + id);
    if (certBtn) certBtn.disabled = true;

    llTrace(id, "<b>Training start:</b> x" + st.width + " " + speed.name + " (" + speed.gt +
      " GT/s), EQ " + preset.name + " (" + preset.pre + " dB preshoot, " + preset.de + " dB de-emphasis).");
    if (wasPassed) {
      llTrace(id, "<b>Certification revoked:</b> retraining voids the earlier signature. " +
        "Certify again once the new link trains clean.");
    }

    var phases = ["DETECT", "POLLING", "CONFIG"];
    var reduced = llReduced();
    var step = reduced ? 0 : 70;

    function phaseTick(ph, done) {
      var i = 0;
      function next() {
        if (i >= st.width) { done(); return; }
        llSetLane(id, i, "busy", phases[ph], "");
        i++;
        if (step) setTimeout(next, step); else next();
      }
      next();
    }

    function finalize() {
      st.results = llTrainCard(t, st.width, st.speed, st.preset);
      st.trained = true;
      st.training = false;
      llRenderResults(id);
      var run = ll$("llRun-" + id);
      if (run) run.disabled = false;
    }

    if (reduced) {
      finalize();
      return;
    }
    phaseTick(0, function () {
      llTrace(id, "<b>DETECT:</b> receiver detect on all " + st.width + " lanes.");
      phaseTick(1, function () {
        llTrace(id, "<b>POLLING:</b> bit lock and symbol lock across the link.");
        phaseTick(2, function () {
          llTrace(id, "<b>CONFIG:</b> EQ negotiation complete, entering L0.");
          finalize();
        });
      });
    });
  }

  function llRenderResults(id) {
    var t = llTrial(id), st = LL_ST[id];
    if (!st.results) return;
    var pass = 0, worstExp = -99, worstLane = -1, minMargin = 99, worstM = -1;
    st.results.forEach(function (r) {
      if (r.pass) pass++;
      if (!r.fault && r.berExp > worstExp) { worstExp = r.berExp; worstLane = r.idx; }
      if (r.margin < minMargin) { minMargin = r.margin; worstM = r.idx; }
    });
    st.results.forEach(function (r) {
      var label = "L" + (r.idx < 10 ? "0" + r.idx : r.idx);
      llSetLane(id, r.idx, r.pass ? "ok" : "bad", r.fault ? "NO LINK" : (r.pass ? "L0 PASS" : "LANE FAIL"),
        r.fault ? "open" : llBerText(r));
    });
    var speed = LL_SPEEDS[st.speed];
    var sum = ll$("llSum-" + id);
    if (sum) {
      sum.innerHTML = "Result: <b>" + pass + "/" + st.results.length + " lanes in L0</b>. " +
        "Worst BER <b>1e" + worstExp + "</b> on L" + (worstLane < 10 ? "0" + worstLane : worstLane) +
        " (budget 1e-12). Min margin <b>" + minMargin.toFixed(1) + " dB</b> on L" +
        (worstM < 10 ? "0" + worstM : worstM) + ".";
    }
    var allOk = llCertify(st.results);
    llTrace(id, allOk
      ? "<b>L0:</b> <span class=\"ok\">" + pass + "/" + st.results.length + " lanes up.</span> Link is certifiable at x" + st.width + " " + speed.name + "."
      : "<b>L0:</b> <span class=\"no\">" + (st.results.length - pass) + " lane(s) failed.</span> Certifying this link would be a field flap. Retune width, speed, or EQ and retrain.");
    var certBtn = ll$("llCert-" + id);
    if (certBtn) certBtn.disabled = st.passed;
  }

  function llCertifyTrial(id) {
    var t = llTrial(id), st = LL_ST[id];
    if (!st.trained || st.passed || !st.results) return;
    var speed = LL_SPEEDS[st.speed];
    if (llCertify(st.results)) {
      st.passed = true;
      st.score = llScore(st.width, speed.gt);
      var preset = LL_PRESETS[st.preset];
      llTrace(id, "<b>Certified:</b> x" + st.width + " " + speed.name + ", EQ " + preset.name +
        ". Link score <b>" + st.score + "</b> (par " + t.par + ").");
      toast("Link certified: " + t.name + " at x" + st.width + " " + speed.name + ".");
      var cbtn = ll$("llCert-" + id);
      if (cbtn) cbtn.disabled = true;
    } else {
      st.strikes += 1;
      st.trained = false;
      st.results = null;
      llTrace(id, "<b class=\"no\">Certification rejected.</b> A failing lane was signed, the card flapped in the field. Strike " +
        st.strikes + ". The trial resets: retrain with an honest link.");
      toast("Certification rejected: field flap. Strike " + st.strikes + ".");
      llOpenTrial(id);
    }
    llRenderCards(ll$("llCards"));
    var done = LL_TRIALS.every(function (x) { return LL_ST[x.id].passed; });
    if (done) llShowCert();
  }

  /* A signed trial whose knobs change no longer describes the link on the
     bench, so the signature is voided instead of going stale. */
  function llRevokeIfPassed(id) {
    var st = LL_ST[id];
    if (!st.passed) return;
    st.passed = false; st.score = 0;
    var cb = ll$("llCertBox");
    if (cb) cb.classList.remove("show");
    llRenderCards(ll$("llCards"));
    toast("Certification revoked: the link changed on " + llTrial(id).name + ".");
  }

  /* ---------------- certificate ---------------- */

  function llTotalScore() {
    var s = 0, par = 0;
    LL_TRIALS.forEach(function (t) { s += LL_ST[t.id].score; par += t.par; });
    return { score: s, par: par };
  }

  function llCertText() {
    var tot = llTotalScore();
    var L = [];
    L.push("THE LINK LAB: LINK QUALIFICATION CERTIFICATE");
    L.push("=============================================");
    L.push("The holder trained and certified three PCIe links on real");
    L.push("SerDes channel models (insertion loss, crosstalk, lane opens,");
    L.push("EQ presets) against the 1e-12 BER budget:");
    LL_TRIALS.forEach(function (t) {
      var st = LL_ST[t.id];
      var speed = LL_SPEEDS[st.speed], preset = LL_PRESETS[st.preset];
      L.push("  " + t.name + ": x" + st.width + " " + speed.name + ", EQ " + preset.name +
        " ... PASS (score " + st.score + ", par " + t.par + ", attempts " + st.attempts +
        ", strikes " + st.strikes + ")");
    });
    L.push("");
    L.push("Total link score " + tot.score + " of par " + tot.par + ".");
    L.push("No dead lane was signed. Every certified lane holds 1e-12 BER.");
    L.push("Qualified for the TAPEOUT GPU bring-up bench.");
    L.push("Date: " + new Date().toISOString().slice(0, 10));
    return L.join("\n");
  }

  function llShowCert() {
    var box = ll$("llCertBox");
    if (!box) return;
    var tot = llTotalScore();
    box.innerHTML = "";
    box.appendChild(llEl("h4", null, "QUALIFICATION COMPLETE"));
    var p = llEl("p", null, "");
    p.textContent = "All three cards certified against the 1e-12 BER budget. Total link score " +
      tot.score + " of par " + tot.par + ". The bring-up bench accepts these cards.";
    box.appendChild(p);
    var dl = llEl("button", "ll-mini go", "DOWNLOAD CERTIFICATE");
    dl.type = "button";
    dl.addEventListener("click", function () {
      llDownload(llCertText(), "link-lab-certificate.txt");
      toast("Certificate downloaded.");
    });
    box.appendChild(dl);
    box.classList.add("show");
  }

  /* ---------------- shell ---------------- */

  function llBuildShell() {
    var css = document.createElement("style");
    css.textContent = LL_CSS.join("\n");
    document.head.appendChild(css);

    var box = document.querySelector(".dossier .actions");
    if (box && !ll$("llBtn")) {
      var b = llEl("button", "secondary", "Run the Link Lab");
      b.id = "llBtn";
      b.addEventListener("click", function () { ll$("llOverlay").classList.add("open"); });
      box.appendChild(b);
    }

    var ov = llEl("div", "ll-overlay");
    ov.id = "llOverlay";
    var panel = llEl("div", "ll-panel");
    ov.appendChild(panel);
    document.body.appendChild(ov);

    var bar = llEl("div", "ll-bar");
    var title = llEl("div", "ll-title", "");
    title.innerHTML = "THE LINK <b>LAB</b>";
    var close = llEl("button", "ll-close", "CLOSE [x]");
    bar.appendChild(title); bar.appendChild(close);
    panel.appendChild(bar);

    var body = llEl("div", "ll-body");
    var sub = llEl("p", "ll-sub", "");
    sub.innerHTML = "<b>HOW IT WORKS</b> Every lane hides an insertion-loss number. " +
      "Link speed sets the loss you can afford (Gen3 is forgiving, Gen5 is not), " +
      "crosstalk aggressors bite at Gen4 and up, and TX EQ presets buy back dB. " +
      "Train the link, read each lane's BER against the 1e-12 budget, then certify " +
      "only the link you can honestly sign. " +
      "Built for the <a href=\"https://dillingerstaffing.github.io/tapeout/\" target=\"_blank\" rel=\"noopener\">TAPEOUT bring-up bench</a>.";
    body.appendChild(sub);

    var cards = llEl("div", "ll-cards");
    cards.id = "llCards";
    body.appendChild(cards);
    llRenderCards(cards);

    var work = llEl("div", "ll-work");
    work.id = "llWork";
    body.appendChild(work);

    var certBox = llEl("div", "ll-cert");
    certBox.id = "llCertBox";
    body.appendChild(certBox);

    panel.appendChild(body);

    close.addEventListener("click", function () { ov.classList.remove("open"); });
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("open"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("open")) ov.classList.remove("open");
    });

    llOpenTrial("c1");
  }

  function llInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    llBuildShell();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", llInit);
    } else {
      llInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      LL: {
        mulberry32: llMulberry32, makeLanes: llMakeLanes, laneResult: llLaneResult,
        train: llTrainCard, certify: llCertify, score: llScore, eqGain: llEqGain,
        TRIALS: LL_TRIALS, SPEEDS: LL_SPEEDS, PRESETS: LL_PRESETS, WIDTHS: LL_WIDTHS
      }
    });
  }

})();

(function () {
  "use strict";
/* The Scheduler Bay: pure scheduler core (no DOM). Node-testable. */
function scbMulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Trial process sets. bursts: cpu/io alternating, starts AND ends with cpu. */
var SCB_TRIALS = [
  {
    id: "t1", name: "COMPILE FARM", seed: 1101,
    blurb: "Six CPU-bound compile jobs land at staggered times. No IO to hide behind.",
    base: { policy: "rr", quantum: 20 }, par: 2.0,
    procs: [
      { name: "cc1", cls: "batch", arrival: 0,  bursts: [120] },
      { name: "cc2", cls: "batch", arrival: 5,  bursts: [90] },
      { name: "ld1", cls: "batch", arrival: 10, bursts: [150] },
      { name: "cc3", cls: "batch", arrival: 15, bursts: [80] },
      { name: "as1", cls: "batch", arrival: 20, bursts: [110] },
      { name: "ld2", cls: "batch", arrival: 25, bursts: [95] }
    ]
  },
  {
    id: "t2", name: "SHELL VS COMPILE", seed: 2202,
    blurb: "Two interactive shells share the box with four long compiles. Keep the shells snappy.",
    base: { policy: "rr", quantum: 20 }, par: 9.0,
    procs: [
      { name: "sh1", cls: "inter", arrival: 0,  bursts: [8, 40, 8, 40, 8, 40, 8] },
      { name: "sh2", cls: "inter", arrival: 12, bursts: [6, 35, 6, 35, 6, 35, 6] },
      { name: "cc1", cls: "batch", arrival: 0,  bursts: [160] },
      { name: "cc2", cls: "batch", arrival: 8,  bursts: [130] },
      { name: "ld1", cls: "batch", arrival: 18, bursts: [150] },
      { name: "cc3", cls: "batch", arrival: 28, bursts: [120] }
    ]
  },
  {
    id: "t3", name: "IO STORM", seed: 3303,
    blurb: "Eight IO-bound daemons hammer short bursts. Keep the CPU fed, never idle with work waiting.",
    base: { policy: "rr", quantum: 20 }, par: -1.5,
    procs: [
      { name: "d1", cls: "inter", arrival: 0,  bursts: [6, 30, 6, 30, 6, 30, 6, 30, 6] },
      { name: "d2", cls: "inter", arrival: 6,  bursts: [5, 26, 5, 26, 5, 26, 5, 26, 5] },
      { name: "d3", cls: "inter", arrival: 12, bursts: [7, 32, 7, 32, 7, 32, 7, 32, 7] },
      { name: "d4", cls: "inter", arrival: 18, bursts: [6, 28, 6, 28, 6, 28, 6, 28, 6] },
      { name: "d5", cls: "inter", arrival: 24, bursts: [5, 30, 5, 30, 5, 30, 5, 30, 5] },
      { name: "d6", cls: "inter", arrival: 30, bursts: [7, 26, 7, 26, 7, 26, 7, 26, 7] },
      { name: "d7", cls: "inter", arrival: 36, bursts: [6, 34, 6, 34, 6, 34, 6, 34, 6] },
      { name: "d8", cls: "inter", arrival: 42, bursts: [5, 28, 5, 28, 5, 28, 5, 28, 5] }
    ]
  }
];

/* Run one schedule. cfg: {policy, quantum, queues, boost, interW}.
   Returns { metrics, timeline } where timeline[t] = proc index or -1. */
function scbRun(trial, cfg) {
  var rng = scbMulberry32(trial.seed ^ 0x5bd1e995);
  var n = trial.procs.length;
  var P = trial.procs.map(function (d, i) {
    var cpu = 0, io = 0;
    for (var k = 0; k < d.bursts.length; k += 2) cpu += d.bursts[k];
    for (var j = 1; j < d.bursts.length; j += 2) io += d.bursts[j];
    return {
      idx: i, name: d.name, cls: d.cls, arrival: d.arrival,
      bursts: d.bursts.slice(), cpu: cpu, io: io,
      bi: 0, rem: d.bursts[0], unblockAt: -1,
      queue: 0, qRem: 0, arrived: false, done: false,
      waitAcc: 0, firstRun: -1, completion: -1,
      tickets: d.cls === "inter" ? cfg.interW : 1
    };
  });
  var quantum = Math.max(1, cfg.quantum | 0);
  var queues = cfg.policy === "mlfq" ? Math.min(4, Math.max(2, cfg.queues | 0)) : 1;
  var boost = Math.max(20, cfg.boost | 0);
  var mlfqQ = [];
  for (var q = 0; q < queues; q++) mlfqQ.push([]);
  var ready = []; /* rr + lotto pool */
  var running = -1;
  var sliceRem = 0;
  var timeline = [];
  var maxTicks = 8000;
  var t = 0, doneCount = 0;

  function admit() {
    for (var i = 0; i < n; i++) {
      var p = P[i];
      if (!p.arrived && !p.done && p.arrival <= t) {
        p.arrived = true;
        if (cfg.policy === "mlfq") { p.queue = 0; p.qRem = quantum; mlfqQ[0].push(i); }
        else ready.push(i);
      }
    }
  }
  function unblock() {
    for (var i = 0; i < n; i++) {
      var p = P[i];
      if (p.arrived && !p.done && p.unblockAt === t) {
        p.unblockAt = -1;
        if (cfg.policy === "mlfq") { p.queue = 0; p.qRem = quantum; mlfqQ[0].push(i); }
        else ready.push(i);
      }
    }
  }
  function mlfqQuantum(level) { return quantum * (1 << level); }
  function pick() {
    if (cfg.policy === "mlfq") {
      for (var l = 0; l < queues; l++) {
        if (mlfqQ[l].length) {
          var pi = mlfqQ[l].shift();
          P[pi].qRem = mlfqQuantum(l);
          return pi;
        }
      }
      return -1;
    }
    if (cfg.policy === "lotto") {
      var tot = 0, k;
      for (k = 0; k < ready.length; k++) tot += P[ready[k]].tickets;
      if (!tot) return -1;
      var draw = rng() * tot, acc = 0;
      for (k = 0; k < ready.length; k++) {
        acc += P[ready[k]].tickets;
        if (draw < acc) { var w = ready.splice(k, 1)[0]; sliceRem = quantum; return w; }
      }
      var last = ready.pop(); sliceRem = quantum; return last;
    }
    /* rr */
    if (!ready.length) return -1;
    var r = ready.shift();
    P[r].qRem = quantum;
    return r;
  }
  function preempt(pi, expired) {
    var p = P[pi];
    if (cfg.policy === "mlfq") {
      var nl = Math.min(queues - 1, p.queue + (expired ? 1 : 0));
      p.queue = nl; p.qRem = mlfqQuantum(nl);
      mlfqQ[nl].push(pi);
    } else if (cfg.policy === "rr") {
      p.qRem = quantum; ready.push(pi);
    } else {
      ready.push(pi);
    }
  }
  function boostAll() {
    var all = [];
    for (var l = 0; l < queues; l++) { all = all.concat(mlfqQ[l]); mlfqQ[l] = []; }
    if (running !== -1) { all.push(running); running = -1; }
    for (var i = 0; i < all.length; i++) { P[all[i]].queue = 0; mlfqQ[0].push(all[i]); }
  }

  while (doneCount < n && t < maxTicks) {
    admit();
    unblock();
    if (cfg.policy === "mlfq" && t > 0 && t % boost === 0) boostAll();
    if (running === -1) running = pick();
    if (running !== -1) {
      var p = P[running];
      if (p.firstRun === -1) p.firstRun = t;
      p.rem--; p.qRem--;
      if (cfg.policy === "lotto") sliceRem--;
      timeline[t] = running;
      /* waiting accrues for everyone ready but not running */
      var k, x;
      if (cfg.policy === "mlfq") {
        for (var l = 0; l < queues; l++) for (k = 0; k < mlfqQ[l].length; k++) P[mlfqQ[l][k]].waitAcc++;
      } else {
        for (k = 0; k < ready.length; k++) P[ready[k]].waitAcc++;
      }
      var burstDone = p.rem === 0;
      var quantUp = cfg.policy === "lotto" ? sliceRem <= 0 : p.qRem <= 0;
      if (burstDone) {
        p.bi++;
        if (p.bi >= p.bursts.length) {
          p.done = true; p.completion = t + 1; doneCount++; running = -1;
        } else {
          p.unblockAt = t + 1 + p.bursts[p.bi]; /* io burst, wake at its end */
          p.bi++; p.rem = p.bursts[p.bi];
          running = -1;
        }
      } else if (quantUp) {
        var ri = running; running = -1;
        preempt(ri, true);
      }
    } else {
      timeline[t] = -1;
    }
    t++;
  }
  var turn = 0, wait = 0, resp = 0, runTicks = 0;
  for (var i = 0; i < n; i++) {
    var pp = P[i];
    var c = pp.done ? pp.completion : t;
    turn += c - pp.arrival;
    wait += pp.waitAcc;
    resp += (pp.firstRun === -1 ? c : pp.firstRun) - pp.arrival;
  }
  for (var u = 0; u < timeline.length; u++) if (timeline[u] !== -1) runTicks++;
  var starved = 0;
  for (var s = 0; s < n; s++) if (!P[s].done) starved++;
  var cls = { inter: { t: 0, n: 0, r: 0 }, batch: { t: 0, n: 0, r: 0 } };
  for (var ci = 0; ci < n; ci++) {
    var qq = P[ci], c2 = qq.done ? qq.completion : t;
    var g = cls[qq.cls];
    g.t += c2 - qq.arrival; g.n++;
    g.r += (qq.firstRun === -1 ? c2 : qq.firstRun) - qq.arrival;
  }
  return {
    procs: P, timeline: timeline, ticks: t,
    avgTurn: turn / n, avgWait: wait / n, avgResp: resp / n,
    clsTurn: { inter: cls.inter.n ? cls.inter.t / cls.inter.n : 0,
               batch: cls.batch.n ? cls.batch.t / cls.batch.n : 0 },
    clsResp: { inter: cls.inter.n ? cls.inter.r / cls.inter.n : 0,
               batch: cls.batch.n ? cls.batch.r / cls.batch.n : 0 },
    cpuUtil: t ? runTicks / t : 0, starved: starved, completed: doneCount
  };
}

function scbScore(base, res) {
  if (base.avgTurn <= 0) return 0;
  return ((base.avgTurn - res.avgTurn) / base.avgTurn) * 100;
}


/* ================= The Scheduler Bay: UI ================= */

var SCB_COLORS = ["#ff5a1f", "#7dd0ff", "#7de0a8", "#ffd27d", "#c79bff", "#ff7db0", "#8affd8", "#ffb27d"];

function scbVerdict(trial, cfg) {
  var base = scbRun(trial, trial.base);
  var res = scbRun(trial, cfg);
  var score = scbScore(base, res);
  var respCeil = base.avgResp * 3;
  var guardResp = res.avgResp <= respCeil + 1e-9;
  var starve = res.starved === 0;
  var passed = starve && guardResp && score >= trial.par;
  return { base: base, res: res, score: score, respCeil: respCeil,
           guardResp: guardResp, starve: starve, passed: passed };
}

function scbFeedback(trial, cfg, v) {
  var L = [];
  var b = v.base, r = v.res;
  if (!v.starve) {
    L.push("STARVATION: " + r.starved + " job(s) never finished. Every job must complete or the trial fails.");
  }
  if (!v.guardResp) {
    L.push("FIRST-RESPONSE CEILING blown: avg first response " + r.avgResp.toFixed(1) +
      " ticks vs ceiling " + v.respCeil.toFixed(1) + ". Long quanta win turnaround, " +
      "but a job that never gets a first slice looks hung.");
  }
  if (v.score < trial.par) {
    if (trial.id === "t1") {
      L.push("Turnaround " + r.avgTurn.toFixed(1) + " vs baseline " + b.avgTurn.toFixed(1) +
        " (need +" + trial.par.toFixed(1) + "%). Batch jobs reward long slices: push the quantum up, " +
        "or run an MLFQ whose top queue has room, but mind the response ceiling.");
    } else if (trial.id === "t2") {
      if (cfg.policy === "rr") {
        L.push("Plain round robin treats shells and compiles alike, and the shells drown. " +
          "MLFQ keeps interactive jobs on the top queue; lottery tickets weight them instead.");
      } else {
        L.push("Turnaround " + r.avgTurn.toFixed(1) + " vs baseline " + b.avgTurn.toFixed(1) +
          " (need +" + trial.par.toFixed(1) + "%). Shells live on the top queue: " +
          "smaller top quantum, or more tickets for the interactive class.");
      }
    } else {
      L.push("The storm is already near optimal: score " + v.score.toFixed(2) +
        "% (need " + trial.par.toFixed(1) + "%). Keep it simple. MLFQ demotion punishes short IO jobs, " +
        "so prefer few queues or plain round robin.");
    }
  } else {
    L.push("PAR BEATEN: " + (v.score >= 0 ? "+" : "") + v.score.toFixed(2) +
      "% turnaround vs the shop baseline. Trial logged.");
  }
  return L;
}

var SCB_CSS = [
  ".scb-overlay{position:fixed;inset:0;z-index:9995;background:rgba(5,8,10,.94);display:none;}",
  ".scb-overlay.open{display:flex;}",
  ".scb-panel{flex:1;min-height:0;width:100%;max-width:900px;margin:0 auto;display:flex;flex-direction:column;background:#0a0c0e;border:1px solid var(--line);overflow:hidden;}",
  "@media(min-width:700px){.scb-panel{border-radius:4px;}}",
  ".scb-bar{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);flex:none;flex-wrap:wrap;background:var(--panel);}",
  ".scb-title{font-family:var(--font-d);font-size:13px;font-weight:700;letter-spacing:.14em;color:var(--paper);white-space:nowrap;}",
  ".scb-title b{color:var(--ember);}",
  ".scb-close{font-family:var(--font-m);font-size:12px;font-weight:700;letter-spacing:.08em;min-height:48px;min-width:48px;padding:12px 18px;border-radius:4px;border:1px solid var(--ember);background:var(--ember);color:#0a0c0e;cursor:pointer;margin-left:auto;}",
  ".scb-close:active{transform:scale(.96);}",
  ".scb-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;}",
  ".scb-sub{font-family:var(--font-m);font-size:11px;color:var(--steel);letter-spacing:.04em;line-height:1.8;margin:0 0 12px;}",
  ".scb-sub b{color:var(--paper);font-weight:600;letter-spacing:.08em;font-size:10px;}",
  ".scb-sub a{color:var(--ice);}",
  ".scb-cards{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:12px;}",
  "@media(min-width:700px){.scb-cards{grid-template-columns:repeat(3,1fr);}}",
  ".scb-card{border:1px solid var(--line);border-radius:4px;padding:14px;background:var(--panel);}",
  ".scb-card h5{margin:0 0 6px;font-family:var(--font-d);font-size:14px;color:var(--paper);}",
  ".scb-card p{margin:0 0 10px;font-size:12px;color:var(--steel);line-height:1.6;}",
  ".scb-card .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
  ".scb-pstat{font-family:var(--font-m);font-size:10px;font-weight:700;letter-spacing:.12em;padding:6px 12px;border-radius:2px;border:1px solid var(--line);color:var(--steel);}",
  ".scb-pstat.pass{color:var(--mint);border-color:rgba(125,224,168,.5);}",
  ".scb-pstat.fail{color:var(--bad);border-color:rgba(255,122,122,.5);}",
  ".scb-best{font-family:var(--font-m);font-size:10px;color:var(--dim);letter-spacing:.06em;}",
  ".scb-mini{font-family:var(--font-m);font-size:11px;font-weight:700;letter-spacing:.06em;min-height:48px;padding:12px 16px;border-radius:4px;border:1px solid rgba(242,237,227,.2);background:var(--panel-2);color:var(--paper);cursor:pointer;}",
  ".scb-mini:active{transform:scale(.96);}",
  ".scb-mini.go{background:var(--ember);border-color:var(--ember);color:#0a0c0e;}",
  ".scb-work{border:1px solid var(--line);border-radius:4px;background:var(--panel);padding:14px;margin-bottom:12px;}",
  ".scb-work h4{margin:0 0 4px;font-family:var(--font-d);font-size:15px;color:var(--paper);}",
  ".scb-brief{font-size:12px;color:var(--steel);line-height:1.7;margin:0 0 4px;max-width:70ch;}",
  ".scb-target{font-family:var(--font-m);font-size:11px;color:var(--dim);line-height:1.7;margin:0 0 4px;}",
  ".scb-target b{color:var(--paper);}",
  ".scb-sec{font-family:var(--font-m);font-size:10px;font-weight:700;letter-spacing:.14em;color:var(--dim);margin:14px 0 8px;}",
  ".scb-seg{display:inline-flex;border:1px solid var(--line);border-radius:4px;overflow:hidden;max-width:100%;}",
  ".scb-segbtn{font-family:var(--font-m);font-size:11px;font-weight:700;letter-spacing:.08em;min-height:48px;min-width:88px;padding:12px 18px;background:var(--panel-2);color:var(--steel);border:none;cursor:pointer;}",
  ".scb-segbtn + .scb-segbtn{border-left:1px solid var(--line);}",
  ".scb-segbtn.on{background:var(--ember);color:#0a0c0e;}",
  ".scb-segbtn:active{transform:scale(.96);}",
  ".scb-ctl{margin:12px 0;}",
  ".scb-ctl label{display:flex;justify-content:space-between;align-items:baseline;font-family:var(--font-m);font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--steel);margin-bottom:6px;}",
  ".scb-ctl label output{color:var(--ember);font-size:13px;}",
  ".scb-ctl input[type=range]{width:100%;min-height:48px;accent-color:var(--ember);}",
  ".scb-go{font-family:var(--font-d);font-size:12px;font-weight:700;letter-spacing:.08em;min-height:48px;padding:12px 20px;border-radius:4px;border:1px solid var(--ember);background:var(--ember);color:#0a0c0e;cursor:pointer;margin-top:6px;}",
  ".scb-go:active{transform:scale(.96);}",
  ".scb-res{margin-top:14px;border-top:1px solid var(--line);padding-top:12px;}",
  ".scb-res.pop{animation:scbpop 200ms ease-out;}",
  "@keyframes scbpop{from{transform:scale(.985);opacity:.4;}to{transform:scale(1);opacity:1;}}",
  "@media(prefers-reduced-motion:reduce){.scb-res.pop{animation:none;}}",
  ".scb-metric{display:flex;gap:8px;align-items:baseline;justify-content:space-between;flex-wrap:wrap;font-family:var(--font-m);font-size:11px;color:var(--steel);padding:8px 0;border-bottom:1px dashed var(--line);}",
  ".scb-metric .k{font-weight:700;letter-spacing:.1em;color:var(--dim);font-size:10px;}",
  ".scb-metric .v{color:var(--paper);font-size:13px;}",
  ".scb-metric .d{font-size:10px;letter-spacing:.06em;}",
  ".scb-metric .ok{color:var(--mint);font-weight:700;}",
  ".scb-metric .no{color:var(--bad);font-weight:700;}",
  ".scb-verdict{font-family:var(--font-d);font-size:14px;font-weight:700;letter-spacing:.1em;margin:12px 0 4px;color:var(--paper);}",
  ".scb-verdict.pass{color:var(--mint);}",
  ".scb-verdict.fail{color:var(--bad);}",
  ".scb-fb{list-style:none;margin:8px 0 0;padding:0;font-family:var(--font-m);font-size:11px;line-height:1.8;color:var(--steel);}",
  ".scb-fb li{border-left:2px solid var(--ember);padding-left:10px;margin-bottom:6px;}",
  ".scb-gantt{width:100%;height:44px;display:block;border:1px solid var(--line);border-radius:3px;margin-top:10px;background:#0a0c0e;}",
  ".scb-legend{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;font-family:var(--font-m);font-size:10px;color:var(--steel);letter-spacing:.04em;}",
  ".scb-legend span{display:inline-flex;align-items:center;gap:5px;}",
  ".scb-legend i{width:10px;height:10px;border-radius:2px;display:inline-block;}",
  ".scb-cert{border:1px solid rgba(125,224,168,.5);border-radius:4px;background:var(--panel);padding:14px;margin-bottom:12px;}",
  ".scb-cert h4{margin:0 0 6px;font-family:var(--font-d);font-size:15px;color:var(--mint);letter-spacing:.08em;}",
  ".scb-cert p{margin:0 0 10px;font-size:12px;color:var(--steel);line-height:1.7;}",
  ".scb-overlay :focus-visible{outline:2px solid var(--ember);outline-offset:2px;}"
];

function scb$(id) { return document.getElementById(id); }
function scbEl(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function scbDownload(text, name) {
  var blob = new Blob([text], { type: "text/plain" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

var SCB_ST = {};
var SCB_CUR = "t1";
var SCB_CFGS = {};
SCB_TRIALS.forEach(function (t) {
  SCB_ST[t.id] = { best: -Infinity, passed: false, bestCfg: null };
  SCB_CFGS[t.id] = { policy: "rr", quantum: 20, queues: 3, boost: 300, interW: 8 };
});

function scbTrial(id) {
  for (var i = 0; i < SCB_TRIALS.length; i++) if (SCB_TRIALS[i].id === id) return SCB_TRIALS[i];
  return SCB_TRIALS[0];
}
function scbCfgStr(c) {
  var s = c.policy.toUpperCase() + " q" + c.quantum;
  if (c.policy === "mlfq") s += " k" + c.queues + " boost" + c.boost;
  if (c.policy === "lotto") s += " iw" + c.interW;
  return s;
}

function scbRenderCards() {
  var cards = scb$("scbCards");
  if (!cards) return;
  cards.innerHTML = "";
  SCB_TRIALS.forEach(function (t) {
    var st = SCB_ST[t.id];
    var card = scbEl("div", "scb-card");
    card.appendChild(scbEl("h5", null, t.name));
    var p = scbEl("p", null, t.blurb);
    card.appendChild(p);
    var row = scbEl("div", "row");
    var stat = scbEl("span", "scb-pstat " + (st.passed ? "pass" : "fail"),
      st.passed ? "PASSED" : "PENDING");
    row.appendChild(stat);
    var best = scbEl("span", "scb-best",
      st.best === -Infinity ? "no runs yet" :
      "best " + (st.best >= 0 ? "+" : "") + st.best.toFixed(2) + "% (" + scbCfgStr(st.bestCfg) + ")");
    row.appendChild(best);
    card.appendChild(row);
    var row2 = scbEl("div", "row");
    row2.style.marginTop = "10px";
    var open = scbEl("button", "scb-mini", SCB_CUR === t.id ? "OPEN (CURRENT)" : "OPEN");
    open.type = "button";
    (function (id) {
      open.addEventListener("click", function () { scbOpenTrial(id); });
    })(t.id);
    row2.appendChild(open);
    card.appendChild(row2);
    cards.appendChild(card);
  });
}

function scbSeg(labels, values, cur, aria, onPick) {
  var g = scbEl("div", "scb-seg");
  g.setAttribute("role", "group");
  g.setAttribute("aria-label", aria);
  values.forEach(function (v, i) {
    var b = scbEl("button", "scb-segbtn" + (v === cur ? " on" : ""), labels[i]);
    b.type = "button";
    b.setAttribute("aria-pressed", v === cur ? "true" : "false");
    (function (val) {
      b.addEventListener("click", function () { onPick(val); });
    })(v);
    g.appendChild(b);
  });
  return g;
}

function scbSlider(labelText, min, max, step, val, unit, onInput) {
  var wrap = scbEl("div", "scb-ctl");
  var lab = document.createElement("label");
  var nm = scbEl("span", null, labelText);
  var out = document.createElement("output");
  out.textContent = val + unit;
  lab.appendChild(nm); lab.appendChild(out);
  var inp = document.createElement("input");
  inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = val;
  inp.setAttribute("aria-label", labelText);
  inp.addEventListener("input", function () {
    out.textContent = inp.value + unit;
    onInput(parseInt(inp.value, 10));
  });
  wrap.appendChild(lab); wrap.appendChild(inp);
  return wrap;
}

function scbOpenTrial(id) {
  SCB_CUR = id;
  scbRenderCards();
  var t = scbTrial(id);
  var cfg = SCB_CFGS[id];
  var work = scb$("scbWork");
  work.innerHTML = "";
  work.appendChild(scbEl("h4", null, t.name));
  var brief = scbEl("p", "scb-brief", t.blurb);
  work.appendChild(brief);
  var base = scbRun(t, t.base);
  var tgt = scbEl("p", "scb-target", "");
  tgt.innerHTML = "PAR: beat the shop baseline (RR q20) turnaround by <b>+" +
    t.par.toFixed(1) + "%</b>. Baseline turnaround <b>" + base.avgTurn.toFixed(1) +
    "</b> ticks. First-response ceiling <b>" + (base.avgResp * 3).toFixed(1) +
    "</b> ticks. Zero starvation. Deterministic sim, seed " + t.seed + ".";
  work.appendChild(tgt);

  work.appendChild(scbEl("div", "scb-sec", "SCHEDULER POLICY"));
  work.appendChild(scbSeg(
    ["ROUND ROBIN", "LOTTERY", "MLFQ"], ["rr", "lotto", "mlfq"], cfg.policy,
    "Scheduler policy",
    function (v) { cfg.policy = v; scbOpenTrial(id); }
  ));

  work.appendChild(scbSlider("TIME QUANTUM", 2, 64, 1, cfg.quantum, " ticks",
    function (v) { cfg.quantum = v; }));

  if (cfg.policy === "mlfq") {
    work.appendChild(scbEl("div", "scb-sec", "MLFQ QUEUES"));
    work.appendChild(scbSeg(["2", "3", "4"], [2, 3, 4], cfg.queues, "MLFQ queue count",
      function (v) { cfg.queues = v; scbOpenTrial(id); }));
    work.appendChild(scbSlider("PRIORITY BOOST EVERY", 50, 800, 50, cfg.boost, " ticks",
      function (v) { cfg.boost = v; }));
  }
  if (cfg.policy === "lotto") {
    work.appendChild(scbSlider("INTERACTIVE TICKETS", 1, 16, 1, cfg.interW, "x",
      function (v) { cfg.interW = v; }));
    var note = scbEl("p", "scb-brief",
      "Batch jobs always hold 1 ticket. Interactive jobs hold the tickets above.");
    work.appendChild(note);
  }

  var go = scbEl("button", "scb-go", "RUN SCHEDULER");
  go.type = "button";
  go.addEventListener("click", function () { scbRunTrial(id); });
  work.appendChild(go);

  var res = scbEl("div", "scb-res");
  res.id = "scbRes";
  work.appendChild(res);
  try { work.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) {}
}

function scbDrawGantt(cv, res, trial) {
  try {
    var ctx = cv.getContext("2d");
    if (!ctx || typeof ctx.fillRect !== "function") return;
    var W = cv.width, H = cv.height;
    ctx.fillStyle = "#0a0c0e";
    ctx.fillRect(0, 0, W, H);
    var ticks = res.ticks || 1;
    var tl = res.timeline;
    for (var t = 0; t < tl.length; t++) {
      var pi = tl[t];
      var x = Math.floor(t / ticks * W);
      var w = Math.max(1, Math.ceil(1 / ticks * W));
      ctx.fillStyle = pi === -1 ? "#20262c" : SCB_COLORS[pi % SCB_COLORS.length];
      ctx.fillRect(x, 6, w, H - 12);
    }
  } catch (e) { /* canvas unavailable: legend still carries the info */ }
}

function scbRunTrial(id) {
  var t = scbTrial(id);
  var cfg = SCB_CFGS[id];
  var v = scbVerdict(t, cfg);
  var st = SCB_ST[id];
  if (v.score > st.best) { st.best = v.score; st.bestCfg = { policy: cfg.policy, quantum: cfg.quantum, queues: cfg.queues, boost: cfg.boost, interW: cfg.interW }; }
  if (v.passed) st.passed = true;
  scbRenderCards();

  var res = scb$("scbRes");
  res.innerHTML = "";
  res.classList.remove("pop");
  void res.offsetWidth;
  res.classList.add("pop");

  function metric(k, yours, baseTxt, verdictOk, verdictTxt) {
    var row = scbEl("div", "scb-metric");
    row.appendChild(scbEl("span", "k", k));
    var mid = scbEl("span", null, "");
    mid.innerHTML = "<span class=\"v\">" + yours + "</span> <span class=\"d\">" + baseTxt + "</span>";
    row.appendChild(mid);
    row.appendChild(scbEl("span", "d " + (verdictOk ? "ok" : "no"), verdictTxt));
    res.appendChild(row);
  }
  var sTxt = (v.score >= 0 ? "+" : "") + v.score.toFixed(2) + "% vs baseline";
  metric("AVG TURNAROUND", v.res.avgTurn.toFixed(1) + " ticks",
    "baseline " + v.base.avgTurn.toFixed(1) + ", par +" + t.par.toFixed(1) + "%",
    v.score >= t.par, (v.score >= t.par ? "PASS " : "FAIL ") + sTxt);
  metric("FIRST RESPONSE", v.res.avgResp.toFixed(1) + " ticks",
    "ceiling " + v.respCeil.toFixed(1) + " ticks",
    v.guardResp, v.guardResp ? "PASS within ceiling" : "FAIL ceiling blown");
  metric("STARVATION", v.res.starved === 0 ? "0 jobs stuck" : v.res.starved + " jobs stuck",
    "all " + t.procs.length + " jobs must finish",
    v.starve, v.starve ? "PASS complete" : "FAIL starved");

  var banner = scbEl("div", "scb-verdict " + (v.passed ? "pass" : "fail"),
    v.passed ? "TRIAL PASSED" : "NOT YET");
  res.appendChild(banner);

  var fb = scbEl("ul", "scb-fb");
  scbFeedback(t, cfg, v).forEach(function (line) {
    var li = scbEl("li", null, "");
    li.textContent = line;
    fb.appendChild(li);
  });
  res.appendChild(fb);

  var cv = document.createElement("canvas");
  cv.className = "scb-gantt";
  cv.width = 640; cv.height = 44;
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", "Gantt chart of the schedule, one lane, colored per job");
  res.appendChild(cv);
  var leg = scbEl("div", "scb-legend");
  t.procs.forEach(function (p, i) {
    var s = scbEl("span", null, "");
    var sw = document.createElement("i");
    sw.style.background = SCB_COLORS[i % SCB_COLORS.length];
    s.appendChild(sw);
    s.appendChild(document.createTextNode(p.name + " (" + p.cls + ")"));
    leg.appendChild(s);
  });
  res.appendChild(leg);
  scbDrawGantt(cv, v.res, t);

  scbRenderCert();
  try { toast(v.passed ? "Trial passed." : "Run logged. Adjust and run again."); } catch (e) {}
}

function scbCertText() {
  var lines = [];
  lines.push("THE SCHEDULER BAY");
  lines.push("Proving Ground scheduler qualification certificate");
  lines.push("Date: " + new Date().toISOString().slice(0, 10));
  lines.push("");
  var tot = 0, par = 0;
  SCB_TRIALS.forEach(function (t) {
    var st = SCB_ST[t.id];
    tot += st.best; par += t.par;
    lines.push(t.name + ": best " + (st.best >= 0 ? "+" : "") + st.best.toFixed(2) +
      "% vs par +" + t.par.toFixed(1) + "% (" + scbCfgStr(st.bestCfg) + ")" +
      (st.passed ? "  PASSED" : "  OPEN"));
  });
  lines.push("");
  lines.push("Total " + (tot >= 0 ? "+" : "") + tot.toFixed(2) + "% vs par +" + par.toFixed(1) + "%.");
  lines.push("Deterministic tick simulation. Seeds: " +
    SCB_TRIALS.map(function (t) { return t.id + "=" + t.seed; }).join(", ") + ".");
  lines.push("The bench accepts this scheduler.");
  return lines.join("\n");
}

function scbRenderCert() {
  var box = scb$("scbCertBox");
  box.innerHTML = "";
  var done = SCB_TRIALS.every(function (t) { return SCB_ST[t.id].passed; });
  if (!done) return;
  box.style.display = "";
  box.appendChild(scbEl("h4", null, "SCHEDULER CERTIFIED"));
  var tot = 0, par = 0;
  SCB_TRIALS.forEach(function (t) { tot += SCB_ST[t.id].best; par += t.par; });
  var p = scbEl("p", null, "");
  p.textContent = "All three workloads beaten against the shop baseline. Total " +
    (tot >= 0 ? "+" : "") + tot.toFixed(2) + "% vs par +" + par.toFixed(1) +
    "%. The bench accepts this scheduler.";
  box.appendChild(p);
  var dl = scbEl("button", "scb-mini go", "DOWNLOAD CERTIFICATE");
  dl.type = "button";
  dl.addEventListener("click", function () {
    scbDownload(scbCertText(), "scheduler-bay-certificate.txt");
    try { toast("Certificate downloaded."); } catch (e) {}
  });
  box.appendChild(dl);
  box.classList.add("show");
}

/* ---------------- shell ---------------- */

function scbBuildShell() {
  var css = document.createElement("style");
  css.textContent = SCB_CSS.join("\n");
  document.head.appendChild(css);

  var box = document.querySelector(".dossier .actions");
  if (box && !scb$("scbBtn")) {
    var b = scbEl("button", "secondary", "Run the Scheduler Bay");
    b.id = "scbBtn";
    b.addEventListener("click", function () { scb$("scbOverlay").classList.add("open"); });
    box.appendChild(b);
  }

  var ov = scbEl("div", "scb-overlay");
  ov.id = "scbOverlay";
  var panel = scbEl("div", "scb-panel");
  ov.appendChild(panel);
  document.body.appendChild(ov);

  var bar = scbEl("div", "scb-bar");
  var title = scbEl("div", "scb-title", "");
  title.innerHTML = "THE SCHEDULER <b>BAY</b>";
  var close = scbEl("button", "scb-close", "CLOSE");
  close.setAttribute("aria-label", "Close the Scheduler Bay");
  bar.appendChild(title); bar.appendChild(close);
  panel.appendChild(bar);

  var body = scbEl("div", "scb-body");
  var sub = scbEl("p", "scb-sub", "");
  sub.innerHTML = "<b>HOW IT WORKS</b> Three real schedulers (Round Robin, Lottery, " +
    "Multi-Level Feedback Queue) run a deterministic tick simulation of each workload. " +
    "Pick a policy, tune its knobs, run the sim, beat the shop baseline on all three trials. " +
    "Built for the RISC-V and xv6 systems work in the " +
    "<a href=\"https://dillingerstaffing.github.io/portfolio/\" target=\"_blank\" rel=\"noopener\">portfolio</a>.";
  body.appendChild(sub);

  var cards = scbEl("div", "scb-cards");
  cards.id = "scbCards";
  body.appendChild(cards);

  var work = scbEl("div", "scb-work");
  work.id = "scbWork";
  body.appendChild(work);

  var certBox = scbEl("div", "scb-cert");
  certBox.id = "scbCertBox";
  certBox.style.display = "none";
  body.appendChild(certBox);

  panel.appendChild(body);

  close.addEventListener("click", function () { ov.classList.remove("open"); });
  ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("open"); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && ov.classList.contains("open")) ov.classList.remove("open");
  });

  scbRenderCards();
  scbOpenTrial("t1");
}

function scbInit() {
  if (typeof document === "undefined") return;
  if (!document.querySelector(".dossier .actions")) return;
  scbBuildShell();
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scbInit);
  } else {
    scbInit();
  }
}

/* node test hook: harmless in the browser */
if (typeof module !== "undefined" && module.exports) {
  module.exports = Object.assign(module.exports || {}, {
    SCB: {
      run: scbRun, score: scbScore, verdict: scbVerdict, feedback: scbFeedback,
      TRIALS: SCB_TRIALS, mulberry32: scbMulberry32
    }
  });
}

})();
(function () {
"use strict";
/* ================= The Boot Bay: core (no DOM). Node-testable. =================
   You are the M-mode firmware on a fresh RISC-V hart. Verify the stage
   images, lay out the memory map, lock the PMP, and bring the machine
   from reset to login. Deterministic: same seed, same board, every run. */

function btbMulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function btbFnv(bytes) {
  var h = 0x811c9dc5;
  for (var i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function btbHex(n) {
  return "0x" + (n >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function btbMakeImage(seed, size) {
  var rng = btbMulberry32(seed);
  var img = new Uint8Array(size);
  for (var i = 0; i < size; i++) img[i] = (rng() * 256) | 0;
  return img;
}

var BTB_ROM_END = 0x00010000;   /* ROM: 0x00000000 .. 0x0000FFFF (64 KB) */
var BTB_MBOX_END = 0x00011000;  /* mailbox: 0x00010000 .. 0x00010FFF (4 KB) */
var BTB_DRAM_BASE = 0x80000000;
var BTB_DRAM_END = 0x88000000;  /* 128 MB DRAM */
var BTB_ALIGN = 0x1000;         /* 4 KB alignment */
var BTB_S1_SIZE = 0xC000;       /* stage 1: 48 KB */
var BTB_S2_SIZE = 0x18000;      /* stage 2: 96 KB */

function btbTrialDef(id) {
  var t = { id: id };
  if (id === "t1") {
    t.name = "CLEAN BOARD"; t.seed = 7101;
    t.blurb = "A fresh board, golden images, sane defaults. Learn the drill: verify, map, lock, boot.";
    t.defA1 = 0x80000000; t.defA2 = 0x80010000; t.corrupt = false;
  } else if (id === "t2") {
    t.name = "BIT ROT"; t.seed = 7202;
    t.blurb = "Stage 2 sat in a damp warehouse. Its bytes no longer match the manifest. Firmware rule: never boot what you cannot verify.";
    t.defA1 = 0x80000000; t.defA2 = 0x80010000; t.corrupt = true;
  } else {
    t.name = "OVERLAP TRAP"; t.seed = 7303;
    t.blurb = "Someone else's defaults. Stage 2's load address sits inside stage 1's footprint. Fix the map before you boot.";
    t.defA1 = 0x80000000; t.defA2 = 0x80004000; t.corrupt = false;
  }
  return t;
}

var BTB_TRIALS = ["t1", "t2", "t3"].map(btbTrialDef);

/* Build the stage images for a trial. Claimed hashes are the manifest
   (golden) values; when t.corrupt, stage 2's bytes are flipped after
   the manifest is taken, so verification fails until a reflash. */
function btbImages(t) {
  var img1 = btbMakeImage(t.seed, BTB_S1_SIZE);
  var img2 = btbMakeImage(t.seed ^ 0x9E37, BTB_S2_SIZE);
  var claimed1 = btbFnv(img1);
  var claimed2 = btbFnv(img2);
  if (t.corrupt) img2[1234] ^= 0xFF;
  return { img1: img1, img2: img2, claimed1: claimed1, claimed2: claimed2 };
}

function btbVerify(bytes, claimed) {
  var computed = btbFnv(bytes);
  return { match: computed === (claimed >>> 0), computed: computed };
}

/* Memory-map validation. Returns an array of fault strings (empty = clean). */
function btbCheckMap(a1, a2) {
  var faults = [];
  function checkAddr(v, name, size) {
    if (typeof v !== "number" || isNaN(v) || v !== (v >>> 0)) {
      faults.push(name + " address is not a valid 32-bit hex value.");
      return false;
    }
    if (v % BTB_ALIGN !== 0) {
      faults.push(name + " address " + btbHex(v) + " is not 4 KB aligned.");
    }
    if (v < BTB_DRAM_BASE || v + size > BTB_DRAM_END) {
      faults.push(name + " range " + btbHex(v) + ".." + btbHex(v + size) +
        " leaves DRAM (" + btbHex(BTB_DRAM_BASE) + ".." + btbHex(BTB_DRAM_END) + ").");
    }
    if (v < BTB_MBOX_END) {
      faults.push(name + " address " + btbHex(v) + " collides with ROM/mailbox (below " + btbHex(BTB_MBOX_END) + ").");
    }
    return true;
  }
  var ok1 = checkAddr(a1, "STAGE1", BTB_S1_SIZE);
  var ok2 = checkAddr(a2, "STAGE2", BTB_S2_SIZE);
  if (ok1 && ok2) {
    var e1 = a1 + BTB_S1_SIZE, e2 = a2 + BTB_S2_SIZE;
    if (a1 < e2 && a2 < e1) {
      faults.push("STAGE2 range " + btbHex(a2) + ".." + btbHex(e2) +
        " overlaps STAGE1 range " + btbHex(a1) + ".." + btbHex(e1) + ".");
    }
  }
  return faults;
}

/* PMP validation. Both regions must be locked or the boot is refused. */
function btbCheckPmp(romLock, fwLock) {
  var faults = [];
  if (!romLock) faults.push("ROM region unlocked: the immutable code has a tamper window. Lock it.");
  if (!fwLock) faults.push("Firmware region unlocked: U-mode could rewrite the loader. Lock it.");
  return faults;
}

/* Run the boot. cfg: {a1, a2, romLock, fwLock, reflashed}.
   Returns { pass, log } where log is [{kind, text}], kind in ok|bad|info. */
function btbBoot(t, cfg) {
  var L = [];
  function log(kind, text) { L.push({ kind: kind, text: text }); }
  function halt(why) {
    log("bad", "HALT: " + why + " Hart parked, board safe.");
    return { pass: false, log: L };
  }
  log("info", "RESET: hart0 released at 0x00001000, M-mode ROM, traps to M.");
  var mf = btbCheckMap(cfg.a1, cfg.a2);
  if (mf.length) {
    for (var i = 0; i < mf.length; i++) log("bad", "MAP FAULT: " + mf[i]);
    return halt("memory map fault.");
  }
  log("ok", "MAP: stage regions valid, no overlaps, 4 KB aligned.");
  var pf = btbCheckPmp(cfg.romLock, cfg.fwLock);
  if (pf.length) {
    for (var j = 0; j < pf.length; j++) log("bad", "PMP FAULT: " + pf[j]);
    return halt("PMP refused.");
  }
  log("ok", "PMP: ROM locked R-X, firmware region locked. No tamper window.");
  var im = btbImages(t);
  var v1 = btbVerify(im.img1, im.claimed1);
  if (!v1.match) {
    log("bad", "SECURE BOOT FAULT: stage1 checksum mismatch (manifest " +
      btbHex(im.claimed1) + ", computed " + btbHex(v1.computed) + ").");
    return halt("unverified stage1.");
  }
  log("ok", "STAGE1 VERIFIED: manifest " + btbHex(im.claimed1) +
    " matches, 48 KB loaded at " + btbHex(cfg.a1) + ".");
  log("info", "JUMP: mret to stage1, still M-mode, medeleg clear.");
  var img2 = (cfg.reflashed && t.corrupt)
    ? btbMakeImage(t.seed ^ 0x9E37, BTB_S2_SIZE)
    : im.img2;
  if (cfg.reflashed && t.corrupt) {
    log("info", "REFLASH: stage2 restored from the golden image in ROM.");
  }
  var v2 = btbVerify(img2, im.claimed2);
  if (!v2.match) {
    log("bad", "SECURE BOOT FAULT: stage2 checksum mismatch (manifest " +
      btbHex(im.claimed2) + ", computed " + btbHex(v2.computed) + ").");
    log("bad", "Refusing to boot an unverified stage. Reflash from golden, then retry.");
    return halt("unverified stage2.");
  }
  log("ok", "STAGE2 VERIFIED: manifest " + btbHex(im.claimed2) +
    " matches, 96 KB loaded at " + btbHex(cfg.a2) + ".");
  log("info", "DELEGATE: medeleg/mideleg programmed, S-mode takes its traps.");
  log("info", "JUMP: sret to the kernel at " + btbHex(cfg.a2) + ".");
  log("ok", "KERNEL: satp programmed, hart running in S-mode.");
  log("ok", "INIT: login:  The machine is up.");
  return { pass: true, log: L };
}

function btbCertText(results) {
  var lines = [
    "THE PROVING GROUND",
    "BOOT BAY CERTIFICATE",
    "=====================",
    "Bearer brought a RISC-V hart from reset to login on all three boards:",
    ""
  ];
  for (var i = 0; i < BTB_TRIALS.length; i++) {
    var t = BTB_TRIALS[i];
    lines.push((results[t.id] && results[t.id].passed ? "PASS" : "FAIL") + "  " + t.name);
  }
  lines.push("");
  lines.push("Secure boot held: every stage verified against its manifest,");
  lines.push("memory map clean, PMP locked, no unverified code executed.");
  lines.push("Issued by the bench. Deterministic, reproducible, no shortcuts.");
  return lines.join("\n");
}


/* ================= The Boot Bay: UI ================= */

function btbEl(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function btb$(id) { return document.getElementById(id); }

function btbDownload(text, filename) {
  var blob = new Blob([text], { type: "text/plain" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}

var BTB_CSS = [
  ".bb-overlay{position:fixed;inset:0;z-index:9995;background:rgba(5,8,10,.94);display:none;}",
  ".bb-overlay.open{display:flex;}",
  ".bb-panel{flex:1;min-height:0;width:100%;max-width:920px;margin:0 auto;display:flex;flex-direction:column;background:#0a0c0e;border:1px solid var(--line);overflow:hidden;}",
  ".bb-bar{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--line);}",
  ".bb-title{font-family:'Space Grotesk',sans-serif;font-weight:700;letter-spacing:.08em;font-size:15px;}",
  ".bb-title b{color:var(--ember);font-weight:700;}",
  ".bb-close{min-width:48px;min-height:48px;padding:0 18px;background:transparent;border:1px solid var(--line);color:var(--ink);font-family:'Space Grotesk',sans-serif;font-weight:700;letter-spacing:.08em;font-size:13px;cursor:pointer;}",
  ".bb-close:hover{border-color:var(--ember);color:var(--ember);}",
  ".bb-close:focus-visible,.bb-btn:focus-visible,.bb-card:focus-visible,.bb-check input:focus-visible + span{outline:2px solid var(--ember);outline-offset:2px;}",
  ".bb-body{overflow-y:auto;padding:18px;-webkit-overflow-scrolling:touch;}",
  ".bb-sub{font-size:13px;line-height:1.6;color:#b9b2a4;margin:0 0 16px;max-width:64ch;}",
  ".bb-sub b{color:var(--ink);letter-spacing:.06em;}",
  ".bb-sub a{color:var(--ember);}",
  ".bb-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px;}",
  ".bb-card{min-height:48px;padding:12px 14px;background:var(--panel);border:1px solid var(--line);color:var(--ink);cursor:pointer;text-align:left;font-family:'Space Grotesk',sans-serif;}",
  ".bb-card .bb-cardname{display:block;font-weight:700;letter-spacing:.06em;font-size:13px;}",
  ".bb-card .bb-cardst{display:block;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.08em;margin-top:6px;color:#8f8a7d;}",
  ".bb-card.passed{border-color:var(--ember);}",
  ".bb-card.passed .bb-cardst{color:var(--ember);}",
  ".bb-card.sel{border-color:var(--ember);box-shadow:inset 3px 0 0 var(--ember);}",
  ".bb-h{font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:700;letter-spacing:.12em;margin:20px 0 10px;color:var(--ink);}",
  ".bb-h:first-child{margin-top:0;}",
  ".bb-table{width:100%;border-collapse:collapse;font-size:13px;}",
  ".bb-table th{font-family:'Space Grotesk',sans-serif;font-size:11px;letter-spacing:.1em;text-align:left;color:#8f8a7d;padding:8px;border-bottom:1px solid var(--line);}",
  ".bb-table td{padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:middle;}",
  ".bb-mono{font-family:'IBM Plex Mono',monospace;font-size:12px;}",
  ".bb-vstat{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.06em;display:inline-block;margin-top:6px;}",
  ".bb-vstat.ok{color:#7de0a8;}",
  ".bb-vstat.bad{color:#ff7d6b;}",
  ".bb-vstat.idle{color:#8f8a7d;}",
  ".bb-btn{min-height:48px;padding:0 18px;background:transparent;border:1px solid var(--line);color:var(--ink);font-family:'Space Grotesk',sans-serif;font-weight:700;letter-spacing:.08em;font-size:12px;cursor:pointer;margin:4px 8px 4px 0;}",
  ".bb-btn:hover{border-color:var(--ember);color:var(--ember);}",
  ".bb-btn.pri{background:var(--ember);border-color:var(--ember);color:#0a0c0e;}",
  ".bb-btn.pri:hover{background:#ff6f3a;color:#0a0c0e;}",
  ".bb-btn:disabled{opacity:.45;cursor:default;}",
  ".bb-btn:disabled:hover{border-color:var(--line);color:var(--ink);}",
  ".bb-btn.pri:disabled:hover{background:var(--ember);color:#0a0c0e;}",
  ".bb-field{margin:0 0 12px;}",
  ".bb-field label{display:block;font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;margin-bottom:8px;color:#b9b2a4;}",
  ".bb-field input[type=text]{width:100%;max-width:340px;min-height:48px;padding:0 14px;background:#05070a;border:1px solid var(--line);color:var(--ink);font-family:'IBM Plex Mono',monospace;font-size:15px;}",
  ".bb-field input[type=text]:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
  ".bb-hint{font-size:12px;color:#8f8a7d;margin:6px 0 0;font-family:'IBM Plex Mono',monospace;}",
  ".bb-check{display:flex;align-items:center;gap:12px;min-height:48px;padding:8px 0;cursor:pointer;}",
  ".bb-check input{width:24px;height:24px;accent-color:var(--ember);flex:none;}",
  ".bb-check span{font-size:13px;line-height:1.5;}",
  ".bb-check span b{font-family:'IBM Plex Mono',monospace;font-weight:400;color:#b9b2a4;}",
  ".bb-log{list-style:none;margin:0;padding:0;background:#05070a;border:1px solid var(--line);max-height:260px;overflow-y:auto;}",
  ".bb-log li{padding:8px 12px;font-family:'IBM Plex Mono',monospace;font-size:12px;line-height:1.5;border-bottom:1px solid rgba(255,255,255,.04);}",
  ".bb-log li:last-child{border-bottom:none;}",
  ".bb-log .k-ok{color:#7de0a8;font-weight:700;}",
  ".bb-log .k-bad{color:#ff7d6b;font-weight:700;}",
  ".bb-log .k-info{color:#7dd0ff;font-weight:700;}",
  ".bb-banner{display:none;margin-top:16px;padding:14px 16px;border:1px solid var(--line);font-family:'Space Grotesk',sans-serif;}",
  ".bb-banner.show{display:block;}",
  ".bb-banner .t{font-weight:700;letter-spacing:.1em;font-size:14px;}",
  ".bb-banner.pass{border-color:#7de0a8;}",
  ".bb-banner.pass .t{color:#7de0a8;}",
  ".bb-banner.fail{border-color:#ff7d6b;}",
  ".bb-banner.fail .t{color:#ff7d6b;}",
  ".bb-banner p{margin:8px 0 0;font-size:13px;color:#b9b2a4;line-height:1.6;}",
  ".bb-cert{display:none;margin-top:18px;padding:18px;border:1px solid var(--ember);}",
  ".bb-cert.show{display:block;}",
  ".bb-cert h4{font-family:'Space Grotesk',sans-serif;letter-spacing:.1em;font-size:14px;margin:0 0 8px;color:var(--ember);}",
  ".bb-cert p{font-size:13px;color:#b9b2a4;line-height:1.6;margin:0 0 12px;}",
  "@media (max-width:640px){.bb-cards{grid-template-columns:1fr;}.bb-body{padding:14px;}.bb-table th:nth-child(3),.bb-table td:nth-child(3){display:none;}}",
  "@media (prefers-reduced-motion: reduce){.bb-btn,.bb-card,.bb-close{transition:none !important;}}"
];

var BTB_ST = { t1: { passed: false }, t2: { passed: false }, t3: { passed: false } };
var BTB_UI = null; /* per-trial editor state, rebuilt on trial open */

function btbFreshUI(t) {
  return {
    trial: t, a1: t.defA1, a2: t.defA2,
    romLock: false, fwLock: false, reflashed: false,
    v1: null, v2: null /* null = not verified, true/false = result */
  };
}

function btbParseHex(str, fallback) {
  var s = String(str).trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{1,8}$/.test(s)) return fallback;
  return parseInt(s, 16) >>> 0;
}

/* ---------------- trial cards + work area ---------------- */

function btbRenderCards() {
  var wrap = btb$("bbCards");
  wrap.innerHTML = "";
  BTB_TRIALS.forEach(function (t) {
    var c = btbEl("button", "bb-card" + (BTB_ST[t.id].passed ? " passed" : "") +
      (BTB_UI && BTB_UI.trial.id === t.id ? " sel" : ""));
    c.type = "button";
    var nm = btbEl("span", "bb-cardname", t.name);
    var st = btbEl("span", "bb-cardst",
      BTB_ST[t.id].passed ? "[ PASS ] LOGGED" : "[ OPEN ] NOT YET BOOTED");
    c.appendChild(nm); c.appendChild(st);
    c.setAttribute("aria-label", "Open trial " + t.name);
    c.addEventListener("click", function () { btbOpenTrial(t.id); });
    wrap.appendChild(c);
  });
}

function btbOpenTrial(id) {
  var t = btbTrialDef(id);
  BTB_UI = btbFreshUI(t);
  btbRenderCards();
  var work = btb$("bbWork");
  work.innerHTML = "";

  var blurb = btbEl("p", "bb-sub", t.blurb);
  work.appendChild(blurb);

  /* stage manifest */
  work.appendChild(btbEl("h3", "bb-h", "STAGE MANIFEST"));
  var im = btbImages(t);
  var tbl = btbEl("table", "bb-table");
  var thead = btbEl("thead");
  var hr = btbEl("tr");
  ["STAGE", "SIZE", "MANIFEST", "CHECK"].forEach(function (h) {
    hr.appendChild(btbEl("th", null, h));
  });
  thead.appendChild(hr); tbl.appendChild(thead);
  var tb = btbEl("tbody");

  function stageRow(name, sizeLabel, claimed, imgBytes, vkey) {
    var tr = btbEl("tr");
    var tdN = btbEl("td"); tdN.appendChild(btbEl("div", null, name));
    var tdS = btbEl("td", "bb-mono", sizeLabel);
    var tdM = btbEl("td", "bb-mono", btbHex(claimed));
    var tdC = btbEl("td");
    var stat = btbEl("span", "bb-vstat idle", "NOT VERIFIED");
    stat.id = "bbV" + vkey;
    tdC.appendChild(stat);
    tr.appendChild(tdN); tr.appendChild(tdS); tr.appendChild(tdM); tr.appendChild(tdC);
    return tr;
  }

  var tr0 = btbEl("tr");
  var td0n = btbEl("td"); td0n.appendChild(btbEl("div", null, "STAGE0 ROM"));
  var note0 = btbEl("div", "bb-hint", "immutable, baked at tapeout");
  td0n.appendChild(note0);
  tr0.appendChild(td0n);
  tr0.appendChild(btbEl("td", "bb-mono", "64 KB"));
  tr0.appendChild(btbEl("td", "bb-mono", "baked"));
  var td0c = btbEl("td");
  td0c.appendChild(btbEl("span", "bb-vstat ok", "TRUSTED"));
  tr0.appendChild(td0c);
  tb.appendChild(tr0);

  var r1 = stageRow("STAGE1 loader", "48 KB", im.claimed1, im.img1, "1");
  var vb1 = btbEl("button", "bb-btn", "VERIFY STAGE1");
  vb1.type = "button";
  vb1.addEventListener("click", function () {
    var v = btbVerify(im.img1, im.claimed1);
    BTB_UI.v1 = v.match;
    btbPaintVStat("1", v);
  });
  r1.lastChild.appendChild(document.createElement("br"));
  r1.lastChild.appendChild(vb1);
  tb.appendChild(r1);

  var r2 = stageRow("STAGE2 kernel", "96 KB", im.claimed2, im.img2, "2");
  var vb2 = btbEl("button", "bb-btn", "VERIFY STAGE2");
  vb2.type = "button";
  vb2.addEventListener("click", function () {
    var bytes = (BTB_UI.reflashed && t.corrupt)
      ? btbMakeImage(t.seed ^ 0x9E37, BTB_S2_SIZE) : im.img2;
    var v = btbVerify(bytes, im.claimed2);
    BTB_UI.v2 = v.match;
    btbPaintVStat("2", v);
  });
  r2.lastChild.appendChild(document.createElement("br"));
  r2.lastChild.appendChild(vb2);
  var rf = btbEl("button", "bb-btn", "REFLASH FROM GOLDEN");
  rf.type = "button";
  rf.id = "bbReflash";
  rf.addEventListener("click", function () {
    BTB_UI.reflashed = true;
    BTB_UI.v2 = null;
    btbPaintVStat("2", null);
    try { toast("Stage 2 reflashed from the golden image in ROM."); } catch (e) {}
  });
  r2.lastChild.appendChild(rf);
  tb.appendChild(r2);

  tbl.appendChild(tb);
  work.appendChild(tbl);

  /* memory map */
  work.appendChild(btbEl("h3", "bb-h", "MEMORY MAP"));
  function addrField(labelText, val, key) {
    var f = btbEl("div", "bb-field");
    var lab = btbEl("label", null, labelText);
    lab.htmlFor = "bb" + key;
    var inp = btbEl("input");
    inp.type = "text"; inp.id = "bb" + key;
    inp.value = btbHex(val);
    inp.setAttribute("inputmode", "text");
    inp.setAttribute("aria-label", labelText);
    inp.addEventListener("change", function () {
      var parsed = btbParseHex(inp.value, null);
      if (parsed === null) {
        inp.value = btbHex(key === "A1" ? BTB_UI.a1 : BTB_UI.a2);
        try { toast("Not a valid 32-bit hex address. Reverted."); } catch (e) {}
        return;
      }
      if (key === "A1") BTB_UI.a1 = parsed; else BTB_UI.a2 = parsed;
      inp.value = btbHex(parsed);
    });
    f.appendChild(lab); f.appendChild(inp);
    return f;
  }
  work.appendChild(addrField("STAGE1 LOAD ADDRESS", BTB_UI.a1, "A1"));
  work.appendChild(addrField("STAGE2 LOAD ADDRESS", BTB_UI.a2, "A2"));
  var hint = btbEl("p", "bb-hint",
    "DRAM " + btbHex(BTB_DRAM_BASE) + " to " + btbHex(BTB_DRAM_END) +
    ". 4 KB aligned. No overlaps. ROM and mailbox below " + btbHex(BTB_MBOX_END) + " are off limits.");
  work.appendChild(hint);

  /* PMP */
  work.appendChild(btbEl("h3", "bb-h", "PMP LOCKS"));
  function lockRow(labelText, sub, key) {
    var lab = btbEl("label", "bb-check");
    var inp = btbEl("input");
    inp.type = "checkbox";
    inp.checked = key === "rom" ? BTB_UI.romLock : BTB_UI.fwLock;
    inp.setAttribute("aria-label", labelText);
    inp.addEventListener("change", function () {
      if (key === "rom") BTB_UI.romLock = inp.checked; else BTB_UI.fwLock = inp.checked;
    });
    var sp = btbEl("span");
    sp.appendChild(btbEl("b", null, labelText));
    sp.appendChild(document.createTextNode("  " + sub));
    lab.appendChild(inp); lab.appendChild(sp);
    return lab;
  }
  work.appendChild(lockRow("LOCK ROM REGION", "R-X, M-mode only. The immutable code gets no tamper window.", "rom"));
  work.appendChild(lockRow("LOCK FIRMWARE REGION", "No U-mode writes to the loader once it is verified.", "fw"));

  /* actions */
  work.appendChild(btbEl("h3", "bb-h", "BRING-UP"));
  var va = btbEl("button", "bb-btn", "VERIFY ALL");
  va.type = "button";
  va.addEventListener("click", function () {
    var v1 = btbVerify(im.img1, im.claimed1);
    var bytes2 = (BTB_UI.reflashed && t.corrupt)
      ? btbMakeImage(t.seed ^ 0x9E37, BTB_S2_SIZE) : im.img2;
    var v2 = btbVerify(bytes2, im.claimed2);
    BTB_UI.v1 = v1.match; BTB_UI.v2 = v2.match;
    btbPaintVStat("1", v1); btbPaintVStat("2", v2);
  });
  work.appendChild(va);
  var boot = btbEl("button", "bb-btn pri", "BOOT");
  boot.type = "button";
  boot.setAttribute("aria-label", "Boot the machine with the current configuration");
  boot.addEventListener("click", function () { btbRunBoot(t); });
  work.appendChild(boot);

  /* log */
  work.appendChild(btbEl("h3", "bb-h", "BOOT LOG"));
  var log = btbEl("ul", "bb-log");
  log.id = "bbLog";
  var li = btbEl("li", null, "No boot attempted yet. Verify, map, lock, then press BOOT.");
  log.appendChild(li);
  work.appendChild(log);

  /* banner */
  var banner = btbEl("div", "bb-banner");
  banner.id = "bbBanner";
  work.appendChild(banner);

  btbMaybeCert();
}

function btbPaintVStat(key, v) {
  var el = btb$("bbV" + key);
  if (!el) return;
  el.className = "bb-vstat " + (v === null ? "idle" : (v.match ? "ok" : "bad"));
  el.textContent = v === null ? "NOT VERIFIED"
    : (v.match ? "MATCH " + btbHex(v.computed) : "MISMATCH " + btbHex(v.computed));
}

function btbRunBoot(t) {
  var cfg = { a1: BTB_UI.a1, a2: BTB_UI.a2,
    romLock: BTB_UI.romLock, fwLock: BTB_UI.fwLock, reflashed: BTB_UI.reflashed };
  var res = btbBoot(t, cfg);
  var log = btb$("bbLog");
  log.innerHTML = "";
  res.log.forEach(function (line) {
    var li = btbEl("li");
    var k = btbEl("span", "k-" + line.kind,
      line.kind === "ok" ? "[ OK ] " : line.kind === "bad" ? "[ FAULT ] " : "[ INFO ] ");
    li.appendChild(k);
    li.appendChild(document.createTextNode(line.text));
    log.appendChild(li);
  });
  var banner = btb$("bbBanner");
  banner.className = "bb-banner show " + (res.pass ? "pass" : "fail");
  banner.innerHTML = "";
  banner.appendChild(btbEl("div", "t", res.pass ? "TRIAL PASS" : "TRIAL FAIL"));
  var p = btbEl("p", null, res.pass
    ? t.name + " booted clean: reset to login, every stage verified, map clean, PMP locked. Logged."
    : t.name + " did not boot. Read the FAULT lines, fix the configuration, and boot again. The board is safe.");
  banner.appendChild(p);
  if (res.pass && !BTB_ST[t.id].passed) {
    BTB_ST[t.id].passed = true;
    btbRenderCards();
    try { toast("Trial passed: " + t.name + "."); } catch (e) {}
  }
  btbMaybeCert();
  log.scrollTop = log.scrollHeight;
}

function btbMaybeCert() {
  var box = btb$("bbCertBox");
  if (!box) return;
  var done = BTB_TRIALS.every(function (t) { return BTB_ST[t.id].passed; });
  if (!done) return;
  box.style.display = "";
  box.innerHTML = "";
  box.appendChild(btbEl("h4", null, "BOOT BAY CERTIFIED"));
  var tot = BTB_TRIALS.length;
  var p = btbEl("p", null,
    "All " + tot + " boards booted from reset to login. Secure boot held on every one: " +
    "stages verified against their manifests, memory maps clean, PMP locked. The bench accepts this firmware.");
  box.appendChild(p);
  var dl = btbEl("button", "bb-btn pri", "DOWNLOAD CERTIFICATE");
  dl.type = "button";
  dl.addEventListener("click", function () {
    btbDownload(btbCertText(BTB_ST), "boot-bay-certificate.txt");
    try { toast("Certificate downloaded."); } catch (e) {}
  });
  box.appendChild(dl);
  box.classList.add("show");
}

/* ---------------- shell ---------------- */

function btbBuildShell() {
  var css = document.createElement("style");
  css.textContent = BTB_CSS.join("\n");
  document.head.appendChild(css);

  var box = document.querySelector(".dossier .actions");
  if (box && !btb$("bbBtn")) {
    var b = btbEl("button", "secondary", "Run the Boot Bay");
    b.id = "bbBtn";
    b.addEventListener("click", function () { btb$("bbOverlay").classList.add("open"); });
    box.appendChild(b);
  }

  var ov = btbEl("div", "bb-overlay");
  ov.id = "bbOverlay";
  var panel = btbEl("div", "bb-panel");
  ov.appendChild(panel);
  document.body.appendChild(ov);

  var bar = btbEl("div", "bb-bar");
  var title = btbEl("div", "bb-title", "");
  title.innerHTML = "THE BOOT <b>BAY</b>";
  var close = btbEl("button", "bb-close", "CLOSE");
  close.setAttribute("aria-label", "Close the Boot Bay");
  bar.appendChild(title); bar.appendChild(close);
  panel.appendChild(bar);

  var body = btbEl("div", "bb-body");
  var sub = btbEl("p", "bb-sub", "");
  sub.innerHTML = "<b>HOW IT WORKS</b> You are the M-mode firmware on a fresh RISC-V hart. " +
    "Verify each stage against its manifest, set the load addresses, lock the PMP regions, " +
    "then boot from reset to login across three boards. One image is rotten, one map is a trap. " +
    "Built for the RISC-V and xv6 systems work in the " +
    "<a href=\"https://dillingerstaffing.github.io/portfolio/\" target=\"_blank\" rel=\"noopener\">portfolio</a>.";
  body.appendChild(sub);

  var cards = btbEl("div", "bb-cards");
  cards.id = "bbCards";
  body.appendChild(cards);

  var work = btbEl("div", "bb-work");
  work.id = "bbWork";
  body.appendChild(work);

  var certBox = btbEl("div", "bb-cert");
  certBox.id = "bbCertBox";
  certBox.style.display = "none";
  body.appendChild(certBox);

  panel.appendChild(body);

  close.addEventListener("click", function () { ov.classList.remove("open"); });
  ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("open"); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && ov.classList.contains("open")) ov.classList.remove("open");
  });

  BTB_UI = btbFreshUI(BTB_TRIALS[0]);
  btbRenderCards();
  btbOpenTrial("t1");
}

function btbInit() {
  if (typeof document === "undefined") return;
  if (!document.querySelector(".dossier .actions")) return;
  btbBuildShell();
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", btbInit);
  } else {
    btbInit();
  }
}

/* node test hook: harmless in the browser */
if (typeof module !== "undefined" && module.exports) {
  module.exports = Object.assign(module.exports || {}, {
    BTB: {
      mulberry32: btbMulberry32, fnv: btbFnv, hex: btbHex,
      trialDef: btbTrialDef, trials: BTB_TRIALS, images: btbImages,
      verify: btbVerify, checkMap: btbCheckMap, checkPmp: btbCheckPmp,
      boot: btbBoot, certText: btbCertText, parseHex: btbParseHex,
      ROM_END: BTB_ROM_END, MBOX_END: BTB_MBOX_END, DRAM_BASE: BTB_DRAM_BASE,
      DRAM_END: BTB_DRAM_END, ALIGN: BTB_ALIGN, S1_SIZE: BTB_S1_SIZE, S2_SIZE: BTB_S2_SIZE
    }
  });
}

})();
/* ================= THE LOCK LAB (BENCH 14) =================
   TAPEOUT clock-generator qualification. A discrete charge-pump
   PLL lives under the hood: vc = P0*err + I0*acc, with P0 from
   charge-pump current times loop resistance and I0 from current
   over loop capacitance. Three cards go on the bench: a golden
   board, a hot noisy VCO, and a cold-start offset. Tune the
   three knobs, run the loop, read lock time and jitter against
   budget, and qualify only what you can honestly sign. */

(function () {
  "use strict";

  /* ---------------- pure core: no DOM ---------------- */

  function lkMulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function lkWrap(e) {
    e = e % 1;
    if (e > 0.5) e -= 1;
    if (e <= -0.5) e += 1;
    return e;
  }

  /* Discrete charge-pump PLL. Reference advances FREF cycles per
     step; the VCO advances FREF*N*(1 + foff + KVC*vc) plus white
     VCO frequency noise. The phase detector wraps error to
     +-0.5 cycle. Loop filter: leaky integrator (capacitor) plus
     proportional path (resistor). Jitter is RMS output phase
     deviation over the last 500 steps, in picoseconds of a
     1-cycle = 1000 ps scale. */
  var LK_FREF = 0.02, LK_N = 50, LK_KVC = 0.1;
  var LK_STEPS = 4000, LK_WIN = 0.05, LK_LEAK = 0.995;
  var LK_P00 = 8, LK_I00 = 0.1;

  var LK_ICP = [25, 50, 100];
  var LK_R = [2.5, 5, 10];
  var LK_C = [100, 200, 400];
  var LK_DEF = [1, 1, 1];

  var LK_CARDS = [
    { id: "A", name: "GOLDEN BOARD", foff: 0.015, fvco: 0, seed: 5101,
      budget: 1000, jmax: 20,
      brief: "A known-good card. It locks at the default tuning. Learn the knobs here." },
    { id: "B", name: "HOT VCO", foff: 0.03, fvco: 0.15, seed: 5202,
      budget: 1200, jmax: 12,
      brief: "The VCO runs hot and noisy. Jitter is over budget. Widen the loop to quiet it." },
    { id: "C", name: "COLD START", foff: 0.12, fvco: 0, seed: 5303,
      budget: 600, jmax: 25,
      brief: "The oscillator wakes 12 percent off frequency. Lock it inside 600 steps." }
  ];

  function lkSim(icpIdx, rIdx, cIdx, card) {
    var P0 = LK_P00 * (LK_ICP[icpIdx] / 50) * (LK_R[rIdx] / 5);
    var I0 = LK_I00 * (LK_ICP[icpIdx] / 50) / (LK_C[cIdx] / 200);
    var rng = lkMulberry32(card.seed);
    var phr = 0, phv = 0, acc = 0, vc = 0;
    var lastOut = -1;
    var outj = [], trace = [];
    for (var n = 0; n < LK_STEPS; n++) {
      var fvn = (rng() - 0.5) * 2 * card.fvco;
      phr += LK_FREF;
      phv += LK_FREF * LK_N * (1 + card.foff + LK_KVC * vc) + fvn;
      var err = lkWrap(phr - phv / LK_N);
      acc = LK_LEAK * acc + err;
      if (acc > 30) acc = 30; else if (acc < -30) acc = -30;
      vc = P0 * err + I0 * acc;
      if (vc > 1.5) vc = 1.5; else if (vc < -1.5) vc = -1.5;
      if (err >= LK_WIN || err <= -LK_WIN) lastOut = n;
      var odev = (phv / LK_N) - (n + 1) * LK_FREF;
      outj.push(odev);
      if (outj.length > 500) outj.shift();
      if (n % 20 === 0) trace.push(err);
    }
    var rms = 0, i;
    for (i = 0; i < outj.length; i++) rms += outj[i] * outj[i];
    rms = Math.sqrt(rms / outj.length);
    var lock = lastOut + 1, jit = rms * 1000;
    return {
      lock: lock, jit: Math.round(jit * 10) / 10, trace: trace,
      pass: lock <= card.budget && jit <= card.jmax,
      budget: card.budget, jmax: card.jmax
    };
  }

  function lkGrade(res) {
    if (!res.pass) return "FAIL";
    var jm = res.jit / res.jmax, lm = res.lock / res.budget;
    var worst = jm > lm ? jm : lm;
    if (worst <= 0.5) return "GOLD";
    if (worst <= 0.8) return "SILVER";
    return "BRONZE";
  }

  function lkCertText(quals) {
    var L = [];
    L.push("THE LOCK LAB : CLOCK QUALIFICATION CERTIFICATE");
    L.push("TAPEOUT bring-up bench : charge-pump PLL sign-off");
    L.push("");
    for (var i = 0; i < LK_CARDS.length; i++) {
      var c = LK_CARDS[i], q = quals[c.id];
      L.push("Card " + c.id + " " + c.name + ": " +
        (q ? ("QUALIFIED " + q.grade + " : " + q.icp + " uA / " + q.r + " kΩ / " +
              q.c + " pF : lock " + q.lock + " steps, jitter " + q.jit + " ps")
           : "NOT QUALIFIED"));
    }
    L.push("");
    L.push("Method: discrete charge-pump PLL simulation, 4000 steps,");
    L.push("seeded deterministic faults, budgets per card.");
    L.push("Date: " + new Date().toISOString().slice(0, 10));
    return L.join("\n");
  }

  /* ---------------- CSS ---------------- */

  var LK_CSS = [
    ".lk-overlay{position:fixed;inset:0;background:rgba(8,8,10,.82);z-index:9000;display:none;overflow-y:auto;padding:24px 16px;}",
    ".lk-overlay.open{display:block;}",
    ".lk-panel{max-width:860px;margin:0 auto;background:#101014;border:1px solid #2a2a30;border-radius:4px;color:#f2f0eb;font-family:'Space Grotesk',system-ui,sans-serif;}",
    ".lk-bar{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #2a2a30;}",
    ".lk-title{font-size:20px;letter-spacing:.14em;font-weight:700;}",
    ".lk-title b{color:#ff5a1f;}",
    ".lk-close{background:none;border:1px solid #3a3a42;color:#f2f0eb;border-radius:4px;min-height:48px;padding:0 18px;font-family:'IBM Plex Mono',monospace;font-size:13px;cursor:pointer;}",
    ".lk-close:hover{border-color:#ff5a1f;}",
    ".lk-close:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".lk-body{padding:22px;}",
    ".lk-sub{font-size:14px;line-height:1.6;color:#b9b6ae;margin:0 0 20px;}",
    ".lk-sub b{color:#f2f0eb;}",
    ".lk-sub a{color:#ff5a1f;}",
    ".lk-cards{display:flex;gap:10px;margin-bottom:22px;flex-wrap:wrap;}",
    ".lk-cardtab{flex:1;min-width:150px;min-height:56px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;cursor:pointer;font-family:'Space Grotesk',sans-serif;padding:8px 10px;text-align:left;transition:transform .1s,border-color .1s;}",
    ".lk-cardtab:hover{border-color:#ff5a1f;}",
    ".lk-cardtab:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".lk-cardtab.sel{border-color:#ff5a1f;transform:translateY(-2px);}",
    ".lk-cardtab .k{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a877f;letter-spacing:.1em;}",
    ".lk-cardtab .n{font-size:14px;font-weight:700;margin-top:2px;}",
    ".lk-cardtab .q{font-family:'IBM Plex Mono',monospace;font-size:11px;margin-top:4px;color:#8a877f;}",
    ".lk-cardtab .q.done{color:#7dd87d;}",
    ".lk-brief{font-size:13px;color:#b9b6ae;border-left:3px solid #ff5a1f;padding:8px 14px;margin:0 0 22px;line-height:1.55;}",
    ".lk-knobs{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:22px;}",
    ".lk-knob{border:1px solid #2a2a30;border-radius:4px;padding:14px;}",
    ".lk-knob h4{margin:0 0 4px;font-size:12px;letter-spacing:.12em;color:#8a877f;font-weight:700;}",
    ".lk-knob .hint{font-size:12px;color:#6e6b64;margin:0 0 10px;font-family:'IBM Plex Mono',monospace;}",
    ".lk-seg{display:flex;gap:8px;}",
    ".lk-seg label{flex:1;}",
    ".lk-seg input{position:absolute;opacity:0;width:1px;height:1px;}",
    ".lk-seg span{display:flex;align-items:center;justify-content:center;min-height:48px;border:1px solid #3a3a42;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:13px;cursor:pointer;transition:transform .1s,border-color .1s,background .1s;}",
    ".lk-seg label:hover span{border-color:#ff5a1f;}",
    ".lk-seg input:checked+span{border-color:#ff5a1f;background:#2a150c;color:#ffb38a;font-weight:700;}",
    ".lk-seg input:focus-visible+span{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".lk-runrow{display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;}",
    ".lk-run{min-height:52px;padding:0 28px;border:none;border-radius:4px;background:#ff5a1f;color:#101014;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:15px;letter-spacing:.08em;cursor:pointer;transition:transform .1s;}",
    ".lk-run:hover{transform:translateY(-2px);}",
    ".lk-run:focus-visible{outline:2px solid #fff;outline-offset:2px;}",
    ".lk-run:active{transform:translateY(0);}",
    ".lk-tuning{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#8a877f;}",
    ".lk-results{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:18px;}",
    ".lk-metric{border:1px solid #2a2a30;border-radius:4px;padding:14px;}",
    ".lk-metric h5{margin:0 0 6px;font-size:11px;letter-spacing:.12em;color:#8a877f;font-weight:700;}",
    ".lk-metric .v{font-family:'IBM Plex Mono',monospace;font-size:24px;font-weight:700;}",
    ".lk-metric .b{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#8a877f;margin-top:4px;}",
    ".lk-verdict{font-size:15px;font-weight:700;letter-spacing:.1em;padding:14px;border-radius:4px;text-align:center;margin-bottom:18px;border:1px solid #3a3a42;}",
    ".lk-verdict.pass{border-color:#7dd87d;color:#7dd87d;}",
    ".lk-verdict.fail{border-color:#ff5a1f;color:#ff5a1f;}",
    ".lk-verdict small{display:block;font-weight:400;letter-spacing:0;font-size:12px;color:#b9b6ae;margin-top:6px;}",
    ".lk-scope{width:100%;height:180px;background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;margin-bottom:8px;}",
    ".lk-scopelab{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a877f;margin:0 0 18px;}",
    ".lk-qualrow{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px;}",
    ".lk-qual{min-height:52px;padding:0 24px;border:1px solid #7dd87d;background:none;color:#7dd87d;border-radius:4px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px;letter-spacing:.08em;cursor:pointer;}",
    ".lk-qual:hover{background:#12240f;}",
    ".lk-qual:focus-visible{outline:2px solid #7dd87d;outline-offset:2px;}",
    ".lk-qual:disabled{opacity:.4;cursor:default;}",
    ".lk-cert{border:1px solid #7dd87d;border-radius:4px;padding:18px;margin-top:18px;display:none;}",
    ".lk-cert.show{display:block;}",
    ".lk-cert h4{margin:0 0 8px;font-size:14px;letter-spacing:.12em;color:#7dd87d;}",
    ".lk-cert p{font-size:13px;color:#b9b6ae;line-height:1.6;margin:0 0 12px;}",
    ".lk-mini{min-height:48px;padding:0 20px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:12px;cursor:pointer;}",
    ".lk-mini:hover{border-color:#ff5a1f;}",
    ".lk-mini:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    "@media (prefers-reduced-motion:reduce){.lk-cardtab,.lk-run,.lk-seg span{transition:none;}}"
  ];

  /* ---------------- DOM helpers ---------------- */

  function lk$(id) { return document.getElementById(id); }
  function lkEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---------------- state ---------------- */

  var lkCardIdx = 0;
  var lkKnobs = [1, 1, 1];
  var lkLast = null;
  var lkQuals = {};

  var LK_KNOB_DEFS = [
    { key: "icp", title: "CHARGE PUMP", hint: "loop gain : wider or narrower", vals: LK_ICP, unit: "uA" },
    { key: "r", title: "LOOP RESISTOR", hint: "damping : overshoot control", vals: LK_R, unit: "k" },
    { key: "c", title: "LOOP CAPACITOR", hint: "integration : pull-in muscle", vals: LK_C, unit: "pF" }
  ];

  /* ---------------- UI build ---------------- */

  function lkFmtVal(def, i) {
    return String(def.vals[i]) + def.unit;
  }

  function lkBuildShell() {
    var css = document.createElement("style");
    css.textContent = LK_CSS.join("\n");
    document.head.appendChild(css);

    var box = document.querySelector(".dossier .actions");
    if (box && !lk$("lkBtn")) {
      var b = lkEl("button", "secondary", "Run the Lock Lab");
      b.id = "lkBtn";
      b.addEventListener("click", function () { lk$("lkOverlay").classList.add("open"); });
      box.appendChild(b);
    }

    var ov = lkEl("div", "lk-overlay");
    ov.id = "lkOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "The Lock Lab");
    var panel = lkEl("div", "lk-panel");
    ov.appendChild(panel);
    document.body.appendChild(ov);

    var bar = lkEl("div", "lk-bar");
    var title = lkEl("div", "lk-title", "");
    title.innerHTML = "THE LOCK <b>LAB</b>";
    var close = lkEl("button", "lk-close", "CLOSE [x]");
    close.type = "button";
    bar.appendChild(title); bar.appendChild(close);
    panel.appendChild(bar);

    var body = lkEl("div", "lk-body");
    panel.appendChild(body);

    var sub = lkEl("p", "lk-sub", "");
    sub.innerHTML = "<b>HOW IT WORKS</b> Each card hides a clock fault. " +
      "Set the charge pump, resistor, and capacitor, run the loop, and read " +
      "lock time and jitter against the card's budget. Qualify all three cards " +
      "to sign the TAPEOUT clock certificate. " +
      "One line of advice: a noisy VCO wants a wide loop, a far-off oscillator " +
      "wants a strong one. " +
      "Built for the <a href=\"https://dillingerstaffing.github.io/tapeout/\" target=\"_blank\" rel=\"noopener\">TAPEOUT bring-up bench</a>.";
    body.appendChild(sub);

    var cards = lkEl("div", "lk-cards");
    cards.id = "lkCards";
    body.appendChild(cards);

    var brief = lkEl("p", "lk-brief", "");
    brief.id = "lkBrief";
    body.appendChild(brief);

    var knobs = lkEl("div", "lk-knobs");
    knobs.id = "lkKnobs";
    body.appendChild(knobs);

    var runrow = lkEl("div", "lk-runrow");
    var run = lkEl("button", "lk-run", "RUN THE LOOP");
    run.id = "lkRun";
    run.type = "button";
    run.addEventListener("click", lkOnRun);
    runrow.appendChild(run);
    var tuning = lkEl("span", "lk-tuning", "");
    tuning.id = "lkTuning";
    runrow.appendChild(tuning);
    body.appendChild(runrow);

    var results = lkEl("div", "lk-results");
    results.id = "lkResults";
    body.appendChild(results);

    var verdict = lkEl("div", "lk-verdict", "No run yet. Set the knobs and run the loop.");
    verdict.id = "lkVerdict";
    body.appendChild(verdict);

    var canvas = document.createElement("canvas");
    canvas.className = "lk-scope";
    canvas.id = "lkScope";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Phase error trace");
    body.appendChild(canvas);
    var slab = lkEl("p", "lk-scopelab",
      "SCOPE: phase error in cycles, dashed lines mark the +-0.05 lock window.");
    body.appendChild(slab);

    var qualrow = lkEl("div", "lk-qualrow");
    var qual = lkEl("button", "lk-qual", "QUALIFY THIS CARD");
    qual.id = "lkQual";
    qual.type = "button";
    qual.disabled = true;
    qual.addEventListener("click", lkOnQualify);
    qualrow.appendChild(qual);
    body.appendChild(qualrow);

    var cert = lkEl("div", "lk-cert");
    cert.id = "lkCert";
    body.appendChild(cert);

    close.addEventListener("click", function () { ov.classList.remove("open"); });
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("open"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("open")) ov.classList.remove("open");
    });

    lkRenderCards();
    lkRenderKnobs();
    lkSelectCard(0);
  }

  function lkRenderCards() {
    var wrap = lk$("lkCards");
    wrap.innerHTML = "";
    LK_CARDS.forEach(function (c, i) {
      var tab = lkEl("button", "lk-cardtab" + (i === lkCardIdx ? " sel" : ""), "");
      tab.type = "button";
      tab.setAttribute("aria-pressed", i === lkCardIdx ? "true" : "false");
      var k = lkEl("div", "k", "CARD " + c.id);
      var n = lkEl("div", "n", c.name);
      var q = lkEl("div", "q" + (lkQuals[c.id] ? " done" : ""), "");
      q.textContent = lkQuals[c.id] ? "QUALIFIED " + lkQuals[c.id].grade : "NOT QUALIFIED";
      tab.appendChild(k); tab.appendChild(n); tab.appendChild(q);
      tab.addEventListener("click", function () { lkSelectCard(i); });
      wrap.appendChild(tab);
    });
  }

  function lkRenderKnobs() {
    var wrap = lk$("lkKnobs");
    wrap.innerHTML = "";
    LK_KNOB_DEFS.forEach(function (def, ki) {
      var grp = lkEl("div", "lk-knob", "");
      grp.appendChild(lkEl("h4", null, def.title));
      var hint = lkEl("p", "hint", def.hint);
      grp.appendChild(hint);
      var seg = lkEl("div", "lk-seg", "");
      seg.setAttribute("role", "radiogroup");
      seg.setAttribute("aria-label", def.title);
      def.vals.forEach(function (v, vi) {
        var lab = lkEl("label", "", "");
        var inp = document.createElement("input");
        inp.type = "radio";
        inp.name = "lk-" + def.key;
        inp.checked = lkKnobs[ki] === vi;
        inp.addEventListener("change", function () {
          lkKnobs[ki] = vi;
          lkUpdateTuning();
        });
        var sp = lkEl("span", "", lkFmtVal(def, vi));
        lab.appendChild(inp);
        lab.appendChild(sp);
        seg.appendChild(lab);
      });
      grp.appendChild(seg);
      wrap.appendChild(grp);
    });
    lkUpdateTuning();
  }

  function lkUpdateTuning() {
    var t = lk$("lkTuning");
    if (!t) return;
    t.textContent = "Tuning: " + LK_ICP[lkKnobs[0]] + " uA / " +
      LK_R[lkKnobs[1]] + " kΩ / " + LK_C[lkKnobs[2]] + " pF";
  }

  function lkSelectCard(i) {
    lkCardIdx = i;
    lkLast = null;
    var c = LK_CARDS[i];
    lk$("lkBrief").textContent = "CARD " + c.id + " " + c.name + ": " + c.brief +
      " Budget: lock inside " + c.budget + " steps, jitter under " + c.jmax + " ps.";
    var v = lk$("lkVerdict");
    v.className = "lk-verdict";
    v.textContent = "No run yet. Set the knobs and run the loop.";
    lk$("lkResults").innerHTML = "";
    lk$("lkQual").disabled = true;
    lkDrawScope([]);
    lkRenderCards();
  }

  function lkOnRun() {
    var c = LK_CARDS[lkCardIdx];
    var res = lkSim(lkKnobs[0], lkKnobs[1], lkKnobs[2], c);
    lkLast = res;
    var rbox = lk$("lkResults");
    rbox.innerHTML = "";

    var m1 = lkEl("div", "lk-metric", "");
    m1.appendChild(lkEl("h5", null, "LOCK TIME"));
    var v1 = lkEl("div", "v", String(res.lock));
    m1.appendChild(v1);
    m1.appendChild(lkEl("div", "b", "budget " + res.budget + " steps"));
    rbox.appendChild(m1);

    var m2 = lkEl("div", "lk-metric", "");
    m2.appendChild(lkEl("h5", null, "JITTER"));
    m2.appendChild(lkEl("div", "v", res.jit + " ps"));
    m2.appendChild(lkEl("div", "b", "budget " + res.jmax + " ps"));
    rbox.appendChild(m2);

    var m3 = lkEl("div", "lk-metric", "");
    m3.appendChild(lkEl("h5", null, "GRADE"));
    m3.appendChild(lkEl("div", "v", lkGrade(res)));
    m3.appendChild(lkEl("div", "b", "gold / silver / bronze"));
    rbox.appendChild(m3);

    var v = lk$("lkVerdict");
    if (res.pass) {
      v.className = "lk-verdict pass";
      v.innerHTML = "PASS: inside both budgets.<small>Grade " + lkGrade(res) +
        ". Qualify the card to sign it off.</small>";
    } else {
      v.className = "lk-verdict fail";
      var why = res.lock > res.budget ? "lock too slow" : "jitter over budget";
      v.innerHTML = "FAIL: " + why + ".<small>Move the knobs and run again.</small>";
    }
    /* textContent already set via innerHTML for formatting; keep it honest */
    lkDrawScope(res.trace);
    var q = lk$("lkQual");
    q.disabled = !res.pass;
    q.textContent = lkQuals[c.id] ? "RE-QUALIFY THIS CARD" : "QUALIFY THIS CARD";
  }

  function lkDrawScope(trace) {
    var cv = lk$("lkScope");
    if (!cv) return;
    var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    var W = cv.clientWidth || 600, H = 180;
    cv.width = W * dpr; cv.height = H * dpr;
    var g = cv.getContext("2d");
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    var mid = H / 2, span = 0.5;
    function y(e) { return mid - (e / span) * (H / 2 - 8); }
    g.strokeStyle = "#2a2a30";
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
    g.strokeStyle = "#ff5a1f";
    g.setLineDash([5, 5]);
    [LK_WIN, -LK_WIN].forEach(function (w) {
      g.beginPath(); g.moveTo(0, y(w)); g.lineTo(W, y(w)); g.stroke();
    });
    g.setLineDash([]);
    if (trace && trace.length > 1) {
      g.strokeStyle = "#f2f0eb";
      g.lineWidth = 1.5;
      g.beginPath();
      for (var i = 0; i < trace.length; i++) {
        var x = (i / (trace.length - 1)) * W;
        var yy = y(Math.max(-span, Math.min(span, trace[i])));
        if (i === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
      }
      g.stroke();
    } else {
      g.fillStyle = "#6e6b64";
      g.font = "12px 'IBM Plex Mono', monospace";
      g.fillText("run the loop to draw the trace", 14, mid - 12);
    }
  }

  function lkOnQualify() {
    if (!lkLast || !lkLast.pass) return;
    var c = LK_CARDS[lkCardIdx];
    lkQuals[c.id] = {
      grade: lkGrade(lkLast),
      icp: LK_ICP[lkKnobs[0]], r: LK_R[lkKnobs[1]], c: LK_C[lkKnobs[2]],
      lock: lkLast.lock, jit: lkLast.jit
    };
    lkRenderCards();
    lk$("lkQual").textContent = "RE-QUALIFY THIS CARD";
    if (typeof toast === "function") toast("Card " + c.id + " qualified " + lkQuals[c.id].grade + ".");
    lkMaybeCert();
  }

  function lkMaybeCert() {
    var done = LK_CARDS.every(function (c) { return !!lkQuals[c.id]; });
    var box = lk$("lkCert");
    if (!done) { box.classList.remove("show"); box.innerHTML = ""; return; }
    box.innerHTML = "";
    box.appendChild(lkEl("h4", null, "QUALIFICATION COMPLETE"));
    var p = lkEl("p", null, "");
    p.textContent = "All three cards qualified against their lock and jitter budgets. " +
      "The TAPEOUT bring-up bench accepts these clock settings.";
    box.appendChild(p);
    var dl = lkEl("button", "lk-mini", "DOWNLOAD CERTIFICATE");
    dl.type = "button";
    dl.addEventListener("click", function () {
      lkDownload(lkCertText(lkQuals), "lock-lab-certificate.txt");
      if (typeof toast === "function") toast("Certificate downloaded.");
    });
    box.appendChild(dl);
    box.classList.add("show");
  }

  function lkDownload(text, name) {
    var blob = new Blob([text], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function lkInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    lkBuildShell();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", lkInit);
    } else {
      lkInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      LK: {
        mulberry32: lkMulberry32, wrap: lkWrap, sim: lkSim, grade: lkGrade,
        certText: lkCertText, CARDS: LK_CARDS, ICP: LK_ICP, R: LK_R, C: LK_C,
        FREF: LK_FREF, N: LK_N, STEPS: LK_STEPS, WIN: LK_WIN
      }
    });
  }

})();


/* ================= THE WIRE ROOM (BENCH 15) =================
   UART bring-up bench for the portfolio's RISC-V focus: three harts
   stream real UART frames over a single wire, simulated sample by
   sample at 1 MHz. The receiver is yours: probe the 0x55 sync byte
   to measure the bit cell, match the baud, set parity and stop bits
   per each board's datasheet brief, then capture and decode. Zero
   errors on all three harts signs the bring-up certificate. */

(function () {
  "use strict";

  /* ---------------- pure core: no DOM ---------------- */

  function wrMulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var WR_HZ = 1000000; /* scope sample rate: 1 sample = 1 us */
  var WR_BAUDS = [9600, 19200, 38400, 57600, 115200];
  var WR_BAUD_CELLS = ["104.2", "52.1", "26.0", "17.4", "8.7"]; /* us per bit cell */
  var WR_PARS = ["none", "even", "odd"];
  var WR_PAR_LABELS = ["NONE", "EVEN", "ODD"];
  var WR_STOPS = [1, 2];

  var WR_BOARDS = [
    { id: "A", name: "GOLDEN HART", baud: 9600, parity: "none", stop: 1,
      seed: 6101, noise: 0, msg: "HART0 ONLINE",
      brief: "A known-good hart at a walking pace. Datasheet: 8 data bits, no parity, 1 stop bit. Learn the probe here, then capture and decode." },
    { id: "B", name: "NOISY NEIGHBOR", baud: 38400, parity: "even", stop: 1,
      seed: 6202, noise: 1, msg: "BORN TO BITBANG",
      brief: "A chatty hart with spikes on the wire from a rude neighbor. Datasheet: 8 data bits, parity enabled (the flavor is on the wire), 1 stop bit. The spikes are cosmetic: a mid-bit sampler never sees them." },
    { id: "C", name: "LONG HAUL", baud: 115200, parity: "odd", stop: 2,
      seed: 6303, noise: 0, msg: "SHIP IT QUIETLY",
      brief: "The fast one. Datasheet: 8 data bits, odd parity, 2 stop bits, and acceptance demands the exact framing. A clean decode on the wrong stop count still fails here." }
  ];

  function wrParityBit(b, par) {
    var ones = 0;
    for (var k = 0; k < 8; k++) if ((b >> k) & 1) ones++;
    if (par === "even") return (ones % 2) ? 1 : 0;
    return (ones % 2) ? 0 : 1; /* odd */
  }

  /* Build the wire: dense 1 MHz samples, idle high, start bit low,
     8 data bits LSB first, optional parity, stop bits high, 2 bit
     cells of idle between frames. Frame 0 is always 0x55 (sync).
     Noise spikes land near bit-cell edges only, so a mid-bit
     sampler is immune, exactly as the brief promises. */
  function wrWaveform(board) {
    var bit = WR_HZ / board.baud;
    var bytes = [0x55];
    for (var i = 0; i < board.msg.length; i++) bytes.push(board.msg.charCodeAt(i));
    var sig = [], frames = [], t = 0, idx = 0;
    function push(level, dur) {
      var end = Math.floor(t + dur);
      while (idx < end) { sig[idx] = level; idx++; }
      t += dur;
    }
    push(1, 4 * bit);
    bytes.forEach(function (b) {
      frames.push({ start: idx, byte: b });
      push(0, bit);
      for (var k = 0; k < 8; k++) push((b >> k) & 1, bit);
      if (board.parity !== "none") push(wrParityBit(b, board.parity), bit);
      push(1, board.stop * bit);
      push(1, 2 * bit);
    });
    push(1, 4 * bit);
    if (board.noise) {
      var rnd = wrMulberry32(board.seed);
      var nbitsT = 1 + 8 + (board.parity !== "none" ? 1 : 0) + board.stop;
      for (var f = 0; f < frames.length; f++) {
        var nsp = 1 + Math.floor(rnd() * 2);
        for (var s = 0; s < nsp; s++) {
          var cell = Math.floor(rnd() * nbitsT);
          var frac = rnd() < 0.5 ? rnd() * 0.2 : 0.78 + rnd() * 0.2;
          var at = frames[f].start + Math.floor((cell + frac) * bit);
          var w = 1 + Math.floor(rnd() * 2);
          for (var j = 0; j < w && at + j < sig.length; j++) sig[at + j] = 1 - sig[at + j];
        }
      }
    }
    return { sig: sig, frames: frames, bytes: bytes, bit: bit, n: sig.length };
  }

  /* Sync probe: median edge-to-edge distance inside the 0x55 sync
     byte. 0x55 alternates every bit cell, so the median is the bit
     cell in samples (1 sample = 1 us). Robust against spikes. */
  function wrProbe(wave) {
    var sig = wave.sig, n = sig.length, i, j, k;
    var e0 = -1;
    for (i = 1; i < n; i++) {
      if (sig[i - 1] > 0.5 && sig[i] <= 0.5) { e0 = i; break; }
    }
    if (e0 < 0) return { cell: 0, cellUs: 0 };
    var edges = [e0];
    var limit = e0 + 14 * wave.bit;
    for (j = e0 + 1; j < n && j < limit; j++) {
      if ((sig[j - 1] > 0.5) !== (sig[j] > 0.5)) edges.push(j);
    }
    var gaps = [];
    for (k = 1; k < edges.length; k++) gaps.push(edges[k] - edges[k - 1]);
    gaps.sort(function (a, b) { return a - b; });
    var med = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    return { cell: med, cellUs: med };
  }

  /* The player's software receiver: find falling start edges, sample
     mid-bit per the knob settings, check parity and stop bits. */
  function wrDecode(wave, baudIdx, parIdx, stopIdx) {
    var sig = wave.sig, n = sig.length;
    var bitP = WR_HZ / WR_BAUDS[baudIdx];
    var par = WR_PARS[parIdx], stop = WR_STOPS[stopIdx];
    var frameLen = (1 + 8 + (par !== "none" ? 1 : 0) + stop) * bitP;
    function levelAt(x) {
      var i = Math.round(x);
      if (i < 0) i = 0;
      if (i >= n) i = n - 1;
      return sig[i] > 0.5 ? 1 : 0;
    }
    function findStart(from) {
      var i0 = Math.max(1, Math.floor(from));
      for (var i = i0; i < n; i++) {
        if (sig[i - 1] > 0.5 && sig[i] <= 0.5) return i;
      }
      return -1;
    }
    var bytes = [], parityErr = 0, framingErr = 0, starts = [];
    var s = findStart(0), guard = 0, k, j;
    while (s >= 0 && guard < 48) {
      guard++;
      starts.push(s);
      var b = 0, ones = 0;
      for (k = 0; k < 8; k++) {
        var v = levelAt(s + (1.5 + k) * bitP);
        if (v) { b |= (1 << k); ones++; }
      }
      if (par !== "none") {
        var p = levelAt(s + 9.5 * bitP);
        var want = (par === "even") ? ((ones % 2) ? 1 : 0) : ((ones % 2) ? 0 : 1);
        if (p !== want) parityErr++;
      }
      var sb = 9 + (par !== "none" ? 1 : 0);
      for (j = 0; j < stop; j++) {
        if (!levelAt(s + (sb + 0.5 + j) * bitP)) framingErr++;
      }
      bytes.push(b);
      s = findStart(s + frameLen);
    }
    return { bytes: bytes, parityErr: parityErr, framingErr: framingErr, starts: starts, bitP: bitP };
  }

  function wrTrueIdx(board) {
    return {
      baud: WR_BAUDS.indexOf(board.baud),
      par: WR_PARS.indexOf(board.parity),
      stop: WR_STOPS.indexOf(board.stop)
    };
  }

  function wrGrade(board, wave, dec, baudIdx, parIdx, stopIdx) {
    var ti = wrTrueIdx(board);
    var cfgOk = baudIdx === ti.baud && parIdx === ti.par && stopIdx === ti.stop;
    var countOk = dec.bytes.length === wave.bytes.length;
    var dataOk = countOk && dec.bytes.every(function (b, i) { return b === wave.bytes[i]; });
    var clean = dec.parityErr === 0 && dec.framingErr === 0 && dataOk;
    var why;
    if (clean && cfgOk) {
      why = "PASS: " + dec.bytes.length + "/" + wave.bytes.length +
        " frames, zero errors, exact framing. Qualify this hart to sign it off.";
    } else if (dec.framingErr > 0 || !countOk) {
      why = "FAIL: " + dec.framingErr + " framing errors, " + dec.bytes.length +
        "/" + wave.bytes.length + " frames locked. The baud is off, or the stop-bit count is wrong.";
    } else if (dec.parityErr > 0) {
      why = "FAIL: " + dec.parityErr + " parity errors. The parity flavor is wrong, try another.";
    } else if (!dataOk) {
      why = "FAIL: frames decoded without flag errors but the bytes do not match the wire. The baud is off.";
    } else {
      why = "DECODED CLEAN, but the acceptance spec demands the exact baud, parity, and stop-bit match. Check the datasheet brief.";
    }
    return { pass: clean && cfgOk, clean: clean, cfgOk: cfgOk, why: why };
  }

  function wrAscii(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b >= 32 && b < 127) out += String.fromCharCode(b);
      else out += "[0x" + ("0" + b.toString(16)).slice(-2) + "]";
    }
    return out;
  }

  function wrCfgText(board) {
    var ti = wrTrueIdx(board);
    return WR_BAUDS[ti.baud] + " 8" + WR_PAR_LABELS[ti.par].charAt(0) + WR_STOPS[ti.stop];
  }

  function wrCertText(quals) {
    var lines = [
      "THE WIRE ROOM: UART BRING-UP CERTIFICATE",
      "The Proving Ground, bench 15",
      ""
    ];
    WR_BOARDS.forEach(function (bd) {
      var q = quals[bd.id];
      lines.push("BOARD " + bd.id + " " + bd.name + ": " + wrCfgText(bd) +
        ", " + q.frames + " frames, 0 errors");
      lines.push("  RX: \"" + q.rx + "\"");
    });
    lines.push("");
    lines.push("All three harts decoded with zero errors against the datasheet spec.");
    lines.push("Signed: The Proving Ground");
    return lines.join("\n");
  }

  /* ---------------- bench CSS ---------------- */

  var WR_CSS = [
    ".wr-overlay{position:fixed;inset:0;background:rgba(8,8,10,.82);z-index:9000;display:none;overflow-y:auto;padding:24px 16px;}",
    ".wr-overlay.open{display:block;}",
    ".wr-panel{max-width:860px;margin:0 auto;background:#101014;border:1px solid #2a2a30;border-radius:4px;color:#f2f0eb;font-family:'Space Grotesk',system-ui,sans-serif;}",
    ".wr-bar{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #2a2a30;}",
    ".wr-title{font-size:20px;letter-spacing:.14em;font-weight:700;}",
    ".wr-title b{color:#ff5a1f;}",
    ".wr-close{background:none;border:1px solid #3a3a42;color:#f2f0eb;border-radius:4px;min-height:48px;padding:0 18px;font-family:'IBM Plex Mono',monospace;font-size:13px;cursor:pointer;}",
    ".wr-close:hover{border-color:#ff5a1f;}",
    ".wr-close:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".wr-body{padding:22px;}",
    ".wr-sub{font-size:14px;line-height:1.6;color:#b9b6ae;margin:0 0 20px;}",
    ".wr-sub b{color:#f2f0eb;}",
    ".wr-sub a{color:#ff5a1f;}",
    ".wr-cards{display:flex;gap:10px;margin-bottom:22px;flex-wrap:wrap;}",
    ".wr-cardtab{flex:1;min-width:150px;min-height:56px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;cursor:pointer;font-family:'Space Grotesk',sans-serif;padding:8px 10px;text-align:left;transition:transform .1s,border-color .1s;}",
    ".wr-cardtab:hover{border-color:#ff5a1f;}",
    ".wr-cardtab:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".wr-cardtab.sel{border-color:#ff5a1f;transform:translateY(-2px);}",
    ".wr-cardtab .k{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a877f;letter-spacing:.1em;}",
    ".wr-cardtab .n{font-size:14px;font-weight:700;margin-top:2px;}",
    ".wr-cardtab .q{font-family:'IBM Plex Mono',monospace;font-size:11px;margin-top:4px;color:#8a877f;}",
    ".wr-cardtab .q.done{color:#7dd87d;}",
    ".wr-brief{font-size:13px;color:#b9b6ae;border-left:3px solid #ff5a1f;padding:8px 14px;margin:0 0 22px;line-height:1.55;}",
    ".wr-knobs{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:14px;}",
    ".wr-knob{border:1px solid #2a2a30;border-radius:4px;padding:14px;}",
    ".wr-knob h4{margin:0 0 4px;font-size:12px;letter-spacing:.12em;color:#8a877f;font-weight:700;}",
    ".wr-knob .hint{font-size:12px;color:#6e6b64;margin:0 0 10px;font-family:'IBM Plex Mono',monospace;}",
    ".wr-seg{display:flex;gap:8px;flex-wrap:wrap;}",
    ".wr-seg label{flex:1;min-width:70px;}",
    ".wr-seg input{position:absolute;opacity:0;width:1px;height:1px;}",
    ".wr-seg span{display:flex;align-items:center;justify-content:center;min-height:48px;border:1px solid #3a3a42;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:12px;cursor:pointer;transition:transform .1s,border-color .1s,background .1s;padding:0 8px;text-align:center;}",
    ".wr-seg label:hover span{border-color:#ff5a1f;}",
    ".wr-seg input:checked+span{border-color:#ff5a1f;background:#2a150c;color:#ffb38a;font-weight:700;}",
    ".wr-seg input:focus-visible+span{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".wr-probeout{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#ffb38a;margin:0 0 18px;min-height:18px;}",
    ".wr-runrow{display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;}",
    ".wr-run{min-height:52px;padding:0 28px;border:none;border-radius:4px;background:#ff5a1f;color:#101014;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:15px;letter-spacing:.08em;cursor:pointer;transition:transform .1s;}",
    ".wr-run:hover{transform:translateY(-2px);}",
    ".wr-run:focus-visible{outline:2px solid #fff;outline-offset:2px;}",
    ".wr-run:active{transform:translateY(0);}",
    ".wr-probe{min-height:52px;padding:0 24px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px;letter-spacing:.08em;cursor:pointer;transition:transform .1s,border-color .1s;}",
    ".wr-probe:hover{border-color:#ff5a1f;transform:translateY(-2px);}",
    ".wr-probe:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".wr-tuning{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#8a877f;}",
    ".wr-results{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px;}",
    ".wr-metric{border:1px solid #2a2a30;border-radius:4px;padding:14px;}",
    ".wr-metric h5{margin:0 0 6px;font-size:11px;letter-spacing:.12em;color:#8a877f;font-weight:700;}",
    ".wr-metric .v{font-family:'IBM Plex Mono',monospace;font-size:24px;font-weight:700;}",
    ".wr-metric .b{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#8a877f;margin-top:4px;}",
    ".wr-readout{font-family:'IBM Plex Mono',monospace;font-size:14px;color:#f2f0eb;background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:14px 16px;margin:0 0 14px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;}",
    ".wr-readout .k{color:#8a877f;font-size:11px;letter-spacing:.1em;}",
    ".wr-verdict{font-size:15px;font-weight:700;letter-spacing:.1em;padding:14px;border-radius:4px;text-align:center;margin-bottom:18px;border:1px solid #3a3a42;}",
    ".wr-verdict.pass{border-color:#7dd87d;color:#7dd87d;}",
    ".wr-verdict.fail{border-color:#ff5a1f;color:#ff5a1f;}",
    ".wr-verdict small{display:block;font-weight:400;letter-spacing:0;font-size:12px;color:#b9b6ae;margin-top:6px;}",
    ".wr-scope{width:100%;height:200px;background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;margin-bottom:8px;}",
    ".wr-scopelab{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a877f;margin:0 0 18px;line-height:1.6;}",
    ".wr-qualrow{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px;}",
    ".wr-qual{min-height:52px;padding:0 24px;border:1px solid #7dd87d;background:none;color:#7dd87d;border-radius:4px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px;letter-spacing:.08em;cursor:pointer;}",
    ".wr-qual:hover{background:#12240f;}",
    ".wr-qual:focus-visible{outline:2px solid #7dd87d;outline-offset:2px;}",
    ".wr-qual:disabled{opacity:.4;cursor:default;}",
    ".wr-cert{border:1px solid #7dd87d;border-radius:4px;padding:18px;margin-top:18px;display:none;}",
    ".wr-cert.show{display:block;}",
    ".wr-cert h4{margin:0 0 8px;font-size:14px;letter-spacing:.12em;color:#7dd87d;}",
    ".wr-cert p{font-size:13px;color:#b9b6ae;line-height:1.6;margin:0 0 12px;}",
    ".wr-mini{min-height:48px;padding:0 20px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:12px;cursor:pointer;}",
    ".wr-mini:hover{border-color:#ff5a1f;}",
    ".wr-mini:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    "@media (prefers-reduced-motion:reduce){.wr-cardtab,.wr-run,.wr-probe,.wr-seg span{transition:none;}}"
  ];

  /* ---------------- DOM helpers ---------------- */

  function wr$(id) { return document.getElementById(id); }
  function wrEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---------------- state ---------------- */

  var wrBoardIdx = 0;
  var wrKnobs = [0, 0, 0]; /* baud, parity, stop */
  var wrLast = null; /* {dec, grade} */
  var wrQuals = {};
  var wrWaves = {}; /* board id -> waveform cache */

  function wrWave(board) {
    if (!wrWaves[board.id]) wrWaves[board.id] = wrWaveform(board);
    return wrWaves[board.id];
  }

  /* ---------------- UI build ---------------- */

  function wrFmtBaud(i) { return WR_BAUDS[i] + " \u00B7 " + WR_BAUD_CELLS[i] + "u"; }

  function wrBuildShell() {
    var css = document.createElement("style");
    css.textContent = WR_CSS.join("\n");
    document.head.appendChild(css);

    var box = document.querySelector(".dossier .actions");
    if (box && !wr$("wrBtn")) {
      var b = wrEl("button", "secondary", "Run the Wire Room");
      b.id = "wrBtn";
      b.addEventListener("click", function () {
        wr$("wrOverlay").classList.add("open");
        wrDrawScope();
      });
      box.appendChild(b);
    }

    var ov = wrEl("div", "wr-overlay");
    ov.id = "wrOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "The Wire Room");
    var panel = wrEl("div", "wr-panel");
    ov.appendChild(panel);
    document.body.appendChild(ov);

    var bar = wrEl("div", "wr-bar");
    var title = wrEl("div", "wr-title", "");
    title.innerHTML = "THE WIRE <b>ROOM</b>";
    var close = wrEl("button", "wr-close", "CLOSE [x]");
    close.type = "button";
    bar.appendChild(title); bar.appendChild(close);
    panel.appendChild(bar);

    var body = wrEl("div", "wr-body");
    panel.appendChild(body);

    var sub = wrEl("p", "wr-sub", "");
    sub.innerHTML = "<b>HOW IT WORKS</b> Each hart streams its message over one wire, " +
      "real UART frames at 1 MHz on the scope. Frame 0 is always 0x55 (sync): probe it " +
      "to measure the bit cell, match the baud, set parity and stop bits per the " +
      "datasheet brief, then capture and decode. Zero errors on all three harts signs " +
      "the bring-up certificate. " +
      "Built for the <a href=\"https://dillingerstaffing.github.io/portfolio/\" target=\"_blank\" rel=\"noopener\">RISC-V portfolio</a> bring-up bench.";
    body.appendChild(sub);

    var cards = wrEl("div", "wr-cards");
    cards.id = "wrCards";
    body.appendChild(cards);

    var brief = wrEl("p", "wr-brief", "");
    brief.id = "wrBrief";
    body.appendChild(brief);

    var knobs = wrEl("div", "wr-knobs");
    knobs.id = "wrKnobs";
    body.appendChild(knobs);

    var probeout = wrEl("p", "wr-probeout", "No probe yet. The sync byte is 0x55, sent first on every hart.");
    probeout.id = "wrProbeOut";
    body.appendChild(probeout);

    var runrow = wrEl("div", "wr-runrow");
    var probe = wrEl("button", "wr-probe", "PROBE SYNC BYTE");
    probe.id = "wrProbeBtn";
    probe.type = "button";
    probe.addEventListener("click", wrOnProbe);
    runrow.appendChild(probe);
    var run = wrEl("button", "wr-run", "CAPTURE + DECODE");
    run.id = "wrRun";
    run.type = "button";
    run.addEventListener("click", wrOnRun);
    runrow.appendChild(run);
    var tuning = wrEl("span", "wr-tuning", "");
    tuning.id = "wrTuning";
    runrow.appendChild(tuning);
    body.appendChild(runrow);

    var results = wrEl("div", "wr-results");
    results.id = "wrResults";
    body.appendChild(results);

    var readout = wrEl("div", "wr-readout", "");
    readout.id = "wrReadout";
    var rk = wrEl("div", "k", "RX");
    readout.appendChild(rk);
    var rv = wrEl("div", "", "No capture yet.");
    rv.id = "wrRxText";
    readout.appendChild(rv);
    body.appendChild(readout);

    var verdict = wrEl("div", "wr-verdict", "No capture yet. Set the receiver and capture.");
    verdict.id = "wrVerdict";
    body.appendChild(verdict);

    var canvas = document.createElement("canvas");
    canvas.className = "wr-scope";
    canvas.id = "wrScope";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Logic analyzer trace of the UART wire");
    body.appendChild(canvas);
    var slab = wrEl("p", "wr-scopelab",
      "SCOPE: first three frames on the wire. Faint verticals are your receiver's bit grid " +
      "from the trigger edge, dots are the mid-bit sample points. An aligned grid means the baud is right.");
    body.appendChild(slab);

    var qualrow = wrEl("div", "wr-qualrow");
    var qual = wrEl("button", "wr-qual", "QUALIFY THIS HART");
    qual.id = "wrQual";
    qual.type = "button";
    qual.disabled = true;
    qual.addEventListener("click", wrOnQualify);
    qualrow.appendChild(qual);
    body.appendChild(qualrow);

    var cert = wrEl("div", "wr-cert");
    cert.id = "wrCert";
    body.appendChild(cert);

    close.addEventListener("click", function () { ov.classList.remove("open"); });
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("open"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("open")) ov.classList.remove("open");
    });

    wrRenderCards();
    wrRenderKnobs();
    wrSelectBoard(0);
  }

  function wrRenderCards() {
    var wrap = wr$("wrCards");
    wrap.innerHTML = "";
    WR_BOARDS.forEach(function (c, i) {
      var tab = wrEl("button", "wr-cardtab" + (i === wrBoardIdx ? " sel" : ""), "");
      tab.type = "button";
      tab.setAttribute("aria-pressed", i === wrBoardIdx ? "true" : "false");
      tab.appendChild(wrEl("div", "k", "BOARD " + c.id));
      tab.appendChild(wrEl("div", "n", c.name));
      var q = wrEl("div", "q" + (wrQuals[c.id] ? " done" : ""), "");
      q.textContent = wrQuals[c.id] ? "QUALIFIED" : "NOT QUALIFIED";
      tab.appendChild(q);
      tab.addEventListener("click", function () { wrSelectBoard(i); });
      wrap.appendChild(tab);
    });
  }

  var WR_KNOB_DEFS = [
    { key: "baud", title: "BAUD", hint: "receiver bit rate : probe the sync byte",
      labels: [0, 1, 2, 3, 4].map(wrFmtBaud) },
    { key: "par", title: "PARITY", hint: "parity flavor : datasheet plus the wire",
      labels: WR_PAR_LABELS.slice() },
    { key: "stop", title: "STOP BITS", hint: "exact framing : the spec is strict",
      labels: ["1", "2"] }
  ];

  function wrRenderKnobs() {
    var wrap = wr$("wrKnobs");
    wrap.innerHTML = "";
    WR_KNOB_DEFS.forEach(function (def, ki) {
      var grp = wrEl("div", "wr-knob", "");
      grp.appendChild(wrEl("h4", null, def.title));
      grp.appendChild(wrEl("p", "hint", def.hint));
      var seg = wrEl("div", "wr-seg", "");
      seg.setAttribute("role", "radiogroup");
      seg.setAttribute("aria-label", def.title);
      def.labels.forEach(function (lab, vi) {
        var l = wrEl("label", "", "");
        var inp = document.createElement("input");
        inp.type = "radio";
        inp.name = "wr-" + def.key;
        inp.checked = wrKnobs[ki] === vi;
        inp.addEventListener("change", function () {
          wrKnobs[ki] = vi;
          wrLast = null;
          wr$("wrQual").disabled = true;
          wrUpdateTuning();
          wrDrawScope();
        });
        var sp = wrEl("span", "", lab);
        l.appendChild(inp);
        l.appendChild(sp);
        seg.appendChild(l);
      });
      grp.appendChild(seg);
      wrap.appendChild(grp);
    });
    wrUpdateTuning();
  }

  function wrUpdateTuning() {
    var t = wr$("wrTuning");
    if (!t) return;
    t.textContent = "Receiver: " + WR_BAUDS[wrKnobs[0]] + " baud / " +
      WR_PAR_LABELS[wrKnobs[1]] + " / " + WR_STOPS[wrKnobs[2]] + " stop";
  }

  function wrSelectBoard(i) {
    wrBoardIdx = i;
    wrLast = null;
    var c = WR_BOARDS[i];
    wr$("wrBrief").textContent = "BOARD " + c.id + " " + c.name + ": " + c.brief;
    var v = wr$("wrVerdict");
    v.className = "wr-verdict";
    v.textContent = "No capture yet. Set the receiver and capture.";
    wr$("wrResults").innerHTML = "";
    wr$("wrRxText").textContent = "No capture yet.";
    wr$("wrProbeOut").textContent = "No probe yet. The sync byte is 0x55, sent first on every hart.";
    wr$("wrQual").disabled = true;
    wrRenderCards();
    wrDrawScope();
  }

  function wrOnProbe() {
    var c = WR_BOARDS[wrBoardIdx];
    var wave = wrWave(c);
    var p = wrProbe(wave);
    var cells = WR_BAUDS.map(function (b, i) { return b + "->" + WR_BAUD_CELLS[i] + "u"; }).join(",  ");
    wr$("wrProbeOut").textContent = "SYNC CELL measured approx " + p.cellUs.toFixed(1) +
      " us. Standard cells: " + cells + ". Match the nearest baud.";
    if (typeof toast === "function") toast("Sync cell approx " + p.cellUs.toFixed(1) + " us.");
  }

  function wrOnRun() {
    var c = WR_BOARDS[wrBoardIdx];
    var wave = wrWave(c);
    var dec = wrDecode(wave, wrKnobs[0], wrKnobs[1], wrKnobs[2]);
    var g = wrGrade(c, wave, dec, wrKnobs[0], wrKnobs[1], wrKnobs[2]);
    wrLast = { dec: dec, grade: g };

    var rbox = wr$("wrResults");
    rbox.innerHTML = "";
    var m1 = wrEl("div", "wr-metric", "");
    m1.appendChild(wrEl("h5", null, "FRAMES"));
    m1.appendChild(wrEl("div", "v", dec.bytes.length + "/" + wave.bytes.length));
    m1.appendChild(wrEl("div", "b", "locked on the wire"));
    rbox.appendChild(m1);
    var m2 = wrEl("div", "wr-metric", "");
    m2.appendChild(wrEl("h5", null, "PARITY ERRORS"));
    m2.appendChild(wrEl("div", "v", String(dec.parityErr)));
    m2.appendChild(wrEl("div", "b", "bad parity bits"));
    rbox.appendChild(m2);
    var m3 = wrEl("div", "wr-metric", "");
    m3.appendChild(wrEl("h5", null, "FRAMING ERRORS"));
    m3.appendChild(wrEl("div", "v", String(dec.framingErr)));
    m3.appendChild(wrEl("div", "b", "stop bits not high"));
    rbox.appendChild(m3);

    wr$("wrRxText").textContent = "RX: \"" + wrAscii(dec.bytes) + "\"";

    var v = wr$("wrVerdict");
    if (g.pass) {
      v.className = "wr-verdict pass";
      v.innerHTML = "PASS: " + dec.bytes.length + "/" + wave.bytes.length +
        " frames, zero errors, exact framing.<small>Qualify this hart to sign it off.</small>";
    } else {
      v.className = "wr-verdict fail";
      v.innerHTML = g.why.replace(/^FAIL: /, "FAIL: ").replace(/^DECODED CLEAN,/, "HOLD:") +
        "<small>Adjust the receiver and capture again.</small>";
    }
    wrDrawScope(dec);
    var q = wr$("wrQual");
    q.disabled = !g.pass;
    q.textContent = wrQuals[c.id] ? "RE-QUALIFY THIS HART" : "QUALIFY THIS HART";
  }

  /* Logic-analyzer view: first three frames, the receiver's bit grid
     from the trigger edge, and mid-bit sample dots per the knobs. */
  function wrDrawScope(dec) {
    var cv = wr$("wrScope");
    if (!cv || typeof cv.getContext !== "function") return;
    var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    var W = cv.clientWidth || 600, H = 200;
    cv.width = W * dpr; cv.height = H * dpr;
    var g = cv.getContext("2d");
    if (!g || typeof g.scale !== "function") return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);

    var c = WR_BOARDS[wrBoardIdx];
    var wave = wrWave(c);
    var bit = wave.bit;
    var bitP = WR_HZ / WR_BAUDS[wrKnobs[0]];
    var x0 = Math.max(0, wave.frames[0].start - bit);
    var x1 = wave.frames[2].start + 14 * bit;
    function X(s) { return ((s - x0) / (x1 - x0)) * W; }
    function Y(v) { return v ? 34 : H - 34; }

    g.strokeStyle = "#1c1c22";
    g.lineWidth = 1;
    g.setLineDash([4, 4]);
    [1, 0].forEach(function (v) {
      g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(W, Y(v)); g.stroke();
    });
    g.setLineDash([]);

    /* receiver bit grid from the trigger edge */
    var anchor = wave.frames[0].start;
    g.strokeStyle = "rgba(255,90,31,0.22)";
    g.lineWidth = 1;
    for (var gx = anchor; gx <= x1; gx += bitP) {
      var px = X(gx);
      if (px < 0 || px > W) continue;
      g.beginPath(); g.moveTo(px, 20); g.lineTo(px, H - 20); g.stroke();
    }

    /* the wire */
    g.strokeStyle = "#ff5a1f";
    g.lineWidth = 2;
    g.beginPath();
    var i0 = Math.max(0, Math.floor(x0)), i1 = Math.min(wave.n - 1, Math.ceil(x1));
    var first = true, prev = 1;
    for (var i = i0; i <= i1; i++) {
      var vv = wave.sig[i] > 0.5 ? 1 : 0;
      var xx = X(i), yy = Y(vv);
      if (first) { g.moveTo(xx, yy); first = false; }
      else {
        if (vv !== prev) { g.lineTo(xx, Y(prev)); }
        g.lineTo(xx, yy);
      }
      prev = vv;
    }
    g.stroke();

    /* mid-bit sample dots for the first frame, per the knobs */
    var par = WR_PARS[wrKnobs[1]], stop = WR_STOPS[wrKnobs[2]];
    var nbits = 1 + 8 + (par !== "none" ? 1 : 0) + stop;
    g.fillStyle = "#ffb38a";
    for (var bIdx = 1; bIdx < nbits; bIdx++) {
      var sx = X(anchor + (bIdx + 0.5) * bitP);
      if (sx < 0 || sx > W) continue;
      var lvl = 0;
      if (dec && dec.starts.length) {
        var si = Math.round(dec.starts[0] + (bIdx + 0.5) * bitP);
        if (si >= 0 && si < wave.n) lvl = wave.sig[si] > 0.5 ? 1 : 0;
      }
      g.beginPath();
      g.arc(sx, Y(lvl), 3, 0, Math.PI * 2);
      g.fill();
    }

    /* trigger marker */
    g.fillStyle = "#7dd87d";
    g.beginPath();
    g.moveTo(X(anchor), 8); g.lineTo(X(anchor) + 7, 18); g.lineTo(X(anchor) - 7, 18);
    g.fill();

    g.fillStyle = "#6e6b64";
    g.font = "11px 'IBM Plex Mono', monospace";
    g.fillText("0 us", 8, 16);
    var total = Math.round((x1 - x0));
    g.fillText("approx " + total + " us", W - 110, 16);
  }

  function wrOnQualify() {
    if (!wrLast || !wrLast.grade.pass) return;
    var c = WR_BOARDS[wrBoardIdx];
    wrQuals[c.id] = {
      frames: wrLast.dec.bytes.length,
      rx: wrAscii(wrLast.dec.bytes)
    };
    wrRenderCards();
    wrMaybeCert();
    wr$("wrQual").textContent = "RE-QUALIFY THIS HART";
    if (typeof toast === "function") toast("Board " + c.id + " qualified.");
  }

  function wrMaybeCert() {
    var done = WR_BOARDS.every(function (c) { return !!wrQuals[c.id]; });
    var box = wr$("wrCert");
    if (!done) { box.classList.remove("show"); box.innerHTML = ""; return; }
    box.innerHTML = "";
    box.appendChild(wrEl("h4", null, "BRING-UP COMPLETE"));
    var p = wrEl("p", null, "");
    p.textContent = "All three harts decoded with zero errors against the datasheet spec. " +
      "The RISC-V bring-up bench accepts these receiver settings.";
    box.appendChild(p);
    var dl = wrEl("button", "wr-mini", "DOWNLOAD CERTIFICATE");
    dl.type = "button";
    dl.addEventListener("click", function () {
      wrDownload(wrCertText(wrQuals), "wire-room-certificate.txt");
      if (typeof toast === "function") toast("Certificate downloaded.");
    });
    box.appendChild(dl);
    box.classList.add("show");
  }

  function wrDownload(text, name) {
    var blob = new Blob([text], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function wrInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    wrBuildShell();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", wrInit);
    } else {
      wrInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      WR: {
        mulberry32: wrMulberry32, waveform: wrWaveform, probe: wrProbe,
        decode: wrDecode, grade: wrGrade, ascii: wrAscii,
        certText: wrCertText, cfgText: wrCfgText, boards: WR_BOARDS,
        bauds: WR_BAUDS, pars: WR_PARS, stops: WR_STOPS
      }
    });
  }

})();

/* ================= THE POWER TREE (BENCH 16) =================
   GPU power-sequencing bench for TAPEOUT bring-up: five rails must
   come up in dependency order with real ramp physics (first-order
   step response), Power-Good thresholds, sequencing violations,
   PG timeouts, and UVLO faults. Three boards: one golden, one with
   a weak core VRM (sluggish ramp), one with undersized input bulk
   caps (input sag under core load). Diagnose from the scope and the
   event log, apply the rework the data convicts, qualify all three. */

(function () {
  "use strict";

  /* ---------------- pure core: no DOM ---------------- */

  var PT_RAILS = [
    { id: "v12", name: "12V_IN",   v: 12.0, tau: 15, pre: [] },
    { id: "v5",  name: "5V_AUX",   v: 5.0,  tau: 20, pre: ["v12"] },
    { id: "v33", name: "3V3_IO",   v: 3.3,  tau: 25, pre: ["v5"] },
    { id: "v18", name: "1V8_MGT",  v: 1.8,  tau: 30, pre: ["v33"] },
    { id: "v08", name: "0V8_CORE", v: 0.8,  tau: 40, pre: ["v18", "v12"] }
  ];
  var PT_COLORS = { v12: "#ff5a1f", v5: "#e8a33d", v33: "#7dd87d", v18: "#6fb3ff", v08: "#c792ea" };
  var PT_T = 2000;        /* simulation horizon, ms */
  var PT_PG_WINDOW = 500; /* PG must assert within this after enable */
  var PT_PAR_RUNS = 6;

  var PT_BOARDS = [
    { id: "A", name: "GOLDEN UNIT",
      brief: "Fresh from the fab and believed healthy. The sequencing spec is unforgiving though: a rail may only enable after every rail it depends on is Power Good, and the sequencer counts each enable from the previous enable, not from Power Good. Find the delay that satisfies every dependency, then prove it on the scope." },
    { id: "B", name: "TIRED VRM",
      brief: "This card boots when it feels like it. The traveler says the 0.8V core VRM came from a budget reel and the ramp looks sluggish on the shop scope. A rail that cannot reach Power Good inside its window holds the whole tree in reset. Decide from the data whether the VRM is the culprit, and rework only what the data convicts." },
    { id: "C", name: "SAGGING INPUT",
      brief: "Passes cold, fails warm, or the other way around, nobody agrees. What the scope caught once: the 12V input dips hard the instant the core VRM kicks in, and the dip drags the tree under lockout. The bulk caps look undersized for the inrush. Prove the sag on the trace, then fix what the data convicts." }
  ];

  function ptRailById(id) {
    for (var i = 0; i < PT_RAILS.length; i++)
      if (PT_RAILS[i].id === id) return PT_RAILS[i];
    return null;
  }

  /* Run the power tree. order: rail ids in enable order. delayMs:
     ms between consecutive enables. reworks: {vrm, caps} booleans.
     Returns {pass, fail, events, pgT, tEn, bootTime, traces}. */
  function ptSim(board, order, delayMs, reworks) {
    var rails = {};
    PT_RAILS.forEach(function (r) { rails[r.id] = r; });
    var tau = {};
    PT_RAILS.forEach(function (r) { tau[r.id] = r.tau; });
    if (board.id === "B" && !reworks.vrm) tau.v08 = 350; /* weak VRM: sluggish ramp */
    var tEn = {};
    order.forEach(function (id, i) { tEn[id] = i * delayMs; });
    var sagAmp = 0, sagTau = 120, tCore = tEn.v08;
    if (board.id === "C") sagAmp = reworks.caps ? 0.2 : 1.6; /* undersized bulk caps */

    function volt(id, t) {
      var r = rails[id], te = tEn[id];
      if (t < te) return 0;
      var v = r.v * (1 - Math.exp(-(t - te) / tau[id]));
      if (id === "v12" && sagAmp > 0 && t >= tCore)
        v -= sagAmp * Math.exp(-(t - tCore) / sagTau);
      return v;
    }

    /* Power-Good time per rail: first ms at or above 95% of target. */
    var pgT = {};
    PT_RAILS.forEach(function (r) {
      var th = 0.95 * r.v, te = tEn[r.id], hit = -1;
      for (var t = te; t <= PT_T; t++) {
        if (volt(r.id, t) >= th) { hit = t; break; }
      }
      pgT[r.id] = hit;
    });

    var events = [];
    events.push({ t: 0, txt: "sequencer start: enable order " +
      order.map(function (id) { return rails[id].name; }).join(" > ") +
      ", " + delayMs + "ms between enables" });

    var fail = null;
    function noteFail(f) { if (!fail || f.t < fail.t) fail = f; }

    /* 1. sequencing: every prerequisite must be PG before this rail enables */
    order.forEach(function (id) {
      var r = rails[id];
      r.pre.forEach(function (pid) {
        if (pgT[pid] < 0 || pgT[pid] > tEn[id]) {
          var e = { t: tEn[id], txt: "SEQUENCE VIOLATION: " + r.name +
            " enabled at t=" + tEn[id] + "ms while " + rails[pid].name +
            " is not Power Good (PG at t=" + (pgT[pid] < 0 ? "never" : pgT[pid]) + "ms). " +
            "Enabling out of order risks latch-up: hard fail." };
          events.push(e);
          noteFail({ t: tEn[id], kind: "seq", txt: e.txt });
        }
      });
    });

    /* 2. PG timeout, plus the clean PG events */
    PT_RAILS.forEach(function (r) {
      var te = tEn[r.id];
      if (pgT[r.id] < 0 || pgT[r.id] - te > PT_PG_WINDOW) {
        var vAt = volt(r.id, Math.min(te + PT_PG_WINDOW, PT_T));
        var e2 = { t: te + PT_PG_WINDOW, txt: "PG TIMEOUT: " + r.name +
          " reached only " + vAt.toFixed(2) + "V after " + PT_PG_WINDOW +
          "ms (needs " + (0.95 * r.v).toFixed(2) + "V). The tree stays in reset." };
        events.push(e2);
        noteFail({ t: te + PT_PG_WINDOW, kind: "timeout", txt: e2.txt });
      } else {
        events.push({ t: pgT[r.id], txt: r.name + " Power Good at t=" + pgT[r.id] +
          "ms (" + (0.95 * r.v).toFixed(2) + "V threshold)" });
      }
    });

    /* 3. UVLO: after PG, a dip under 92% of target is a hard fail */
    PT_RAILS.forEach(function (r) {
      if (pgT[r.id] < 0) return;
      var floor = 0.92 * r.v;
      for (var t = pgT[r.id]; t <= PT_T; t++) {
        var vv = volt(r.id, t);
        if (vv < floor) {
          var e3 = { t: t, txt: "UVLO: " + r.name + " dipped to " + vv.toFixed(2) +
            "V (floor " + floor.toFixed(2) + "V). Under-voltage lockout trips, tree collapses." };
          events.push(e3);
          noteFail({ t: t, kind: "uvlo", txt: e3.txt });
          break;
        }
      }
    });

    events.sort(function (a, b) { return a.t - b.t; });

    /* scope traces: percent of target, sampled every 2ms */
    var traces = {};
    PT_RAILS.forEach(function (r) {
      var a = [];
      for (var t = 0; t <= PT_T; t += 2) a.push(volt(r.id, t) / r.v * 100);
      traces[r.id] = a;
    });

    var boot = -1;
    if (!fail) {
      boot = 0;
      PT_RAILS.forEach(function (r) { if (pgT[r.id] > boot) boot = pgT[r.id]; });
      events.push({ t: boot, txt: "RESET RELEASED at t=" + boot +
        "ms: every rail Power Good, board boots clean." });
      events.sort(function (a, b) { return a.t - b.t; });
    }

    return {
      pass: !fail, fail: fail, events: events, pgT: pgT, tEn: tEn,
      tau: tau, sagAmp: sagAmp, bootTime: boot, traces: traces
    };
  }

  function ptCertText(quals, runs) {
    var L = [];
    L.push("THE PROVING GROUND");
    L.push("Bench 16: The Power Tree");
    L.push("GPU power-sequencing bring-up certificate");
    L.push("");
    PT_BOARDS.forEach(function (b) {
      var q = quals[b.id];
      L.push("BOARD " + b.id + " " + b.name + ": " +
        (q ? "SIGNED OFF, reset released at t=" + q.boot + "ms, " +
          "order " + q.order.join(" > ") + ", delay " + q.delay + "ms, rework: " + q.rework :
          "not signed off"));
    });
    L.push("");
    L.push("Total sequencer runs: " + runs + " (par " + PT_PAR_RUNS + ")");
    L.push("All three boards bring up clean: sequencing, Power Good, and UVLO verified.");
    return L.join("\n");
  }

  /* ---------------- state ---------------- */

  var ptBoardIdx = 0;
  var ptOrder = ["v12", "v5", "v33", "v18", "v08"];
  var ptDelay = 40;
  var ptReworks = {}; /* boardId -> {vrm:bool, caps:bool} */
  var ptLast = null;  /* last run: {grade, boardId} */
  var ptQuals = {};   /* boardId -> {boot, order, delay, rework, traces} */
  var ptRuns = 0;

  function ptEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function pt$(id) { return document.getElementById(id); }
  function ptRework(boardId) {
    if (!ptReworks[boardId]) ptReworks[boardId] = { vrm: false, caps: false };
    return ptReworks[boardId];
  }
  function ptBoard() { return PT_BOARDS[ptBoardIdx]; }

  /* ---------------- UI build ---------------- */

  var PT_CSS = [
    ".pt-overlay{position:fixed;inset:0;background:rgba(8,8,10,.82);z-index:9000;display:none;overflow-y:auto;padding:24px 16px;}",
    ".pt-overlay.open{display:block;}",
    ".pt-panel{max-width:860px;margin:0 auto;background:#101014;border:1px solid #2a2a30;border-radius:4px;color:#f2f0eb;font-family:'Space Grotesk',system-ui,sans-serif;}",
    ".pt-bar{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #2a2a30;}",
    ".pt-title{font-size:20px;letter-spacing:.14em;font-weight:700;}",
    ".pt-title b{color:#ff5a1f;}",
    ".pt-close{background:none;border:1px solid #3a3a42;color:#f2f0eb;border-radius:4px;min-height:48px;padding:0 18px;font-family:'IBM Plex Mono',monospace;font-size:13px;cursor:pointer;}",
    ".pt-close:hover{border-color:#ff5a1f;}",
    ".pt-close:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".pt-body{padding:22px;}",
    ".pt-sub{font-size:14px;line-height:1.6;color:#b9b6ae;margin:0 0 20px;}",
    ".pt-sub b{color:#f2f0eb;}",
    ".pt-sub a{color:#ff5a1f;}",
    ".pt-cards{display:flex;gap:10px;margin-bottom:22px;flex-wrap:wrap;}",
    ".pt-cardtab{flex:1;min-width:150px;min-height:56px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;cursor:pointer;font-family:'Space Grotesk',sans-serif;padding:8px 10px;text-align:left;transition:transform .1s,border-color .1s;}",
    ".pt-cardtab:hover{border-color:#ff5a1f;}",
    ".pt-cardtab:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".pt-cardtab.sel{border-color:#ff5a1f;transform:translateY(-2px);}",
    ".pt-cardtab .k{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a877f;letter-spacing:.1em;}",
    ".pt-cardtab .n{font-size:14px;font-weight:700;margin-top:2px;}",
    ".pt-cardtab .q{font-family:'IBM Plex Mono',monospace;font-size:11px;margin-top:4px;color:#8a877f;}",
    ".pt-cardtab .q.done{color:#7dd87d;}",
    ".pt-brief{font-size:13px;color:#b9b6ae;border-left:3px solid #ff5a1f;padding:8px 14px;margin:0 0 22px;line-height:1.55;}",
    ".pt-sec{font-size:12px;letter-spacing:.14em;color:#8a877f;font-weight:700;margin:0 0 10px;text-transform:uppercase;}",
    ".pt-order{display:flex;flex-direction:column;gap:8px;margin-bottom:8px;}",
    ".pt-row{display:flex;align-items:center;gap:10px;border:1px solid #2a2a30;border-radius:4px;padding:8px 12px;background:#16161b;min-height:56px;}",
    ".pt-pos{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#ff5a1f;min-width:20px;}",
    ".pt-rn{font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;min-width:86px;}",
    ".pt-rv{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#b9b6ae;min-width:56px;}",
    ".pt-pre{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#6e6b64;flex:1;}",
    ".pt-mv{min-height:48px;min-width:64px;border:1px solid #3a3a42;background:#0a0a0d;color:#f2f0eb;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:12px;cursor:pointer;}",
    ".pt-mv:hover:not(:disabled){border-color:#ff5a1f;}",
    ".pt-mv:disabled{opacity:.3;cursor:default;}",
    ".pt-mv:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".pt-hint{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#6e6b64;margin:0 0 22px;line-height:1.6;}",
    ".pt-delayrow{display:flex;align-items:center;gap:14px;margin-bottom:8px;flex-wrap:wrap;}",
    ".pt-delayrow input[type=range]{flex:1;min-width:200px;min-height:48px;accent-color:#ff5a1f;}",
    ".pt-delayrow input[type=range]:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".pt-delayval{font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:700;color:#ff5a1f;min-width:80px;}",
    ".pt-rework{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;}",
    ".pt-rw{flex:1;min-width:220px;min-height:52px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:13px;letter-spacing:.06em;cursor:pointer;padding:8px 12px;}",
    ".pt-rw:hover{border-color:#ff5a1f;}",
    ".pt-rw:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".pt-rw.on{border-color:#7dd87d;color:#7dd87d;}",
    ".pt-rw small{display:block;font-weight:400;font-size:11px;color:#8a877f;letter-spacing:0;margin-top:2px;font-family:'IBM Plex Mono',monospace;}",
    ".pt-runrow{display:flex;gap:12px;align-items:center;margin:6px 0 20px;flex-wrap:wrap;}",
    ".pt-run{min-height:52px;padding:0 28px;border:none;border-radius:4px;background:#ff5a1f;color:#101014;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:15px;letter-spacing:.08em;cursor:pointer;transition:transform .1s;}",
    ".pt-run:hover{transform:translateY(-2px);}",
    ".pt-run:focus-visible{outline:2px solid #fff;outline-offset:2px;}",
    ".pt-run:active{transform:translateY(0);}",
    ".pt-qual{min-height:52px;padding:0 24px;border:1px solid #7dd87d;background:none;color:#7dd87d;border-radius:4px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px;letter-spacing:.08em;cursor:pointer;}",
    ".pt-qual:hover:not(:disabled){background:#12240f;}",
    ".pt-qual:disabled{opacity:.35;cursor:default;}",
    ".pt-qual:focus-visible{outline:2px solid #7dd87d;outline-offset:2px;}",
    ".pt-runs{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#8a877f;}",
    ".pt-log{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#f2f0eb;background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:14px 16px;margin:0 0 14px;max-height:220px;overflow-y:auto;line-height:1.7;white-space:pre-wrap;}",
    ".pt-log .bad{color:#ff5a1f;}",
    ".pt-log .good{color:#7dd87d;}",
    ".pt-log .dim{color:#8a877f;}",
    ".pt-verdict{font-size:15px;font-weight:700;letter-spacing:.1em;padding:14px;border-radius:4px;text-align:center;margin-bottom:18px;border:1px solid #3a3a42;}",
    ".pt-verdict.pass{border-color:#7dd87d;color:#7dd87d;}",
    ".pt-verdict.fail{border-color:#ff5a1f;color:#ff5a1f;}",
    ".pt-verdict small{display:block;font-weight:400;letter-spacing:0;font-size:12px;color:#b9b6ae;margin-top:6px;}",
    ".pt-scope{width:100%;height:200px;background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;margin-bottom:8px;}",
    ".pt-legend{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;}",
    ".pt-leg{display:flex;align-items:center;gap:6px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#b9b6ae;}",
    ".pt-sw{width:14px;height:8px;border-radius:2px;}",
    ".pt-scopelab{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a877f;margin:0 0 18px;line-height:1.6;}",
    ".pt-cert{border:1px solid #7dd87d;border-radius:4px;padding:18px;margin-top:6px;display:none;}",
    ".pt-cert.show{display:block;}",
    ".pt-cert h4{margin:0 0 8px;font-size:15px;letter-spacing:.12em;color:#7dd87d;}",
    ".pt-cert p{margin:0 0 12px;font-size:13px;color:#b9b6ae;line-height:1.6;}",
    ".pt-mini{min-height:48px;padding:0 18px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:12px;cursor:pointer;margin-right:10px;margin-bottom:8px;}",
    ".pt-mini:hover{border-color:#ff5a1f;}",
    ".pt-mini:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    "@media (prefers-reduced-motion: reduce){.pt-cardtab,.pt-run{transition:none;}}",
    "@media (max-width:640px){.pt-pre{display:none;}.pt-rn{min-width:0;}}"
  ].join("\n");

  function ptBuildShell() {
    var css = document.createElement("style");
    css.textContent = PT_CSS;
    document.head.appendChild(css);

    var box = document.querySelector(".dossier .actions");
    if (box && !pt$("ptBtn")) {
      var b = ptEl("button", "secondary", "Run the Power Tree");
      b.id = "ptBtn";
      b.addEventListener("click", function () {
        pt$("ptOverlay").classList.add("open");
        ptDrawScope();
      });
      box.appendChild(b);
    }

    var ov = ptEl("div", "pt-overlay");
    ov.id = "ptOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "The Power Tree");
    var panel = ptEl("div", "pt-panel");
    ov.appendChild(panel);
    document.body.appendChild(ov);

    var bar = ptEl("div", "pt-bar");
    var title = ptEl("div", "pt-title", "");
    title.innerHTML = "THE POWER <b>TREE</b>";
    var close = ptEl("button", "pt-close", "CLOSE [x]");
    close.type = "button";
    bar.appendChild(title); bar.appendChild(close);
    panel.appendChild(bar);

    var body = ptEl("div", "pt-body");
    panel.appendChild(body);

    var sub = ptEl("p", "pt-sub", "");
    sub.innerHTML = "<b>HOW IT WORKS</b> Five rails must come up in dependency order, " +
      "each Power Good before the next rail enables, with real ramp physics on every rail. " +
      "Set the enable order and the delay between rails, run the sequence, read the scope " +
      "and the event log, and rework exactly what the data convicts. Sign off all three " +
      "boards to earn the bring-up certificate. " +
      "Built for <a href=\"https://dillingerstaffing.github.io/tapeout/\" target=\"_blank\" rel=\"noopener\">TAPEOUT</a> GPU bring-up.";
    body.appendChild(sub);

    var cards = ptEl("div", "pt-cards"); cards.id = "ptCards"; body.appendChild(cards);
    var brief = ptEl("p", "pt-brief", ""); brief.id = "ptBrief"; body.appendChild(brief);

    body.appendChild(ptEl("h3", "pt-sec", "Enable order, top enables first"));
    var order = ptEl("div", "pt-order"); order.id = "ptOrder"; body.appendChild(order);
    var oh = ptEl("p", "pt-hint",
      "A rail may only enable after every rail it depends on is Power Good. " +
      "Enabling out of order is a sequence violation and fails the board on the spot.");
    body.appendChild(oh);

    body.appendChild(ptEl("h3", "pt-sec", "Inter-rail delay"));
    var drow = ptEl("div", "pt-delayrow");
    var slider = document.createElement("input");
    slider.type = "range"; slider.id = "ptDelay"; slider.min = "0"; slider.max = "300";
    slider.step = "5"; slider.value = String(ptDelay);
    slider.setAttribute("aria-label", "Delay in milliseconds between consecutive rail enables");
    slider.addEventListener("input", function () {
      ptDelay = parseInt(slider.value, 10);
      pt$("ptDelayVal").textContent = ptDelay + " ms";
      ptLast = null; ptRenderQual();
    });
    drow.appendChild(slider);
    var dval = ptEl("span", "pt-delayval", ptDelay + " ms"); dval.id = "ptDelayVal"; drow.appendChild(dval);
    body.appendChild(drow);
    var dh = ptEl("p", "pt-hint",
      "Each enable is counted from the previous enable, not from Power Good. " +
      "A sluggish rail needs a longer delay, or the next rail enables into a violation.");
    body.appendChild(dh);

    body.appendChild(ptEl("h3", "pt-sec", "Shop rework"));
    var rw = ptEl("div", "pt-rework"); rw.id = "ptRework"; body.appendChild(rw);
    var rh = ptEl("p", "pt-hint",
      "Rework is per board and costs nothing but your pride. The scope decides, not the guess: " +
      "apply the fix the trace actually convicts.");
    body.appendChild(rh);

    var runrow = ptEl("div", "pt-runrow");
    var run = ptEl("button", "pt-run", "RUN SEQUENCE");
    run.id = "ptRun"; run.type = "button";
    run.addEventListener("click", ptOnRun);
    runrow.appendChild(run);
    var qual = ptEl("button", "pt-qual", "SIGN OFF BOARD");
    qual.id = "ptQual"; qual.type = "button"; qual.disabled = true;
    qual.addEventListener("click", ptOnQualify);
    runrow.appendChild(qual);
    var runs = ptEl("span", "pt-runs", ""); runs.id = "ptRuns"; runrow.appendChild(runs);
    body.appendChild(runrow);

    var log = ptEl("div", "pt-log", "No run yet. Set the order and delay, then run the sequence.");
    log.id = "ptLog"; body.appendChild(log);
    var verdict = ptEl("div", "pt-verdict", "No run yet.");
    verdict.id = "ptVerdict"; body.appendChild(verdict);

    var canvas = document.createElement("canvas");
    canvas.className = "pt-scope"; canvas.id = "ptScope";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Oscilloscope trace of the five rail voltages as percent of target");
    body.appendChild(canvas);
    var legend = ptEl("div", "pt-legend"); legend.id = "ptLegend"; body.appendChild(legend);
    var slab = ptEl("p", "pt-scopelab",
      "SCOPE: each rail as percent of its target. Dashed lines mark the Power-Good threshold (95%) " +
      "and the under-voltage floor (92%). Vertical ticks are enables, dots are Power-Good asserts, " +
      "a cross marks the first hard failure.");
    body.appendChild(slab);

    var cert = ptEl("div", "pt-cert"); cert.id = "ptCert"; body.appendChild(cert);

    close.addEventListener("click", function () { ov.classList.remove("open"); });
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("open"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("open")) ov.classList.remove("open");
    });

    ptRenderCards(); ptRenderOrder(); ptRenderRework(); ptRenderLegend(); ptRenderQual();
  }

  function ptRenderCards() {
    var wrap = pt$("ptCards");
    wrap.innerHTML = "";
    PT_BOARDS.forEach(function (c, i) {
      var tab = ptEl("button", "pt-cardtab" + (i === ptBoardIdx ? " sel" : ""), "");
      tab.type = "button";
      tab.setAttribute("aria-pressed", i === ptBoardIdx ? "true" : "false");
      tab.appendChild(ptEl("div", "k", "BOARD " + c.id));
      tab.appendChild(ptEl("div", "n", c.name));
      var q = ptEl("div", "q" + (ptQuals[c.id] ? " done" : ""), "");
      q.textContent = ptQuals[c.id] ? "SIGNED OFF" : "NOT SIGNED OFF";
      tab.appendChild(q);
      tab.addEventListener("click", function () { ptSelectBoard(i); });
      wrap.appendChild(tab);
    });
    pt$("ptBrief").textContent = ptBoard().brief;
  }

  function ptSelectBoard(i) {
    ptBoardIdx = i;
    ptLast = null;
    ptRenderCards(); ptRenderRework(); ptRenderQual();
    pt$("ptLog").textContent = "No run yet on board " + ptBoard().id + ". Set the order and delay, then run the sequence.";
    pt$("ptVerdict").className = "pt-verdict";
    pt$("ptVerdict").textContent = "No run yet.";
  }

  function ptRenderOrder() {
    var wrap = pt$("ptOrder");
    wrap.innerHTML = "";
    ptOrder.forEach(function (id, i) {
      var r = ptRailById(id);
      var row = ptEl("div", "pt-row", "");
      row.appendChild(ptEl("span", "pt-pos", String(i + 1)));
      row.appendChild(ptEl("span", "pt-rn", r.name));
      row.appendChild(ptEl("span", "pt-rv", r.v.toFixed(1) + "V"));
      var pre = r.pre.length ?
        "needs: " + r.pre.map(function (p) { return ptRailById(p).name; }).join(", ") :
        "needs: none";
      row.appendChild(ptEl("span", "pt-pre", pre));
      var up = ptEl("button", "pt-mv", "UP");
      up.type = "button";
      up.disabled = (i === 0);
      up.setAttribute("aria-label", "Move " + r.name + " earlier in the enable order");
      up.addEventListener("click", function () { ptMove(i, -1); });
      var down = ptEl("button", "pt-mv", "DOWN");
      down.type = "button";
      down.disabled = (i === ptOrder.length - 1);
      down.setAttribute("aria-label", "Move " + r.name + " later in the enable order");
      down.addEventListener("click", function () { ptMove(i, 1); });
      row.appendChild(up); row.appendChild(down);
      wrap.appendChild(row);
    });
  }

  function ptMove(i, d) {
    var j = i + d;
    if (j < 0 || j >= ptOrder.length) return;
    var t = ptOrder[i]; ptOrder[i] = ptOrder[j]; ptOrder[j] = t;
    ptLast = null;
    ptRenderOrder(); ptRenderQual();
  }

  function ptRenderRework() {
    var wrap = pt$("ptRework");
    wrap.innerHTML = "";
    var rw = ptRework(ptBoard().id);
    var defs = [
      { k: "vrm",  label: "REPLACE VCORE VRM", note: "fresh 0.8V regulator, fast ramp" },
      { k: "caps", label: "REWORK INPUT BULK CAPS", note: "bigger input reservoir, kills sag" }
    ];
    defs.forEach(function (d) {
      var b = ptEl("button", "pt-rw" + (rw[d.k] ? " on" : ""), "");
      b.type = "button";
      b.setAttribute("aria-pressed", rw[d.k] ? "true" : "false");
      b.appendChild(ptEl("span", null, d.label + (rw[d.k] ? ": APPLIED" : ": NOT APPLIED")));
      b.appendChild(ptEl("small", null, d.note));
      b.addEventListener("click", function () {
        rw[d.k] = !rw[d.k];
        ptLast = null;
        ptRenderRework(); ptRenderQual();
      });
      wrap.appendChild(b);
    });
  }

  function ptRenderLegend() {
    var wrap = pt$("ptLegend");
    wrap.innerHTML = "";
    PT_RAILS.forEach(function (r) {
      var item = ptEl("span", "pt-leg", "");
      var sw = ptEl("span", "pt-sw", "");
      sw.style.background = PT_COLORS[r.id];
      item.appendChild(sw);
      item.appendChild(ptEl("span", null, r.name + " (" + r.v.toFixed(1) + "V)"));
      wrap.appendChild(item);
    });
  }

  function ptRenderQual() {
    var ok = !!(ptLast && ptLast.grade.pass && ptLast.boardId === ptBoard().id);
    pt$("ptQual").disabled = !ok || !!ptQuals[ptBoard().id];
    pt$("ptQual").textContent = ptQuals[ptBoard().id] ? "BOARD SIGNED OFF" : "SIGN OFF BOARD";
    pt$("ptRuns").textContent = "runs: " + ptRuns + " (par " + PT_PAR_RUNS + ")";
  }

  function ptOnRun() {
    var b = ptBoard();
    var rw = ptRework(b.id);
    ptRuns++;
    var grade = ptSim(b, ptOrder.slice(), ptDelay, { vrm: rw.vrm, caps: rw.caps });
    ptLast = { grade: grade, boardId: b.id };
    var log = pt$("ptLog");
    log.innerHTML = "";
    grade.events.forEach(function (e) {
      var line = ptEl("div", "", "");
      var cls = "dim";
      if (/VIOLATION|TIMEOUT|UVLO/.test(e.txt)) cls = "bad";
      else if (/RESET RELEASED/.test(e.txt)) cls = "good";
      var head = ptEl("span", cls, "t=" + e.t + "ms: ");
      line.appendChild(head);
      line.appendChild(document.createTextNode(e.txt.replace(/^[^:]*: /, "")));
      log.appendChild(line);
    });
    var v = pt$("ptVerdict");
    v.className = "pt-verdict " + (grade.pass ? "pass" : "fail");
    v.innerHTML = "";
    v.appendChild(ptEl("span", null, grade.pass ? "BOARD BOOTS CLEAN" : "BOARD FAILS"));
    var small = ptEl("small", null, "");
    small.textContent = grade.pass
      ? "Reset released at t=" + grade.bootTime + "ms. This exact order and delay can sign off board " + b.id + "."
      : "First hard failure: " + grade.fail.kind.toUpperCase() + " at t=" + grade.fail.t + "ms. Read the scope, adjust, re-run.";
    v.appendChild(small);
    ptRenderQual();
    ptDrawScope();
  }

  function ptOnQualify() {
    if (!ptLast || !ptLast.grade.pass || ptLast.boardId !== ptBoard().id) return;
    var b = ptBoard(), g = ptLast.grade;
    var rw = ptRework(b.id);
    var fixes = [];
    if (rw.vrm) fixes.push("vcore VRM replaced");
    if (rw.caps) fixes.push("input bulk caps reworked");
    ptQuals[b.id] = {
      boot: g.bootTime, order: ptOrder.slice(), delay: ptDelay,
      rework: fixes.length ? fixes.join(", ") : "none", traces: g.traces
    };
    ptRenderCards(); ptRenderQual(); ptMaybeCert();
    if (typeof toast === "function") toast("Board " + b.id + " signed off.");
  }

  function ptMaybeCert() {
    var done = PT_BOARDS.every(function (c) { return !!ptQuals[c.id]; });
    var box = pt$("ptCert");
    if (!done) { box.classList.remove("show"); box.innerHTML = ""; return; }
    box.innerHTML = "";
    box.appendChild(ptEl("h4", null, "BRING-UP COMPLETE"));
    var p = ptEl("p", null, "");
    p.textContent = "All three boards bring up clean: sequencing, Power Good, and UVLO verified. " +
      "The TAPEOUT bring-up bench accepts this power tree in " + ptRuns + " runs (par " + PT_PAR_RUNS + ").";
    box.appendChild(p);
    var dl = ptEl("button", "pt-mini", "DOWNLOAD CERTIFICATE");
    dl.type = "button";
    dl.addEventListener("click", function () {
      ptDownload(ptCertText(ptQuals, ptRuns), "power-tree-certificate.txt");
      if (typeof toast === "function") toast("Certificate downloaded.");
    });
    box.appendChild(dl);
    var dl2 = ptEl("button", "pt-mini", "DOWNLOAD TRACE CSV");
    dl2.type = "button";
    dl2.addEventListener("click", function () {
      ptDownload(ptTraceCsv(), "power-tree-traces.csv");
      if (typeof toast === "function") toast("Trace CSV downloaded.");
    });
    box.appendChild(dl2);
    box.classList.add("show");
  }

  function ptTraceCsv() {
    var L = ["board,t_ms," + PT_RAILS.map(function (r) { return r.name + "_V"; }).join(",")];
    PT_BOARDS.forEach(function (b) {
      var q = ptQuals[b.id];
      if (!q) return;
      var n = q.traces.v12.length;
      for (var i = 0; i < n; i++) {
        var row = [b.id, i * 2];
        PT_RAILS.forEach(function (r) {
          row.push((q.traces[r.id][i] / 100 * r.v).toFixed(3));
        });
        L.push(row.join(","));
      }
    });
    return L.join("\n");
  }

  function ptDownload(text, name) {
    var blob = new Blob([text], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function ptDrawScope() {
    var cv = pt$("ptScope");
    if (!cv) return;
    var g = cv.getContext("2d");
    if (!g) return;
    var W = cv.clientWidth || 800, H = 200;
    var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0a0a0d";
    g.fillRect(0, 0, W, H);

    var X = function (t) { return 8 + (t / PT_T) * (W - 16); };
    var Y = function (pct) { return H - 18 - (pct / 115) * (H - 36); };

    g.font = "10px 'IBM Plex Mono', monospace";
    g.lineWidth = 1;
    [[0, "#2a2a30", "0"], [50, "#2a2a30", "50"], [92, "#5a3a2a", "UVLO 92"],
     [95, "#2a5a2a", "PG 95"], [100, "#2a2a30", "100"], [110, "#2a2a30", "110%"]
    ].forEach(function (ln) {
      g.strokeStyle = ln[1];
      g.setLineDash(ln[0] === 92 || ln[0] === 95 ? [5, 4] : []);
      g.beginPath(); g.moveTo(8, Y(ln[0])); g.lineTo(W - 8, Y(ln[0])); g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#6e6b64";
      g.fillText(ln[2], W - 52, Y(ln[0]) - 3);
    });

    var grade = (ptLast && ptLast.grade) || null;
    if (grade) {
      /* enable ticks */
      PT_RAILS.forEach(function (r) {
        var te = grade.tEn[r.id];
        g.strokeStyle = "#3a3a42";
        g.beginPath(); g.moveTo(X(te), 8); g.lineTo(X(te), H - 18); g.stroke();
        g.fillStyle = "#8a877f";
        g.fillText(r.name, X(te) + 3, 14);
      });
      /* traces */
      PT_RAILS.forEach(function (r) {
        var tr = grade.traces[r.id];
        g.strokeStyle = PT_COLORS[r.id];
        g.lineWidth = 1.5;
        g.beginPath();
        for (var i = 0; i < tr.length; i++) {
          var x = X(i * 2), y = Y(Math.min(tr[i], 115));
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      });
      g.lineWidth = 1;
      /* PG dots */
      PT_RAILS.forEach(function (r) {
        var pt2 = grade.pgT[r.id];
        if (pt2 >= 0) {
          g.fillStyle = PT_COLORS[r.id];
          g.beginPath(); g.arc(X(pt2), Y(95), 3, 0, Math.PI * 2); g.fill();
        }
      });
      /* fail cross */
      if (grade.fail) {
        var fx = X(grade.fail.t), fy = Y(50);
        g.strokeStyle = "#ff5a1f"; g.lineWidth = 2;
        g.beginPath();
        g.moveTo(fx - 6, fy - 6); g.lineTo(fx + 6, fy + 6);
        g.moveTo(fx + 6, fy - 6); g.lineTo(fx - 6, fy + 6);
        g.stroke();
        g.lineWidth = 1;
        g.fillStyle = "#ff5a1f";
        g.fillText(grade.fail.kind.toUpperCase() + " t=" + grade.fail.t + "ms", Math.min(fx + 8, W - 120), fy - 8);
      }
    } else {
      g.fillStyle = "#6e6b64";
      g.fillText("Run the sequence to paint the scope.", 12, 30);
    }
    g.fillStyle = "#6e6b64";
    g.fillText("0 ms", 8, H - 5);
    g.fillText("2000 ms", W - 62, H - 5);
  }

  function ptInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    ptBuildShell();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ptInit);
    } else {
      ptInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      PT: {
        rails: PT_RAILS, boards: PT_BOARDS, sim: ptSim,
        certText: ptCertText, colors: PT_COLORS, par: PT_PAR_RUNS
      }
    });
  }

})();
/* Bench 17: The Thermostat. PID fan-control tuning for a refurbished 1U server.
   Real thermal physics, real workload steps, three servers to qualify for OLD IRON. */
(function () {
  "use strict";

  /* ---------------- pure core: no DOM ---------------- */

  var TH_DT = 0.1, TH_STEPS = 900, TH_HORIZON = 90;
  var TH_SET = 65, TH_TRIP = 95, TH_BAND = 2.5, TH_CTH = 30;
  var TH_POLL = 15; /* BMC polls the die sensor every 1.5s: dead time in the loop */

  function thLoadA(t) { return t < 15 ? 90 : t < 45 ? 170 : t < 70 ? 210 : 90; }
  function thLoadB(t) { return t < 15 ? 100 : t < 45 ? 180 : t < 70 ? 220 : 100; }
  function thLoadC(t) {
    if (t < 10) return 90;
    if (t < 12) return 250;
    if (t < 40) return 190;
    if (t < 42) return 250;
    if (t < 70) return 215;
    return 90;
  }

  var TH_SERVERS = [
    { id: "A", name: "RACK A, COLD AISLE", amb: 22, dust: 1.0, load: thLoadA, noiseBudget: 44,
      brief: "The easy rack: a clean heatsink, a cool aisle, and an honest workload curve. A sane PID should hold this all day. Use it to learn what each knob does before the hot aisle humbles you." },
    { id: "B", name: "RACK B, HOT AISLE", amb: 33, dust: 1.0, load: thLoadB, noiseBudget: 50,
      brief: "This rack breathes its neighbor's exhaust: 33C intake air. The fan has almost no headroom left, so the integral term has to do real work and the noise budget is tight. Overshoot here is expensive." },
    { id: "C", name: "RACK C, DUSTY SINK", amb: 22, dust: 0.75, load: thLoadC, noiseBudget: 51,
      brief: "Retired from a bakery office, dust baked into the fins: the sink moves 25% less heat. The workload slams in 250W spikes with almost no ramp. Derivative action earns its keep on this one." }
  ];

  function thH(pwm, dust) { return (0.9 + 7.5 * Math.pow(pwm / 100, 1.6)) * dust; }
  function thNoise(pwm) { return 28 + 34 * Math.pow(pwm / 100, 1.8); }

  function thNewRun(sv, kp, ki, kd) {
    var edges = [], pl = sv.load(0), se, cl;
    for (se = TH_DT; se <= TH_HORIZON; se += TH_DT) {
      cl = sv.load(se);
      if (Math.abs(cl - pl) > 1) { edges.push({ t: se, w: cl }); pl = cl; }
    }
    var hist = [], hd;
    for (hd = 0; hd < TH_POLL; hd++) hist.push(58);
    return { sv: sv, kp: kp, ki: ki, kd: kd, T: 58, I: 0, ePrev: 58 - TH_SET,
      pwm: 0, hist: hist, edges: edges, ei: 0, lastEdge: -100,
      i: 0, trip: false, inBand: 0, bandN: 0, noiseSum: 0, maxT: 58,
      samples: [], events: [], imax: ki > 0 ? 100 / ki : 0, done: false };
  }

  function thStepRun(st) {
    if (st.done) return;
    var t = st.i * TH_DT, sv = st.sv;
    var P = sv.load(t) + 6 + 0.30 * Math.max(0, st.T - 55);
    st.hist.push(st.T);
    var Td = st.hist.shift();
    var Tm = Math.round((Td + 0.25 * Math.sin(6.2831 * 1.7 * t)) * 5) / 5;
    var e = Tm - TH_SET;
    var integ = st.I + e * TH_DT;
    if (integ > st.imax) integ = st.imax; else if (integ < -st.imax) integ = -st.imax;
    var u = st.kp * e + st.ki * integ + st.kd * (e - st.ePrev) / TH_DT;
    var npwm = u < 0 ? 0 : u > 100 ? 100 : u;
    if (!((u > 100 && e > 0) || (u < 0 && e < 0))) st.I = integ; /* anti-windup */
    st.pwm += (npwm - st.pwm) * TH_DT / 2.5; /* fan spool lag */
    st.ePrev = e;
    st.T += (P - thH(st.pwm, sv.dust) * (st.T - sv.amb)) * TH_DT / TH_CTH;
    if (st.T > st.maxT) st.maxT = st.T;
    var nz = thNoise(st.pwm);
    st.noiseSum += nz;
    while (st.ei < st.edges.length && st.edges[st.ei].t <= t) {
      st.events.push({ t: t, txt: "t=" + t.toFixed(0) + "s: workload steps to " +
        st.edges[st.ei].w + "W." });
      st.lastEdge = st.edges[st.ei].t;
      st.ei++;
    }
    if (t >= 10 && t - st.lastEdge >= 12) {
      st.bandN++;
      if (Math.abs(st.T - TH_SET) <= TH_BAND) st.inBand++;
    }
    if (st.T >= TH_TRIP) {
      st.trip = true;
      st.events.push({ t: t, txt: "THERMAL TRIP at t=" + t.toFixed(1) + "s: die hit " +
        st.T.toFixed(1) + "C, the BMC cut power. Run over." });
      st.done = true;
    }
    if (st.i % 5 === 0) st.samples.push({ t: t, T: st.T, pwm: st.pwm, nz: nz });
    st.i++;
    if (st.i >= TH_STEPS) st.done = true;
  }

  function thVerdict(st) {
    var frac = st.bandN ? st.inBand / st.bandN : 0;
    var avgN = st.noiseSum / Math.max(1, st.i);
    var reasons = [];
    if (st.trip) reasons.push("Thermal trip: the die hit 95C and the BMC cut power.");
    if (frac < 0.75) reasons.push("In band only " + Math.round(frac * 100) +
      "% of the scored window (need 75%). Each workload step gets a 12s settle allowance.");
    if (avgN > st.sv.noiseBudget) reasons.push("Average noise " + avgN.toFixed(1) +
      " dBA over the " + st.sv.noiseBudget + " dBA budget. The customer hears this rack.");
    return { pass: reasons.length === 0, reasons: reasons, inBandFrac: frac,
      avgNoise: avgN, maxT: st.maxT };
  }

  function thSim(sv, kp, ki, kd) {
    var st = thNewRun(sv, kp, ki, kd);
    while (!st.done) thStepRun(st);
    var v = thVerdict(st);
    v.samples = st.samples;
    v.events = st.events;
    return v;
  }

  /* ---------------- shell ---------------- */

  var TH_CSS = [
    ".th-overlay{position:fixed;inset:0;background:rgba(8,8,10,.82);z-index:9000;display:none;overflow-y:auto;padding:24px 16px;}",
    ".th-overlay.open{display:block;}",
    ".th-panel{max-width:860px;margin:0 auto;background:#101014;border:1px solid #2a2a30;border-radius:4px;color:#f2f0eb;font-family:'Space Grotesk',system-ui,sans-serif;}",
    ".th-bar{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #2a2a30;}",
    ".th-title{font-size:20px;letter-spacing:.14em;font-weight:700;}",
    ".th-title b{color:#ff5a1f;}",
    ".th-close{background:none;border:1px solid #3a3a42;color:#f2f0eb;border-radius:4px;min-height:48px;padding:0 18px;font-family:'IBM Plex Mono',monospace;font-size:13px;cursor:pointer;}",
    ".th-close:hover{border-color:#ff5a1f;}",
    ".th-close:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".th-body{padding:22px;}",
    ".th-sub{font-size:14px;line-height:1.6;color:#b9b6ae;margin:0 0 20px;}",
    ".th-sub b{color:#f2f0eb;}",
    ".th-sub a{color:#ff5a1f;}",
    ".th-cards{display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap;}",
    ".th-cardtab{flex:1;min-width:150px;min-height:56px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;cursor:pointer;font-family:'Space Grotesk',sans-serif;padding:8px 10px;text-align:left;transition:transform .1s,border-color .1s;}",
    ".th-cardtab:hover{border-color:#ff5a1f;}",
    ".th-cardtab:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".th-cardtab.sel{border-color:#ff5a1f;transform:translateY(-2px);}",
    ".th-cardtab .k{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a877f;letter-spacing:.1em;}",
    ".th-cardtab .n{font-size:14px;font-weight:700;margin-top:2px;}",
    ".th-cardtab .q{font-family:'IBM Plex Mono',monospace;font-size:11px;margin-top:4px;color:#8a877f;}",
    ".th-cardtab .q.done{color:#7dd87d;}",
    ".th-brief{font-size:13px;color:#b9b6ae;border-left:3px solid #ff5a1f;padding:8px 14px;margin:0 0 22px;line-height:1.55;}",
    ".th-sec{font-size:12px;letter-spacing:.14em;color:#8a877f;font-weight:700;margin:0 0 10px;text-transform:uppercase;}",
    ".th-gains{display:flex;flex-direction:column;gap:10px;margin-bottom:8px;}",
    ".th-grow{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}",
    ".th-glab{font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;min-width:120px;color:#f2f0eb;}",
    ".th-glab small{display:block;font-weight:400;font-size:11px;color:#8a877f;}",
    ".th-grow input[type=range]{flex:1;min-width:180px;min-height:48px;accent-color:#ff5a1f;}",
    ".th-grow input[type=range]:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".th-gval{font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:700;color:#ff5a1f;min-width:56px;text-align:right;}",
    ".th-hint{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#6e6b64;margin:0 0 22px;line-height:1.6;}",
    ".th-runrow{display:flex;gap:12px;align-items:center;margin:6px 0 16px;flex-wrap:wrap;}",
    ".th-run{min-height:52px;padding:0 28px;border:none;border-radius:4px;background:#ff5a1f;color:#101014;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:15px;letter-spacing:.08em;cursor:pointer;transition:transform .1s;}",
    ".th-run:hover:not(:disabled){transform:translateY(-2px);}",
    ".th-run:disabled{opacity:.35;cursor:default;}",
    ".th-run:focus-visible{outline:2px solid #fff;outline-offset:2px;}",
    ".th-stop{min-height:52px;padding:0 24px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:13px;cursor:pointer;}",
    ".th-stop:hover:not(:disabled){border-color:#ff5a1f;}",
    ".th-stop:disabled{opacity:.35;cursor:default;}",
    ".th-stop:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".th-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px;}",
    ".th-stat{background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:10px 12px;}",
    ".th-stat .k{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#6e6b64;letter-spacing:.1em;}",
    ".th-stat .v{font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:700;color:#f2f0eb;margin-top:4px;}",
    ".th-stat .v.hot{color:#ff5a1f;}",
    ".th-chart{width:100%;height:240px;background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;margin-bottom:8px;}",
    ".th-legend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px;}",
    ".th-leg{display:flex;align-items:center;gap:6px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#b9b6ae;}",
    ".th-sw{width:16px;height:4px;border-radius:2px;}",
    ".th-chartlab{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a877f;margin:0 0 18px;line-height:1.6;}",
    ".th-log{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#f2f0eb;background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:14px 16px;margin:0 0 14px;max-height:180px;overflow-y:auto;line-height:1.7;white-space:pre-wrap;}",
    ".th-log .bad{color:#ff5a1f;}",
    ".th-log .good{color:#7dd87d;}",
    ".th-log .dim{color:#8a877f;}",
    ".th-verdict{font-size:15px;font-weight:700;letter-spacing:.1em;padding:14px;border-radius:4px;text-align:center;margin-bottom:18px;border:1px solid #3a3a42;}",
    ".th-verdict.pass{border-color:#7dd87d;color:#7dd87d;}",
    ".th-verdict.fail{border-color:#ff5a1f;color:#ff5a1f;}",
    ".th-verdict small{display:block;font-weight:400;letter-spacing:0;font-size:12px;color:#b9b6ae;margin-top:6px;}",
    ".th-signrow{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:6px;}",
    ".th-sign{min-height:52px;padding:0 24px;border:1px solid #7dd87d;background:none;color:#7dd87d;border-radius:4px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px;letter-spacing:.08em;cursor:pointer;}",
    ".th-sign:hover:not(:disabled){background:#12240f;}",
    ".th-sign:disabled{opacity:.35;cursor:default;}",
    ".th-sign:focus-visible{outline:2px solid #7dd87d;outline-offset:2px;}",
    ".th-runs{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#8a877f;}",
    ".th-cert{border:1px solid #7dd87d;border-radius:4px;padding:18px;margin-top:14px;display:none;}",
    ".th-cert.show{display:block;}",
    ".th-cert h4{margin:0 0 8px;font-size:15px;letter-spacing:.12em;color:#7dd87d;}",
    ".th-cert p{margin:0 0 12px;font-size:13px;color:#b9b6ae;line-height:1.6;}",
    ".th-mini{min-height:48px;padding:0 18px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:12px;cursor:pointer;margin-right:10px;margin-bottom:8px;}",
    ".th-mini:hover{border-color:#ff5a1f;}",
    ".th-mini:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    "@media (prefers-reduced-motion: reduce){.th-cardtab,.th-run{transition:none;}}",
    "@media (max-width:640px){.th-stats{grid-template-columns:repeat(2,1fr);}.th-glab{min-width:96px;}}"
  ].join("\n");

  function thEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null && text !== "") e.textContent = text;
    return e;
  }
  function th$(id) { return document.getElementById(id); }

  var thSrvIdx = 0, thKp = 2.0, thKi = 0.25, thKd = 0.4;
  var thRun = null, thTimer = null, thSigned = {}, thRuns = 0, thLastVerdict = null;
  var TH_REDUCED = false;

  function thServer() { return TH_SERVERS[thSrvIdx]; }

  function thBuildShell() {
    var css = document.createElement("style");
    css.textContent = TH_CSS;
    document.head.appendChild(css);

    var box = document.querySelector(".dossier .actions");
    if (box && !th$("thBtn")) {
      var b = thEl("button", "secondary", "Run the Thermostat");
      b.id = "thBtn";
      b.addEventListener("click", function () {
        th$("thOverlay").classList.add("open");
        thDraw();
      });
      box.appendChild(b);
    }

    var ov = thEl("div", "th-overlay");
    ov.id = "thOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "The Thermostat");
    var panel = thEl("div", "th-panel");
    ov.appendChild(panel);
    document.body.appendChild(ov);

    var bar = thEl("div", "th-bar");
    var title = thEl("div", "th-title", "");
    title.innerHTML = "THE <b>THERMO</b>STAT";
    var close = thEl("button", "th-close", "CLOSE [x]");
    close.type = "button";
    bar.appendChild(title); bar.appendChild(close);
    panel.appendChild(bar);

    var body = thEl("div", "th-body");
    panel.appendChild(body);

    var sub = thEl("p", "th-sub", "");
    sub.innerHTML = "<b>HOW IT WORKS</b> A real PID loop drives this refurbished 1U server's fans: " +
      "die temperature, fan spool lag, a BMC that polls the sensor every 1.5s, and honest workload steps. " +
      "Tune P, I, and D, run the 90-second workload, and hold 65C inside the band without tripping 95C " +
      "or blowing the noise budget. Built for <a href=\"https://dillingerstaffing.github.io/old-iron/\" " +
      "target=\"_blank\" rel=\"noopener\">OLD IRON</a> server refurbishment.";
    body.appendChild(sub);

    var cards = thEl("div", "th-cards"); cards.id = "thCards"; body.appendChild(cards);
    var brief = thEl("p", "th-brief", ""); brief.id = "thBrief"; body.appendChild(brief);

    body.appendChild(thEl("h3", "th-sec", "PID gains"));
    var gains = thEl("div", "th-gains"); gains.id = "thGains"; body.appendChild(gains);
    var defs = [
      { k: "kp", lab: "P, proportional", note: "pushes the fan against the current error", min: 0, max: 6, step: 0.1 },
      { k: "ki", lab: "I, integral", note: "kills steady droop, winds up if greedy", min: 0, max: 1.2, step: 0.05 },
      { k: "kd", lab: "D, derivative", note: "brakes fast moves, twitchy past its prime", min: 0, max: 3, step: 0.1 }
    ];
    defs.forEach(function (d) {
      var row = thEl("div", "th-grow");
      var lab = thEl("label", "th-glab", "");
      lab.innerHTML = d.lab + "<small>" + d.note + "</small>";
      var inp = document.createElement("input");
      inp.type = "range"; inp.id = "th-" + d.k;
      inp.min = String(d.min); inp.max = String(d.max); inp.step = String(d.step);
      var cur = d.k === "kp" ? thKp : d.k === "ki" ? thKi : thKd;
      inp.value = String(cur);
      inp.setAttribute("aria-label", d.lab + " gain");
      var val = thEl("span", "th-gval", cur.toFixed(2)); val.id = "th-" + d.k + "v";
      lab.setAttribute("for", "th-" + d.k);
      (function (key, input, out, stp) {
        input.addEventListener("input", function () {
          var v = parseFloat(input.value);
          if (key === "kp") thKp = v; else if (key === "ki") thKi = v; else thKd = v;
          out.textContent = v.toFixed(2);
          thLastVerdict = null;
          thRenderSign();
        });
      })(d.k, inp, val, d.step);
      row.appendChild(lab); row.appendChild(inp); row.appendChild(val);
      gains.appendChild(row);
    });
    body.appendChild(thEl("p", "th-hint",
      "P alone always droops: something has to hold the fan against a steady load. " +
      "Crank everything to the stops and the 1.5s sensor delay turns the loop into a hunter. " +
      "Tune like the customer is listening, because they are."));

    var runrow = thEl("div", "th-runrow");
    var run = thEl("button", "th-run", "RUN BENCH");
    run.id = "thRun"; run.type = "button";
    run.addEventListener("click", thOnRun);
    runrow.appendChild(run);
    var stop = thEl("button", "th-stop", "STOP");
    stop.id = "thStop"; stop.type = "button"; stop.disabled = true;
    stop.addEventListener("click", thOnStop);
    runrow.appendChild(stop);
    var runs = thEl("span", "th-runs", ""); runs.id = "thRuns"; runrow.appendChild(runs);
    body.appendChild(runrow);

    var stats = thEl("div", "th-stats");
    [["DIE TEMP", "thStT", "C"], ["FAN", "thStF", "%"], ["NOISE", "thStN", "dBA"],
     ["IN BAND", "thStB", "%"], ["ELAPSED", "thStE", "s"]].forEach(function (d) {
      var s = thEl("div", "th-stat", "");
      s.appendChild(thEl("div", "k", d[0]));
      var v = thEl("div", "v", "--"); v.id = d[1];
      s.appendChild(v);
      s.appendChild(thEl("div", "k", d[2]));
      stats.appendChild(s);
    });
    body.appendChild(stats);

    var canvas = document.createElement("canvas");
    canvas.className = "th-chart"; canvas.id = "thChart";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Live chart: die temperature and fan speed over the 90 second run");
    body.appendChild(canvas);
    var legend = thEl("div", "th-legend");
    legend.innerHTML = "<span class=\"th-leg\"><span class=\"th-sw\" style=\"background:#ff5a1f\"></span>DIE TEMP, C</span>" +
      "<span class=\"th-leg\"><span class=\"th-sw\" style=\"background:#8a877f\"></span>FAN, %</span>" +
      "<span class=\"th-leg\"><span class=\"th-sw\" style=\"background:#7dd87d\"></span>65C TARGET BAND</span>";
    body.appendChild(legend);
    body.appendChild(thEl("p", "th-chartlab",
      "CHART: die temperature (ember, left scale 20 to 100C) and fan speed (gray, 0 to 100%). " +
      "Green band is the 65C target window, dashed red is the 95C trip line. " +
      "Workload steps are marked; the first 12s after each step are settle time and unscored."));

    var log = thEl("div", "th-log", "No run yet. Set the gains, pick a rack, then run the bench.");
    log.id = "thLog"; body.appendChild(log);
    var verdict = thEl("div", "th-verdict", "No run yet."); verdict.id = "thVerdict";
    body.appendChild(verdict);

    var signrow = thEl("div", "th-signrow");
    var sign = thEl("button", "th-sign", "SIGN OFF SERVER");
    sign.id = "thSign"; sign.type = "button"; sign.disabled = true;
    sign.addEventListener("click", thOnSign);
    signrow.appendChild(sign);
    body.appendChild(signrow);

    var cert = thEl("div", "th-cert"); cert.id = "thCert"; body.appendChild(cert);

    close.addEventListener("click", function () { thOnStop(); ov.classList.remove("open"); });
    ov.addEventListener("click", function (e) { if (e.target === ov) { thOnStop(); ov.classList.remove("open"); } });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("open")) { thOnStop(); ov.classList.remove("open"); }
    });

    thRenderCards(); thRenderSign(); thDraw();
  }

  function thRenderCards() {
    var wrap = th$("thCards");
    wrap.innerHTML = "";
    TH_SERVERS.forEach(function (c, i) {
      var tab = thEl("button", "th-cardtab" + (i === thSrvIdx ? " sel" : ""), "");
      tab.type = "button";
      tab.setAttribute("aria-pressed", i === thSrvIdx ? "true" : "false");
      tab.appendChild(thEl("div", "k", "SERVER " + c.id));
      tab.appendChild(thEl("div", "n", c.name));
      var q = thEl("div", "q" + (thSigned[c.id] ? " done" : ""), "");
      q.textContent = thSigned[c.id] ? "SIGNED OFF" : "NOT SIGNED OFF";
      tab.appendChild(q);
      tab.addEventListener("click", function () { thSelectServer(i); });
      wrap.appendChild(tab);
    });
    th$("thBrief").textContent = thServer().brief;
  }

  function thSelectServer(i) {
    if (thRun) thOnStop();
    thSrvIdx = i;
    thLastVerdict = null;
    thRenderCards(); thRenderSign();
    th$("thLog").textContent = "No run yet on server " + thServer().id + ". Set the gains, then run the bench.";
    var v = th$("thVerdict");
    v.className = "th-verdict";
    v.textContent = "No run yet.";
    thDraw();
  }

  function thRenderSign() {
    var sign = th$("thSign");
    var can = !!thLastVerdict && thLastVerdict.pass && !thSigned[thServer().id] && !thRun;
    sign.disabled = !can;
    th$("thRuns").textContent = thRuns === 0 ? "no runs yet" :
      thRuns + (thRuns === 1 ? " run" : " runs") + " this session";
  }

  function thEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function thOnRun() {
    if (thRun) return;
    thRun = thNewRun(thServer(), thKp, thKi, thKd);
    thLastVerdict = null;
    th$("thRun").disabled = true;
    th$("thStop").disabled = false;
    th$("thLog").innerHTML = "<span class=\"dim\">Run started on server " + thServer().id +
      " with P=" + thKp.toFixed(2) + " I=" + thKi.toFixed(2) + " D=" + thKd.toFixed(2) + ".</span>";
    thRenderSign();
    if (TH_REDUCED) {
      while (!thRun.done) thStepRun(thRun);
      thFinish();
      return;
    }
    thTimer = setInterval(function () {
      for (var k = 0; k < 60 && !thRun.done; k++) thStepRun(thRun);
      thDraw();
      thUpdateStats();
      if (thRun.done) thFinish();
    }, 50);
  }

  function thOnStop() {
    if (thTimer) { clearInterval(thTimer); thTimer = null; }
    if (thRun && !thRun.done) {
      thRun.done = true;
      th$("thLog").innerHTML += "\n<span class=\"dim\">Run aborted by operator.</span>";
    }
    thRun = null;
    th$("thRun").disabled = false;
    th$("thStop").disabled = true;
    thRenderSign();
  }

  function thUpdateStats() {
    if (!thRun) return;
    var t = thRun.i * TH_DT;
    th$("thStT").textContent = thRun.T.toFixed(1);
    th$("thStT").className = "v" + (thRun.T > 90 ? " hot" : "");
    th$("thStF").textContent = Math.round(thRun.pwm);
    var n = thRun.samples.length ? thRun.samples[thRun.samples.length - 1].nz : 28;
    th$("thStN").textContent = n.toFixed(1);
    th$("thStB").textContent = thRun.bandN ? Math.round(100 * thRun.inBand / thRun.bandN) : "--";
    th$("thStE").textContent = Math.min(t, TH_HORIZON).toFixed(0);
  }

  function thFinish() {
    if (thTimer) { clearInterval(thTimer); thTimer = null; }
    var st = thRun;
    thRun = null;
    thRuns++;
    var v = thVerdict(st);
    thLastVerdict = v;
    var log = th$("thLog");
    var html = "";
    st.events.forEach(function (e) {
      var cls = /TRIP/.test(e.txt) ? "bad" : "dim";
      html += "<span class=\"" + cls + "\">" + thEsc(e.txt) + "</span>\n";
    });
    html += "<span class=\"dim\">Run complete: peak die " + st.maxT.toFixed(1) +
      "C, in band " + Math.round(v.inBandFrac * 100) + "% of scored time, avg noise " +
      v.avgNoise.toFixed(1) + " dBA (budget " + st.sv.noiseBudget + ").</span>";
    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;
    var vd = th$("thVerdict");
    vd.className = "th-verdict " + (v.pass ? "pass" : "fail");
    if (v.pass) {
      vd.innerHTML = "REFURB READY: SERVER " + st.sv.id + " QUALIFIED" +
        "<small>Held 65C in band, no trip, inside the noise budget. Sign it off.</small>";
    } else {
      vd.innerHTML = "NOT READY: SERVER " + st.sv.id + " FAILED" +
        "<small>" + thEsc(v.reasons.join(" ")) + "</small>";
    }
    th$("thStT").textContent = st.T.toFixed(1);
    th$("thStF").textContent = Math.round(st.pwm);
    th$("thStE").textContent = TH_HORIZON.toFixed(0);
    th$("thRun").disabled = false;
    th$("thStop").disabled = true;
    thDraw();
    thRenderSign();
    if (typeof toast === "function") toast(v.pass ? "Server " + st.sv.id + " qualified." : "Server " + st.sv.id + " failed the bench.");
  }

  function thOnSign() {
    var sv = thServer();
    if (!thLastVerdict || !thLastVerdict.pass || thSigned[sv.id]) return;
    thSigned[sv.id] = { kp: thKp, ki: thKi, kd: thKd };
    thRenderCards(); thRenderSign(); thMaybeCert();
    if (typeof toast === "function") toast("Server " + sv.id + " signed off.");
  }

  function thCertText() {
    var L = [];
    L.push("THE THERMOSTAT, THERMAL QUALIFICATION CERTIFICATE");
    L.push("The Proving Ground, bench 17");
    L.push("Issued: " + new Date().toISOString().slice(0, 10));
    L.push("");
    L.push("This certifies the following refurbished servers held a 65C die");
    L.push("setpoint inside a 2.5C band for 75% of scored time, with no thermal");
    L.push("trip and inside the per-server noise budget, under a real PID loop");
    L.push("with fan spool lag and a 1.5s BMC sensor poll delay.");
    L.push("");
    TH_SERVERS.forEach(function (sv) {
      var g = thSigned[sv.id];
      L.push("SERVER " + sv.id + " (" + sv.name + "): " +
        (g ? "QUALIFIED, P=" + g.kp.toFixed(2) + " I=" + g.ki.toFixed(2) + " D=" + g.kd.toFixed(2) : "not signed"));
    });
    L.push("");
    L.push("Signed off on the bench for OLD IRON refurbishment.");
    return L.join("\n");
  }

  function thMaybeCert() {
    var all = TH_SERVERS.every(function (sv) { return !!thSigned[sv.id]; });
    var cert = th$("thCert");
    if (!all) { cert.className = "th-cert"; cert.innerHTML = ""; return; }
    cert.className = "th-cert show";
    cert.innerHTML = "";
    cert.appendChild(thEl("h4", null, "THERMAL QUALIFICATION CERTIFICATE"));
    cert.appendChild(thEl("p", null,
      "All three servers held 65C through their workloads with no trip and inside the noise budget. " +
      "This rack is refurb-ready."));
    var dl = thEl("button", "th-mini", "DOWNLOAD CERTIFICATE");
    dl.type = "button";
    dl.addEventListener("click", function () {
      thDownload(thCertText(), "thermostat-certificate.txt");
      if (typeof toast === "function") toast("Certificate downloaded.");
    });
    cert.appendChild(dl);
  }

  function thDownload(text, name) {
    var blob = new Blob([text], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function thDraw() {
    var cv = th$("thChart");
    if (!cv) return;
    var g = cv.getContext("2d");
    if (!g) return;
    var W = cv.clientWidth || 800, H = 240;
    var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0a0a0d";
    g.fillRect(0, 0, W, H);

    var split = H * 0.68;
    var XT = function (t) { return 44 + (t / TH_HORIZON) * (W - 56); };
    var YT = function (c) { return 10 + (1 - (c - 20) / 80) * (split - 20); };
    var YP = function (p) { return split + 14 + (1 - p / 100) * (H - split - 34); };

    g.font = "10px 'IBM Plex Mono', monospace";
    g.lineWidth = 1;

    /* target band */
    g.fillStyle = "rgba(125,216,125,.10)";
    g.fillRect(XT(0), YT(TH_SET + TH_BAND), XT(TH_HORIZON) - XT(0), YT(TH_SET - TH_BAND) - YT(TH_SET + TH_BAND));
    /* trip line */
    g.strokeStyle = "#ff5a1f"; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(XT(0), YT(TH_TRIP)); g.lineTo(XT(TH_HORIZON), YT(TH_TRIP)); g.stroke();
    g.setLineDash([]);
    g.fillStyle = "#ff5a1f";
    g.fillText("TRIP 95", W - 58, YT(TH_TRIP) - 4);
    /* setpoint line */
    g.strokeStyle = "#3a5a3a"; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(XT(0), YT(TH_SET)); g.lineTo(XT(TH_HORIZON), YT(TH_SET)); g.stroke();
    g.setLineDash([]);
    /* temp gridlines */
    g.fillStyle = "#6e6b64";
    [20, 40, 60, 80, 100].forEach(function (c) {
      g.strokeStyle = "#1e1e24";
      g.beginPath(); g.moveTo(XT(0), YT(c)); g.lineTo(XT(TH_HORIZON), YT(c)); g.stroke();
      g.fillStyle = "#6e6b64";
      g.fillText(String(c), 8, YT(c) + 3);
    });
    /* pwm gridlines */
    [0, 50, 100].forEach(function (p) {
      g.strokeStyle = "#1e1e24";
      g.beginPath(); g.moveTo(XT(0), YP(p)); g.lineTo(XT(TH_HORIZON), YP(p)); g.stroke();
      g.fillStyle = "#6e6b64";
      g.fillText(String(p) + "%", 8, YP(p) + 3);
    });
    g.fillStyle = "#6e6b64";
    g.fillText("0s", XT(0), H - 6);
    g.fillText("45s", XT(45) - 8, H - 6);
    g.fillText("90s", XT(90) - 12, H - 6);

    var samples = thRun ? thRun.samples : (thLastSamples || []);
    if (samples.length === 0) {
      g.fillStyle = "#6e6b64";
      g.fillText("Run the bench to paint the chart.", 60, 40);
      return;
    }
    /* workload step markers */
    g.strokeStyle = "#2e2e38";
    thServer().load && (function () {
      var prev = thServer().load(0);
      for (var t = 1; t <= TH_HORIZON; t++) {
        var cur = thServer().load(t);
        if (cur !== prev) {
          g.beginPath(); g.moveTo(XT(t), 10); g.lineTo(XT(t), H - 20); g.stroke();
          prev = cur;
        }
      }
    })();
    /* pwm area */
    g.strokeStyle = "#8a877f";
    g.lineWidth = 1.5;
    g.beginPath();
    samples.forEach(function (s, i) {
      var x = XT(s.t), y = YP(s.pwm);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.stroke();
    /* temp trace */
    g.strokeStyle = "#ff5a1f";
    g.lineWidth = 2;
    g.beginPath();
    samples.forEach(function (s, i) {
      var x = XT(s.t), y = YT(Math.max(20, Math.min(100, s.T)));
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.stroke();
    g.lineWidth = 1;
    thLastSamples = samples;
  }
  var thLastSamples = [];

  function thInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    if (typeof window !== "undefined" && window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) TH_REDUCED = true;
    thBuildShell();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", thInit);
    } else {
      thInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      TH: {
        servers: TH_SERVERS, sim: thSim, newRun: thNewRun, stepRun: thStepRun,
        verdict: thVerdict, SET: TH_SET, TRIP: TH_TRIP, BAND: TH_BAND, noise: thNoise
      }
    });
  }

})();

/* Bench 18: The Scrub Bay. SECDED ECC qualification for TAPEOUT GDDR.
   Real Hamming(72,64) extended code: encode 8 bytes, inject faults,
   read the syndrome, scrub the words. Three VRAM modules stand or fall. */
(function () {
  "use strict";

  /* ---------------- pure core: no DOM ---------------- */

  var ES_CHECK = [1, 2, 4, 8, 16, 32, 64]; /* parity positions, 1-based */
  var ES_QPOS = 72; /* overall parity position */

  function esIsCheck(p) { return ES_CHECK.indexOf(p) !== -1; }

  function esDataPos() {
    var out = [];
    for (var p = 1; p <= 71; p++) { if (!esIsCheck(p)) out.push(p); }
    return out; /* 64 data positions, 1-based */
  }
  var ES_DATAPOS = esDataPos();

  /* bits: array[72] of 0/1, index 0 holds position 1 */
  function esEncode(data) { /* data: array[64] of 0/1 */
    var b = new Array(72);
    var i, j, c, p, x, q;
    for (i = 0; i < 72; i++) b[i] = 0;
    for (i = 0; i < 64; i++) b[ES_DATAPOS[i] - 1] = data[i] & 1;
    for (c = 0; c < 7; c++) {
      p = ES_CHECK[c]; x = 0;
      for (j = 1; j <= 71; j++) {
        if (j === p) continue;
        if (j & p) x ^= b[j - 1];
      }
      b[p - 1] = x;
    }
    q = 0;
    for (j = 0; j < 71; j++) q ^= b[j];
    b[71] = q;
    return b;
  }

  function esDecode(bits) {
    var s = 0, c, p, j, x, q = 0;
    for (c = 0; c < 7; c++) {
      p = ES_CHECK[c]; x = 0;
      for (j = 1; j <= 71; j++) { if (j & p) x ^= bits[j - 1]; }
      if (x) s |= p;
    }
    for (j = 0; j < 72; j++) q ^= bits[j];
    if (q === 1) {
      if (s === 0) return { syndrome: s, parityOk: false, verdict: "single", pos: ES_QPOS };
      return { syndrome: s, parityOk: false, verdict: "single", pos: s };
    }
    if (s === 0) return { syndrome: s, parityOk: true, verdict: "clean" };
    return { syndrome: s, parityOk: true, verdict: "double" };
  }

  function esRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
      return s / 0x80000000;
    };
  }

  var ES_MODULES = [
    { id: "A", name: "MODULE A, THE CLEAN ROOM", seed: 1801,
      mix: { none: 5, transient: 2, stuck: 1, double: 0 },
      brief: "The golden module: honest silicon, mostly clean words, two transient flips from the universe, one tired cell. Learn the calls here." },
    { id: "B", name: "MODULE B, THE MARGINAL LOT", seed: 1802,
      mix: { none: 4, transient: 2, stuck: 1, double: 1 },
      brief: "The marginal lot: one word carries an uncorrectable double-bit fault. Pass it and data corrupts silently." },
    { id: "C", name: "MODULE C, THE REFURB LOT", seed: 1803,
      mix: { none: 3, transient: 1, stuck: 2, double: 2 },
      brief: "The refurb lot: pulled from retired servers. Two stuck cells, two double-bit faults. Only a ruthless scrubber signs this one off." }
  ];

  function esHexByte(n) {
    var h = "0123456789ABCDEF";
    return h[(n >> 4) & 15] + h[n & 15];
  }

  function esGenModule(def) {
    var rng = esRng(def.seed);
    var faults = [], t;
    for (t = 0; t < def.mix.none; t++) faults.push("none");
    for (t = 0; t < def.mix.transient; t++) faults.push("transient");
    for (t = 0; t < def.mix.stuck; t++) faults.push("stuck");
    for (t = 0; t < def.mix.double; t++) faults.push("double");
    /* Fisher-Yates with the seeded rng: deterministic per module */
    for (t = faults.length - 1; t > 0; t--) {
      var k = Math.floor(rng() * (t + 1));
      var tmp = faults[t]; faults[t] = faults[k]; faults[k] = tmp;
    }
    var words = faults.map(function (type) {
      var bytes = [], i;
      for (i = 0; i < 8; i++) bytes.push(Math.floor(rng() * 256));
      var data = [];
      for (i = 0; i < 8; i++) {
        var by = bytes[i];
        for (var bit = 7; bit >= 0; bit--) data.push((by >> bit) & 1);
      }
      var bits = esEncode(data);
      var fault = { type: type };
      var history = 0;
      if (type === "transient" || type === "stuck") {
        fault.pos = 1 + Math.floor(rng() * 72);
        bits[fault.pos - 1] ^= 1;
        history = type === "stuck" ? 2 + Math.floor(rng() * 3) : Math.floor(rng() * 2);
      } else if (type === "double") {
        fault.posA = 1 + Math.floor(rng() * 72);
        do { fault.posB = 1 + Math.floor(rng() * 72); } while (fault.posB === fault.posA);
        bits[fault.posA - 1] ^= 1;
        bits[fault.posB - 1] ^= 1;
      }
      return { bytes: bytes, bits: bits, fault: fault, history: history,
               resolved: false, note: "", awaitQuarantine: false };
    });
    return { def: def, words: words, score: 0, verdict: null, verdictOk: null };
  }

  /* One adjudication. Returns {delta, note, stuckAgain}. */
  function esAdjudicate(word, action, pos) {
    var f = word.fault;
    if (action === "pass") {
      if (f.type === "none")
        return { delta: 100, note: "Clean word, passed. +100." };
      if (f.type === "double")
        return { delta: -150, note: "You passed an uncorrectable double-bit error. That is silent corruption. -150." };
      return { delta: -50,
        note: "Missed a correctable error at bit " + f.pos + ". The scrub log records it. -50." };
    }
    if (action === "quarantine") {
      if (word.awaitQuarantine)
        return { delta: 50, note: "Stuck cell offlined after the re-read proved it. +50." };
      if (f.type === "double")
        return { delta: 100, note: "Double-bit error offlined before it could corrupt data. +100." };
      if (f.type === "stuck")
        return { delta: 100,
          note: "Stuck cell at bit " + f.pos + " offlined. The history (" + word.history +
                " prior corrections) told the story. +100." };
      if (f.type === "transient")
        return { delta: 25, note: "Safe, but wasteful: a transient flip did not need offlining. +25." };
      return { delta: -25, note: "That word was clean. Capacity wasted. -25." };
    }
    /* action === "correct" */
    if (f.type === "none")
      return { delta: -50, note: "There was no error. You flipped good bit " + pos + ". -50." };
    if (f.type === "double")
      return { delta: -100,
        note: "Miscorrection: the fault was double-bit, and you flipped a third bit. -100." };
    if (pos !== f.pos)
      return { delta: -100,
        note: "Miscorrection: the flipped bit was " + f.pos + ", you corrected " + pos + ". -100." };
    if (f.type === "transient")
      return { delta: 100, note: "Bit " + pos + " corrected, re-read is clean. +100." };
    return { delta: 50, stuckAgain: true,
      note: "Bit " + pos + " corrected, but the re-read shows the same bit flipped again. " +
            "This cell is stuck. QUARANTINE it now. +50 so far." };
  }

  function esShouldShip(mod) {
    var bad = 0, i;
    for (i = 0; i < mod.words.length; i++) {
      var t = mod.words[i].fault.type;
      if (t === "stuck" || t === "double") bad++;
    }
    return bad <= 1;
  }

  function esFaultLabel(f) {
    if (f.type === "none") return "no fault";
    if (f.type === "transient") return "transient single-bit at " + f.pos;
    if (f.type === "stuck") return "stuck cell at bit " + f.pos;
    return "double-bit at " + f.posA + " and " + f.posB;
  }

  /* ---------------- DOM ---------------- */

  function esEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null && text !== "") e.textContent = text;
    return e;
  }
  function es$(id) { return document.getElementById(id); }

  var esMods = null, esModIdx = 0, esWordIdx = 0;
  var esEnc = { data: [0x3F, 0xA5, 0x00, 0x11, 0xC8, 0x42, 0x77, 0xE0], flips: {} };

  var ES_CSS = [
    ".es-overlay{position:fixed;inset:0;background:rgba(8,8,10,.82);z-index:9000;display:none;overflow-y:auto;padding:24px 16px;}",
    ".es-overlay.open{display:block;}",
    ".es-panel{max-width:900px;margin:0 auto;background:#101014;border:1px solid #2a2a30;border-radius:4px;color:#f2f0eb;font-family:'Space Grotesk',system-ui,sans-serif;}",
    ".es-bar{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #2a2a30;}",
    ".es-title{font-size:20px;letter-spacing:.14em;font-weight:700;}",
    ".es-title b{color:#ff5a1f;}",
    ".es-close{background:none;border:1px solid #3a3a42;color:#f2f0eb;border-radius:4px;min-height:48px;padding:0 18px;font-family:'IBM Plex Mono',monospace;font-size:13px;cursor:pointer;}",
    ".es-close:hover{border-color:#ff5a1f;}",
    ".es-close:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".es-body{padding:22px;}",
    ".es-sub{font-size:14px;line-height:1.6;color:#b9b6ae;margin:0 0 20px;}",
    ".es-sub b{color:#f2f0eb;}",
    ".es-sub a{color:#ff5a1f;}",
    ".es-sec{font-size:12px;letter-spacing:.14em;color:#8a877f;font-weight:700;margin:26px 0 10px;text-transform:uppercase;}",
    ".es-sec:first-of-type{margin-top:0;}",
    ".es-encrow{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px;}",
    ".es-byte{display:flex;flex-direction:column;gap:4px;}",
    ".es-byte label{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#8a877f;letter-spacing:.1em;}",
    ".es-byte input{width:64px;min-height:48px;background:#0a0a0d;border:1px solid #3a3a42;border-radius:4px;color:#f2f0eb;font-family:'IBM Plex Mono',monospace;font-size:16px;text-align:center;text-transform:uppercase;}",
    ".es-byte input:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".es-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:4px;margin:10px 0 6px;}",
    ".es-cell{aspect-ratio:1;min-height:28px;display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-size:11px;border-radius:4px;background:#0a0a0d;border:1px solid #2a2a30;color:#b9b6ae;}",
    ".es-cell.p{border-color:#ff5a1f;color:#ff5a1f;}",
    ".es-cell.q{border-color:#7dd87d;color:#7dd87d;}",
    ".es-legend{display:flex;gap:14px;flex-wrap:wrap;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a877f;margin:0 0 10px;}",
    ".es-legend b{color:#f2f0eb;}",
    ".es-read{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;}",
    ".es-stat{background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:10px 14px;min-width:130px;}",
    ".es-stat .k{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#6e6b64;letter-spacing:.1em;}",
    ".es-stat .v{font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:700;color:#f2f0eb;margin-top:4px;}",
    ".es-stat .v.warn{color:#ff5a1f;}",
    ".es-stat .v.good{color:#7dd87d;}",
    ".es-fliprow{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px;}",
    ".es-stepper{display:flex;align-items:center;gap:6px;}",
    ".es-stepper button{width:48px;min-height:48px;background:#16161b;border:1px solid #3a3a42;border-radius:4px;color:#f2f0eb;font-size:20px;cursor:pointer;}",
    ".es-stepper button:hover{border-color:#ff5a1f;}",
    ".es-stepper button:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".es-stepper input{width:72px;min-height:48px;background:#0a0a0d;border:1px solid #3a3a42;border-radius:4px;color:#f2f0eb;font-family:'IBM Plex Mono',monospace;font-size:16px;text-align:center;}",
    ".es-stepper input:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".es-btn{min-height:48px;padding:0 20px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:13px;cursor:pointer;}",
    ".es-btn:hover:not(:disabled){border-color:#ff5a1f;}",
    ".es-btn:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".es-btn:disabled{opacity:.35;cursor:default;}",
    ".es-btn.pri{background:#ff5a1f;border-color:#ff5a1f;color:#101014;font-weight:700;}",
    ".es-btn.pri:hover:not(:disabled){border-color:#ff5a1f;}",
    ".es-btn.pri:focus-visible{outline:2px solid #fff;outline-offset:2px;}",
    ".es-btn.good{border-color:#7dd87d;color:#7dd87d;}",
    ".es-btn.good:hover:not(:disabled){background:#12240f;}",
    ".es-cards{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;}",
    ".es-cardtab{flex:1;min-width:170px;min-height:64px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;cursor:pointer;font-family:'Space Grotesk',sans-serif;padding:10px 12px;text-align:left;transition:transform .1s,border-color .1s;}",
    ".es-cardtab:hover{border-color:#ff5a1f;}",
    ".es-cardtab:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".es-cardtab.sel{border-color:#ff5a1f;transform:translateY(-2px);}",
    ".es-cardtab .n{font-size:14px;font-weight:700;}",
    ".es-cardtab .s{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a877f;margin-top:4px;}",
    ".es-cardtab .s.done{color:#7dd87d;}",
    ".es-brief{font-size:13px;color:#b9b6ae;border-left:3px solid #ff5a1f;padding:8px 14px;margin:0 0 14px;line-height:1.55;}",
    ".es-words{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}",
    ".es-word{min-width:56px;min-height:48px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:13px;cursor:pointer;}",
    ".es-word:hover{border-color:#ff5a1f;}",
    ".es-word:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".es-word.sel{border-color:#ff5a1f;}",
    ".es-word.done{border-color:#7dd87d;color:#7dd87d;}",
    ".es-raw{font-family:'IBM Plex Mono',monospace;font-size:13px;line-height:2;background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:12px 16px;margin:0 0 10px;word-break:break-all;}",
    ".es-raw .lbl{font-size:10px;color:#6e6b64;letter-spacing:.1em;display:block;line-height:1.4;}",
    ".es-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0;}",
    ".es-note{font-family:'IBM Plex Mono',monospace;font-size:12px;line-height:1.7;background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:12px 16px;margin:0 0 10px;min-height:44px;white-space:pre-wrap;}",
    ".es-note .good{color:#7dd87d;}",
    ".es-note .bad{color:#ff5a1f;}",
    ".es-verdict{font-size:15px;font-weight:700;letter-spacing:.1em;padding:14px;border-radius:4px;text-align:center;margin:14px 0;border:1px solid #3a3a42;}",
    ".es-verdict.pass{border-color:#7dd87d;color:#7dd87d;}",
    ".es-verdict.fail{border-color:#ff5a1f;color:#ff5a1f;}",
    ".es-cert{border:1px solid #7dd87d;border-radius:4px;padding:18px;margin-top:14px;display:none;}",
    ".es-cert.show{display:block;}",
    ".es-cert h4{margin:0 0 8px;font-size:15px;letter-spacing:.12em;color:#7dd87d;}",
    ".es-cert p{margin:0 0 12px;font-size:13px;color:#b9b6ae;line-height:1.6;}",
    ".es-cert pre{font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.7;color:#f2f0eb;background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:12px;white-space:pre-wrap;margin:0 0 12px;}",
    "@media (prefers-reduced-motion: reduce){.es-cardtab{transition:none;}}",
    "@media (max-width:640px){.es-grid{grid-template-columns:repeat(9,1fr);}.es-byte input{width:56px;}}"
  ].join("\n");

  function esRawHex(bits) {
    var out = [];
    for (var g = 0; g < 9; g++) {
      var v = 0;
      for (var i = 0; i < 8; i++) v = (v << 1) | bits[g * 8 + i];
      out.push(esHexByte(v));
    }
    return out;
  }

  function esBitsToData(bits) {
    var data = [];
    for (var i = 0; i < 64; i++) data.push(bits[ES_DATAPOS[i] - 1]);
    return data;
  }

  function esDataToBits(bytes) {
    var data = [];
    for (var i = 0; i < 8; i++) {
      for (var bit = 7; bit >= 0; bit--) data.push((bytes[i] >> bit) & 1);
    }
    return data;
  }

  /* ---------- encoder (sandbox) ---------- */

  function esRenderEncoder() {
    var bits = esEncode(esDataToBits(esEnc.data));
    Object.keys(esEnc.flips).forEach(function (k) {
      var p = parseInt(k, 10);
      if (p >= 1 && p <= 72) bits[p - 1] ^= 1;
    });
    esEnc.bits = bits;
    var grid = es$("esGrid");
    grid.innerHTML = "";
    for (var i = 0; i < 72; i++) {
      var c = esEl("span", "es-cell", String(bits[i]));
      var pos = i + 1;
      if (pos === ES_QPOS) { c.className = "es-cell q"; c.title = "bit 72, overall parity (Q)"; }
      else if (esIsCheck(pos)) { c.className = "es-cell p"; c.title = "bit " + pos + ", parity (P)"; }
      else { c.title = "bit " + pos + ", data (D)"; }
      grid.appendChild(c);
    }
    var d = esDecode(bits);
    es$("esSyn").textContent = "0x" + (d.syndrome < 16 ? "0" : "") + d.syndrome.toString(16).toUpperCase();
    es$("esSyn").className = "v" + (d.syndrome !== 0 ? " warn" : "");
    es$("esPar").textContent = d.parityOk ? "OK" : "BAD";
    es$("esPar").className = "v" + (d.parityOk ? " good" : " warn");
    var dt = es$("esDec");
    if (d.verdict === "clean") { dt.textContent = "CLEAN, no error"; dt.className = "v good"; }
    else if (d.verdict === "single") { dt.textContent = "SINGLE-BIT at bit " + d.pos; dt.className = "v warn"; }
    else { dt.textContent = "DOUBLE-BIT, uncorrectable"; dt.className = "v warn"; }
  }

  function esFlip(pos) {
    if (pos < 1 || pos > 72) return;
    if (esEnc.flips[pos]) delete esEnc.flips[pos];
    else esEnc.flips[pos] = 1;
    esRenderEncoder();
  }

  /* ---------- trials ---------- */

  function esMod() { return esMods[esModIdx]; }
  function esWord() { return esMod().words[esWordIdx]; }

  function esModStatus(m) {
    var n = 0, i;
    for (i = 0; i < m.words.length; i++) if (m.words[i].resolved) n++;
    return n + " / " + m.words.length + " RESOLVED";
  }

  function esRenderCards() {
    var box = es$("esCards");
    box.innerHTML = "";
    esMods.forEach(function (m, i) {
      var b = esEl("button", "es-cardtab" + (i === esModIdx ? " sel" : ""), "");
      b.type = "button";
      b.setAttribute("aria-label", m.def.name + ", " + esModStatus(m) + ", score " + m.score);
      var n = esEl("div", "n", m.def.name);
      var s = esEl("div", "s" + (m.verdict ? " done" : ""), "");
      s.textContent = m.verdict ? (m.verdictOk ? "SIGNED " : "MISSED ") + m.verdict.toUpperCase() + " " + m.score :
        esModStatus(m) + "  SCORE " + m.score;
      b.appendChild(n); b.appendChild(s);
      (function (idx) {
        b.addEventListener("click", function () {
          esModIdx = idx; esWordIdx = 0; esRenderAll();
        });
      })(i);
      box.appendChild(b);
    });
    es$("esBrief").textContent = esMod().def.brief;
  }

  function esRenderWords() {
    var box = es$("esWords");
    box.innerHTML = "";
    esMod().words.forEach(function (w, i) {
      var b = esEl("button", "es-word" + (i === esWordIdx ? " sel" : "") + (w.resolved ? " done" : ""), "W" + (i + 1));
      b.type = "button";
      b.setAttribute("aria-label", "word " + (i + 1) + (w.resolved ? ", resolved" : ", unresolved"));
      (function (idx) {
        b.addEventListener("click", function () { esWordIdx = idx; esRenderAll(); });
      })(i);
      box.appendChild(b);
    });
  }

  function esRenderReadout() {
    var m = esMod(), w = esWord();
    var raw = es$("esRaw");
    raw.innerHTML = "";
    var lbl = esEl("span", "lbl", "RECEIVED CODEWORD, 72 BITS (9 BYTES, POSITION 1 FIRST)");
    raw.appendChild(lbl);
    raw.appendChild(document.createTextNode(esRawHex(w.bits).join(" ")));
    var d = esDecode(w.bits);
    var hw = es$("esHW");
    hw.innerHTML = "";
    var stats = [
      ["SYNDROME", "0x" + (d.syndrome < 16 ? "0" : "") + d.syndrome.toString(16).toUpperCase(), d.syndrome !== 0],
      ["OVERALL PARITY", d.parityOk ? "OK" : "BAD", !d.parityOk],
      ["PRIOR CORRECTIONS", String(w.history), w.history >= 2],
      ["MODULE SCORE", String(m.score), false]
    ];
    stats.forEach(function (st) {
      var s = esEl("div", "es-stat", "");
      s.appendChild(esEl("div", "k", st[0]));
      var v = esEl("div", "v" + (st[2] ? " warn" : ""), st[1]);
      s.appendChild(v);
      hw.appendChild(s);
    });
    var ws = es$("esWStatus");
    ws.textContent = w.resolved ? "RESOLVED: " + w.note : "UNRESOLVED: make the call.";
    var canAct = !w.resolved;
    es$("esPass").disabled = !canAct || w.awaitQuarantine;
    es$("esCorrect").disabled = !canAct || w.awaitQuarantine;
    es$("esQuar").disabled = !canAct;
    es$("esPosMinus").disabled = !canAct || w.awaitQuarantine;
    es$("esPosPlus").disabled = !canAct || w.awaitQuarantine;
    es$("esPos").disabled = !canAct || w.awaitQuarantine;
    var note = es$("esNote");
    note.innerHTML = "";
    note.appendChild(document.createTextNode(w.note || "The jig hands you the syndrome and the parity flag, exactly like the ECC hardware does. The fault underneath is yours to judge."));
  }

  function esRenderVerdictRow() {
    var m = esMod();
    var row = es$("esVerdictRow");
    row.innerHTML = "";
    var all = m.words.every(function (w) { return w.resolved; });
    if (!all || m.verdict) {
      if (m.verdict) {
        var v = esEl("div", "es-verdict " + (m.verdictOk ? "pass" : "fail"),
          m.verdictOk ? "MODULE " + m.verdict.toUpperCase() + ", CORRECT CALL" :
                        "MODULE " + m.verdict.toUpperCase() + ", WRONG CALL");
        row.appendChild(v);
      }
      return;
    }
    var lab = esEl("span", "", "");
    lab.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:12px;color:#8a877f;";
    lab.textContent = "All 8 words scrubbed. Make the module call:";
    row.appendChild(lab);
    var ship = esEl("button", "es-btn good", "SHIP MODULE");
    ship.type = "button"; ship.id = "esShipBtn";
    ship.addEventListener("click", function () { esVerdict("ship"); });
    var rma = esEl("button", "es-btn", "RMA MODULE");
    rma.type = "button"; rma.id = "esRmaBtn";
    rma.addEventListener("click", function () { esVerdict("rma"); });
    row.appendChild(ship); row.appendChild(rma);
  }

  function esAct(action) {
    var m = esMod(), w = esWord();
    if (w.resolved) return;
    var pos = parseInt(es$("esPos").value, 10);
    if (action === "correct" && (isNaN(pos) || pos < 1 || pos > 72)) {
      if (typeof toast === "function") toast("Pick a bit position from 1 to 72 first.");
      return;
    }
    var r = esAdjudicate(w, action, pos);
    m.score += r.delta;
    if (r.stuckAgain) {
      /* right bit, but the cell is stuck: correct once, then it must be quarantined */
      w.bits[pos - 1] ^= 1;
      var back = esDecode(w.bits);
      w.awaitQuarantine = true;
      w.note = "PARTIAL: " + r.note + " (re-read syndrome 0x" +
        (back.syndrome < 16 ? "0" : "") + back.syndrome.toString(16).toUpperCase() + ")";
    } else if (action === "quarantine" && w.awaitQuarantine) {
      /* second half of the stuck-cell sequence */
      w.note = r.note;
      w.resolved = true;
      w.awaitQuarantine = false;
    } else {
      if (action === "correct" && r.delta > 0 && w.fault.type === "transient") {
        w.bits[pos - 1] ^= 1; /* write-back, verified clean */
      }
      if (action === "correct" && r.delta < 0 && w.fault.type === "none") {
        w.bits[pos - 1] ^= 1; /* you broke a good word: show it */
      }
      w.note = (r.delta >= 0 ? "GOOD CALL: " : "BAD CALL: ") + r.note +
        " Truth: " + esFaultLabel(w.fault) + ".";
      w.resolved = true;
    }
    esRenderAll();
    esCheckDone();
  }

  function esVerdict(call) {
    var m = esMod();
    if (m.verdict) return;
    var truth = esShouldShip(m) ? "ship" : "rma";
    m.verdict = call;
    m.verdictOk = (call === truth);
    m.score += m.verdictOk ? 200 : -200;
    esRenderAll();
    esCheckDone();
  }

  function esCheckDone() {
    var all = esMods.every(function (m) { return m.verdict; });
    if (!all) return;
    var cert = es$("esCert");
    var okAll = esMods.every(function (m) { return m.verdictOk; });
    var total = esMods.reduce(function (a, m) { return a + m.score; }, 0);
    cert.classList.add("show");
    var h = es$("esCertHead");
    h.textContent = okAll ? "SCRUB BAY QUALIFIED" : "QUALIFICATION FAILED";
    es$("esCertBody").textContent = okAll ?
      "All three module calls were correct. Total scrub score " + total + " of 3000. " +
      "This bench certifies the operator can run ECC qualification for TAPEOUT GDDR. Sign below and download the report." :
      "One or more module calls were wrong. Total scrub score " + total + " of 3000. " +
      "The modules keep their faults; run the scrub again and read the histories.";
    es$("esDl").disabled = false;
    esRenderReport();
  }

  function esBuildReport(mods) {
    mods = mods || esMods;
    if (!mods) return "";
    var L = [];
    L.push("THE SCRUB BAY, ECC QUALIFICATION REPORT");
    L.push("Hamming(72,64) SECDED, 8 codewords per module");
    L.push("==========================================");
    mods.forEach(function (m) {
      L.push("");
      L.push(m.def.name + "  score " + m.score + " / 1000");
      m.words.forEach(function (w, i) {
        L.push("  W" + (i + 1) + ": truth=" + esFaultLabel(w.fault) +
               " history=" + w.history + " :: " + w.note.replace(/\s+/g, " "));
      });
      L.push("  module call: " + (m.verdict ? m.verdict.toUpperCase() : "NONE") +
             " (" + (m.verdict ? (m.verdictOk ? "correct" : "WRONG") : "undecided") + ", truth=" +
             (esShouldShip(m) ? "SHIP" : "RMA") + ")");
    });
    var total = mods.reduce(function (a, m) { return a + m.score; }, 0);
    L.push("");
    L.push("TOTAL " + total + " / 3000");
    L.push("Signed: the operator, The Proving Ground");
    return L.join("\n");
  }

  function esRenderReport() {
    es$("esCertPre").textContent = esBuildReport();
  }

  function esRenderAll() {
    esRenderCards();
    esRenderWords();
    esRenderReadout();
    esRenderVerdictRow();
  }

  /* ---------- shell ---------- */

  function esBuildShell() {
    var css = document.createElement("style");
    css.textContent = ES_CSS;
    document.head.appendChild(css);

    var box = document.querySelector(".dossier .actions");
    if (box && !es$("esBtn")) {
      var b = esEl("button", "secondary", "Run the Scrub Bay");
      b.id = "esBtn";
      b.addEventListener("click", function () {
        es$("esOverlay").classList.add("open");
      });
      box.appendChild(b);
    }

    var ov = esEl("div", "es-overlay");
    ov.id = "esOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "The Scrub Bay");
    var panel = esEl("div", "es-panel");
    ov.appendChild(panel);
    document.body.appendChild(ov);

    var bar = esEl("div", "es-bar");
    var title = esEl("div", "es-title", "");
    title.innerHTML = "THE <b>SCRUB</b> BAY";
    var close = esEl("button", "es-close", "CLOSE [x]");
    close.type = "button";
    close.id = "esCloseBtn";
    close.addEventListener("click", function () { ov.classList.remove("open"); });
    bar.appendChild(title); bar.appendChild(close);
    panel.appendChild(bar);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("open"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("open")) ov.classList.remove("open");
    });

    var body = esEl("div", "es-body");
    panel.appendChild(body);

    var sub = esEl("p", "es-sub", "");
    sub.innerHTML = "<b>HOW IT WORKS</b> GDDR ships with SECDED error correction: 64 data bits, " +
      "7 parity bits, 1 overall check. Read the syndrome the hardware hands you, correct single-bit " +
      "flips, quarantine doubles and stuck cells, then call SHIP or RMA on three VRAM modules. " +
      "Built for <a href=\"https://dillingerstaffing.github.io/tapeout/\" " +
      "target=\"_blank\" rel=\"noopener\">TAPEOUT</a> memory qualification.";
    body.appendChild(sub);

    /* encoder */
    body.appendChild(esEl("h3", "es-sec", "Encoder, learn the machinery"));
    var encrow = esEl("div", "es-encrow");
    var inputs = [];
    for (var i = 0; i < 8; i++) {
      (function (idx) {
        var wrap = esEl("div", "es-byte");
        var lab = esEl("label", "", "B" + (idx + 1));
        lab.setAttribute("for", "es-in" + idx);
        var inp = document.createElement("input");
        inp.id = "es-in" + idx;
        inp.maxLength = 2;
        inp.setAttribute("aria-label", "data byte " + (idx + 1) + ", hex");
        inp.value = esHexByte(esEnc.data[idx]);
        inp.addEventListener("input", function () {
          var v = inp.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 2).toUpperCase();
          inp.value = v;
          if (v.length === 2) {
            esEnc.data[idx] = parseInt(v, 16);
            esRenderEncoder();
          }
        });
        inputs.push(inp);
        wrap.appendChild(lab); wrap.appendChild(inp);
        encrow.appendChild(wrap);
      })(i);
    }
    var encBtn = esEl("button", "es-btn pri", "ENCODE");
    encBtn.type = "button"; encBtn.id = "esEncodeBtn";
    encBtn.addEventListener("click", esRenderEncoder);
    encrow.appendChild(encBtn);
    body.appendChild(encrow);

    var grid = esEl("div", "es-grid");
    grid.id = "esGrid";
    grid.setAttribute("role", "img");
    grid.setAttribute("aria-label", "72-bit codeword grid");
    body.appendChild(grid);
    var legend = esEl("p", "es-legend", "");
    legend.innerHTML = "<span><b>D</b> data bit</span><span><b>P</b> parity bit</span><span><b>Q</b> overall parity</span><span>hover a cell for its bit position</span>";
    body.appendChild(legend);

    var read = esEl("div", "es-read");
    [["SYNDROME", "esSyn"], ["OVERALL PARITY", "esPar"], ["DECODER", "esDec"]].forEach(function (d) {
      var s = esEl("div", "es-stat", "");
      s.appendChild(esEl("div", "k", d[0]));
      var v = esEl("div", "v", "--"); v.id = d[1];
      s.appendChild(v);
      read.appendChild(s);
    });
    body.appendChild(read);

    var fliprow = esEl("div", "es-fliprow");
    var lab = esEl("span", "", "");
    lab.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:12px;color:#8a877f;";
    lab.textContent = "Flip a bit to watch the syndrome move:";
    fliprow.appendChild(lab);
    var stepper = esEl("div", "es-stepper");
    var minus = esEl("button", "", "-");
    minus.type = "button"; minus.id = "esFlipMinus"; minus.setAttribute("aria-label", "decrease bit position");
    var finp = document.createElement("input");
    finp.id = "esFlipPos"; finp.value = "1";
    finp.setAttribute("aria-label", "bit position to flip, 1 to 72");
    finp.inputMode = "numeric";
    var plus = esEl("button", "", "+");
    plus.type = "button"; plus.id = "esFlipPlus"; plus.setAttribute("aria-label", "increase bit position");
    var step = function (dlt) {
      var v = parseInt(finp.value, 10);
      if (isNaN(v)) v = 1;
      v = Math.min(72, Math.max(1, v + dlt));
      finp.value = String(v);
    };
    minus.addEventListener("click", function () { step(-1); });
    plus.addEventListener("click", function () { step(1); });
    var flipBtn = esEl("button", "es-btn", "FLIP BIT");
    flipBtn.type = "button"; flipBtn.id = "esFlipBtn";
    flipBtn.addEventListener("click", function () {
      var v = parseInt(finp.value, 10);
      if (!isNaN(v)) esFlip(Math.min(72, Math.max(1, v)));
    });
    stepper.appendChild(minus); stepper.appendChild(finp); stepper.appendChild(plus);
    fliprow.appendChild(stepper); fliprow.appendChild(flipBtn);
    body.appendChild(fliprow);

    /* trials */
    body.appendChild(esEl("h3", "es-sec", "Scrub trials, three VRAM modules"));
    var cards = esEl("div", "es-cards"); cards.id = "esCards"; body.appendChild(cards);
    var brief = esEl("p", "es-brief", ""); brief.id = "esBrief"; body.appendChild(brief);
    var words = esEl("div", "es-words"); words.id = "esWords"; body.appendChild(words);

    var raw = esEl("div", "es-raw", ""); raw.id = "esRaw"; body.appendChild(raw);
    var hw = esEl("div", "es-read"); hw.id = "esHW"; body.appendChild(hw);
    var wstatus = esEl("p", "es-note", ""); wstatus.id = "esWStatus"; body.appendChild(wstatus);

    var actions = esEl("div", "es-actions");
    var pass = esEl("button", "es-btn", "PASS, NO ACTION");
    pass.type = "button"; pass.id = "esPass";
    pass.addEventListener("click", function () { esAct("pass"); });
    actions.appendChild(pass);
    var cstep = esEl("div", "es-stepper");
    var cminus = esEl("button", "", "-");
    cminus.type = "button"; cminus.id = "esPosMinus"; cminus.setAttribute("aria-label", "decrease bit position");
    var cinp = document.createElement("input");
    cinp.id = "esPos"; cinp.value = "1";
    cinp.setAttribute("aria-label", "suspect bit position, 1 to 72");
    cinp.inputMode = "numeric";
    var cplus = esEl("button", "", "+");
    cplus.type = "button"; cplus.id = "esPosPlus"; cplus.setAttribute("aria-label", "increase bit position");
    var cstepf = function (dlt) {
      var v = parseInt(cinp.value, 10);
      if (isNaN(v)) v = 1;
      v = Math.min(72, Math.max(1, v + dlt));
      cinp.value = String(v);
    };
    cminus.addEventListener("click", function () { cstepf(-1); });
    cplus.addEventListener("click", function () { cstepf(1); });
    cstep.appendChild(cminus); cstep.appendChild(cinp); cstep.appendChild(cplus);
    actions.appendChild(cstep);
    var corr = esEl("button", "es-btn pri", "CORRECT BIT");
    corr.type = "button"; corr.id = "esCorrect";
    corr.addEventListener("click", function () { esAct("correct"); });
    actions.appendChild(corr);
    var quar = esEl("button", "es-btn", "QUARANTINE WORD");
    quar.type = "button"; quar.id = "esQuar";
    quar.addEventListener("click", function () { esAct("quarantine"); });
    actions.appendChild(quar);
    body.appendChild(actions);

    var note = esEl("p", "es-note", ""); note.id = "esNote"; body.appendChild(note);
    var vrow = esEl("div", "es-actions"); vrow.id = "esVerdictRow"; body.appendChild(vrow);

    var cert = esEl("div", "es-cert"); cert.id = "esCert";
    cert.appendChild(esEl("h4", "", "SCRUB BAY CERTIFICATE"));
    var ch = esEl("p", "", ""); ch.id = "esCertHead"; cert.appendChild(ch);
    var cb = esEl("p", "", ""); cb.id = "esCertBody"; cert.appendChild(cb);
    var pre = esEl("pre", "", ""); pre.id = "esCertPre"; cert.appendChild(pre);
    var dl = esEl("button", "es-btn good", "DOWNLOAD REPORT");
    dl.type = "button"; dl.id = "esDl"; dl.disabled = true;
    dl.addEventListener("click", function () {
      var a = document.createElement("a");
      a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(esBuildReport());
      a.download = "scrub-bay-report.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (typeof toast === "function") toast("Report downloaded.");
    });
    cert.appendChild(dl);
    body.appendChild(cert);

    esRenderEncoder();
    esRenderAll();
  }

  function esInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    if (!esMods) esMods = ES_MODULES.map(esGenModule);
    esBuildShell();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", esInit);
    } else {
      esInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      ES: {
        encode: esEncode, decode: esDecode, genModule: esGenModule,
        adjudicate: esAdjudicate, shouldShip: esShouldShip,
        MODULES: ES_MODULES, DATAPOS: ES_DATAPOS, hexByte: esHexByte,
        buildReport: esBuildReport
      }
    });
  }

})();

/* ============================================================
   THE REFLOW BAY
   Reflow-oven qualification bench for the TAPEOUT bring-up lab.
   Three GPU boards run through one oven profile: real SAC305
   thermal physics under the hood (liquidus 217 C, scorch line
   260 C), modeled as a first-order joint-temperature lag per
   board. A damp-storage board popcorn-cracks if its joints ramp
   faster than 2.2 C/s unless baked out first; a 4 oz copper pour
   lags the air and needs a hotter, longer peak. Tune ramp, soak,
   peak, and dwell, read the joint traces on the scope, and ship
   all three boards.
   ============================================================ */
(function () {
  "use strict";

  var rf$ = function (id) { return document.getElementById(id); };
  function rfToast(msg) { if (typeof toast === "function") toast(msg); }
  function rfEl(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  var RF_REDUCED = (typeof window !== "undefined" && window.matchMedia) ?
    window.matchMedia("(prefers-reduced-motion: reduce)").matches : true;

  /* ---- physics constants ---- */
  var RF_LIQ = 217;      /* SAC305 liquidus, C */
  var RF_SCORCH = 260;   /* damage line, C */
  var RF_POP_RAMP = 2.2; /* joint ramp limit for damp boards, C/s */
  var RF_WET_PEAK = 228; /* liquidus plus margin, C */
  var RF_WET_TAL = 40;   /* minimum time above liquidus, s */

  var RF_BOARDS = [
    { id: "REF-01", sub: "clean 2-layer", tau: 8, moist: false,
      note: "Standard 2-layer, dry storage. The reference board." },
    { id: "HVY-02", sub: "4 oz copper pour", tau: 18, moist: false,
      note: "Heavy planes act as a thermal sink: the joints lag the air. Needs a hotter, longer peak." },
    { id: "MST-03", sub: "MSL-3 expired", tau: 8, moist: true,
      note: "Sat in damp storage. Joints ramping past 2.2 C/s popcorn-crack. Bake it out first." }
  ];
  var RF_COLORS = ["#f2ede3", "#7cc4ff", "#7de0a8"];
  var rfBaked = { "MST-03": false };

  var RF_KNOBS = [
    { key: "ramp", id: "rfRamp", label: "RAMP RATE", unit: "C/s",
      min: 1.0, max: 3.0, step: 0.1, val: 2.0,
      tip: "How fast the oven air climbs. Damp boards hate a fast ramp." },
    { key: "soak", id: "rfSoak", label: "SOAK DWELL AT 160 C", unit: "s",
      min: 30, max: 180, step: 5, val: 90,
      tip: "Hold at 160 C so every joint equalizes before the spike." },
    { key: "peak", id: "rfPeak", label: "PEAK TEMP", unit: "C",
      min: 220, max: 265, step: 1, val: 245,
      tip: "Oven air peak. Joints lag behind; the copper sink needs the headroom." },
    { key: "dwell", id: "rfDwell", label: "PEAK DWELL", unit: "s",
      min: 20, max: 120, step: 5, val: 60,
      tip: "Time held at peak so lagging joints catch up and wet." }
  ];

  /* Oven air profile at 1 s resolution: ramp to 160, soak, ramp to peak,
     hold, then fixed 2.5 C/s cool to 60. */
  function rfGenAir(ramp, soak, peak, dwell) {
    var t = [25], cur = 25, i;
    while (cur < 160) { cur = Math.min(160, cur + ramp); t.push(cur); }
    for (i = 0; i < soak; i++) t.push(160);
    while (cur < peak) { cur = Math.min(peak, cur + ramp); t.push(cur); }
    for (i = 0; i < dwell; i++) t.push(peak);
    while (cur > 60) { cur = Math.max(60, cur - 2.5); t.push(cur); }
    return t;
  }

  /* First-order joint lag: Tj tracks the air with time constant tau. */
  function rfSimBoard(air, tau) {
    var a = 1 - Math.exp(-1 / tau), Tj = 25, i;
    var trace = [25], maxRamp = 0, tal = 0, pk = 25;
    for (i = 1; i < air.length; i++) {
      var prev = Tj;
      Tj += a * (air[i] - Tj);
      trace.push(Tj);
      var r = Tj - prev;
      if (r > maxRamp) maxRamp = r;
      if (Tj >= RF_LIQ) tal++;
      if (Tj > pk) pk = Tj;
    }
    return { trace: trace, maxRamp: maxRamp, tal: tal, peak: pk };
  }

  function rfAdjudicate(b, sim) {
    if (b.moist && !rfBaked[b.id] && sim.maxRamp > RF_POP_RAMP) {
      return { v: "SCRAP", why: b.id + " popcorn-cracked: joints ramped at " +
        sim.maxRamp.toFixed(1) + " C/s, over the 2.2 C/s limit for a damp board. " +
        "Bake it out or slow the ramp." };
    }
    if (sim.peak > RF_SCORCH) {
      return { v: "SCRAP", why: b.id + " scorched: joint peak " + Math.round(sim.peak) +
        " C crossed the 260 C damage line. Drop the peak." };
    }
    if (sim.peak < RF_WET_PEAK) {
      return { v: "REWORK", why: b.id + " has cold joints: peak " + Math.round(sim.peak) +
        " C never cleared liquidus plus margin (228 C). Raise peak or dwell." };
    }
    if (sim.tal < RF_WET_TAL) {
      return { v: "REWORK", why: b.id + " has cold joints: only " + sim.tal +
        " s above liquidus, needs 40 s for full wetting. Lengthen the peak dwell." };
    }
    return { v: "SHIP", why: b.id + " wet clean: peak " + Math.round(sim.peak) + " C, " +
      sim.tal + " s above liquidus, max joint ramp " + sim.maxRamp.toFixed(1) + " C/s." };
  }

  var RF_CSS = [
    ".rf-overlay{position:fixed;inset:0;background:rgba(8,8,10,.82);z-index:9000;display:none;overflow-y:auto;padding:24px 16px;}",
    ".rf-overlay.open{display:block;}",
    ".rf-panel{max-width:960px;margin:0 auto;background:#101014;border:1px solid #2a2a30;border-radius:4px;color:#f2f0eb;font-family:'Space Grotesk',system-ui,sans-serif;}",
    ".rf-bar{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #2a2a30;}",
    ".rf-title{font-size:20px;letter-spacing:.14em;font-weight:700;}",
    ".rf-title b{color:#ff5a1f;}",
    ".rf-close{background:none;border:1px solid #3a3a42;color:#f2f0eb;border-radius:4px;min-height:48px;padding:0 18px;font-family:'IBM Plex Mono',monospace;font-size:13px;cursor:pointer;}",
    ".rf-close:hover{border-color:#ff5a1f;}",
    ".rf-close:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".rf-body{padding:22px;}",
    ".rf-sub{font-size:14px;line-height:1.6;color:#b9b6ae;margin:0 0 20px;}",
    ".rf-sub b{color:#f2f0eb;}",
    ".rf-sub a{color:#ff5a1f;}",
    ".rf-sec{font-size:12px;letter-spacing:.14em;color:#8a877f;font-weight:700;margin:26px 0 10px;text-transform:uppercase;}",
    ".rf-sec:first-of-type{margin-top:0;}",
    ".rf-boards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:6px;}",
    ".rf-bcard{background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:12px 14px;}",
    ".rf-bcard .bn{font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;color:#f2f0eb;}",
    ".rf-bcard .bs{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#8a877f;letter-spacing:.1em;text-transform:uppercase;margin-top:2px;}",
    ".rf-bcard .bnote{font-size:12px;line-height:1.55;color:#b9b6ae;margin:8px 0 10px;}",
    ".rf-knobs{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-bottom:14px;}",
    ".rf-knob{background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:12px 14px;}",
    ".rf-knob label{display:block;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.1em;color:#8a877f;margin-bottom:2px;}",
    ".rf-knob .tip{font-size:11px;color:#6e6b64;margin:0 0 8px;}",
    ".rf-knob .val{font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:700;color:#ff5a1f;margin-bottom:8px;}",
    ".rf-knob input[type=range]{width:100%;min-height:48px;accent-color:#ff5a1f;cursor:pointer;}",
    ".rf-knob input[type=range]:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".rf-btn{min-height:48px;padding:0 20px;border:1px solid #3a3a42;background:#16161b;color:#f2f0eb;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:13px;cursor:pointer;}",
    ".rf-btn:hover:not(:disabled){border-color:#ff5a1f;}",
    ".rf-btn:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px;}",
    ".rf-btn:disabled{opacity:.35;cursor:default;}",
    ".rf-btn.pri{background:#ff5a1f;border-color:#ff5a1f;color:#101014;font-weight:700;}",
    ".rf-btn.sm{min-height:48px;padding:0 14px;font-size:12px;}",
    ".rf-btn[aria-pressed=true]{border-color:#7de0a8;color:#7de0a8;}",
    ".rf-scopewrap{background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:10px;margin-bottom:8px;}",
    ".rf-scope{width:100%;height:auto;display:block;}",
    ".rf-legend{display:flex;gap:14px;flex-wrap:wrap;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#8a877f;margin:0 0 12px;}",
    ".rf-legend .sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:baseline;}",
    ".rf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:12px;}",
    ".rf-stat{background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:10px 14px;}",
    ".rf-stat .k{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#6e6b64;letter-spacing:.1em;}",
    ".rf-stat .v{font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:700;color:#f2f0eb;margin-top:4px;}",
    ".rf-stat .v.ship{color:#7de0a8;}",
    ".rf-stat .v.rework{color:#ffbe4d;}",
    ".rf-stat .v.scrap{color:#ff5d5d;}",
    ".rf-note{font-size:13px;line-height:1.65;color:#b9b6ae;margin:0 0 10px;}",
    ".rf-note b{color:#f2f0eb;}",
    ".rf-verdict{font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:700;letter-spacing:.08em;padding:14px 16px;border:1px solid #3a3a42;border-radius:4px;margin:14px 0 0;}",
    ".rf-verdict.win{border-color:#7de0a8;color:#7de0a8;}",
    ".rf-verdict.lose{border-color:#ffbe4d;color:#ffbe4d;}",
    ".rf-cert{display:none;margin-top:16px;border:1px solid #7de0a8;border-radius:4px;padding:16px 18px;}",
    ".rf-cert.show{display:block;}",
    ".rf-cert h4{font-size:13px;letter-spacing:.14em;color:#7de0a8;margin:0 0 8px;}",
    ".rf-cert p{font-size:12px;line-height:1.6;color:#b9b6ae;margin:0 0 8px;}",
    ".rf-cert pre{font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.7;color:#f2f0eb;background:#0a0a0d;border:1px solid #2a2a30;border-radius:4px;padding:10px 12px;white-space:pre-wrap;margin:0 0 12px;}",
    "@media (max-width:640px){.rf-body{padding:16px;}.rf-bar{padding:14px 16px;}}",
    "@media (prefers-reduced-motion:reduce){.rf-overlay *{transition:none!important;}}"
  ].join("\n");

  var rfLastRun = null;

  function rfBuildShell() {
    var css = document.createElement("style");
    css.textContent = RF_CSS;
    document.head.appendChild(css);

    var box = document.querySelector(".dossier .actions");
    if (box && !rf$("rfBtn")) {
      var b = rfEl("button", "secondary", "Run the Reflow Bay");
      b.id = "rfBtn";
      b.addEventListener("click", function () {
        rf$("rfOverlay").classList.add("open");
      });
      box.appendChild(b);
    }

    var ov = rfEl("div", "rf-overlay");
    ov.id = "rfOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "The Reflow Bay");
    var panel = rfEl("div", "rf-panel");
    ov.appendChild(panel);
    document.body.appendChild(ov);

    var bar = rfEl("div", "rf-bar");
    var title = rfEl("div", "rf-title", "");
    title.innerHTML = "THE <b>REFLOW</b> BAY";
    var close = rfEl("button", "rf-close", "CLOSE [x]");
    close.type = "button";
    close.id = "rfCloseBtn";
    close.addEventListener("click", function () { ov.classList.remove("open"); });
    bar.appendChild(title); bar.appendChild(close);
    panel.appendChild(bar);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("open"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("open")) ov.classList.remove("open");
    });

    var body = rfEl("div", "rf-body");
    panel.appendChild(body);

    var sub = rfEl("p", "rf-sub", "");
    sub.innerHTML = "<b>HOW IT WORKS</b> Tune one oven profile for three GPU boards on the " +
      "TAPEOUT bring-up line. Real SAC305 physics under the hood: liquidus 217 C, scorch line " +
      "260 C, joints that lag the air. One board sat in damp storage, one carries a 4 oz copper " +
      "sink. Bake what needs baking, read the joint traces, ship all three. Built for " +
      "<a href=\"https://dillingerstaffing.github.io/tapeout/\" target=\"_blank\" " +
      "rel=\"noopener\">TAPEOUT</a> board qualification.";
    body.appendChild(sub);

    /* boards */
    body.appendChild(rfEl("h3", "rf-sec", "The boards"));
    var bc = rfEl("div", "rf-boards");
    RF_BOARDS.forEach(function (bd) {
      var card = rfEl("div", "rf-bcard");
      card.appendChild(rfEl("div", "bn", bd.id));
      card.appendChild(rfEl("div", "bs", bd.sub));
      var nt = rfEl("p", "bnote", "");
      nt.textContent = bd.note;
      card.appendChild(nt);
      if (bd.moist) {
        var bk = rfEl("button", "rf-btn sm", "BAKE OUT 24H: OFF");
        bk.type = "button";
        bk.id = "rfBake";
        bk.setAttribute("aria-pressed", "false");
        bk.setAttribute("aria-label", "Bake out MST-03 for 24 hours at 125 C to drive off moisture");
        bk.addEventListener("click", function () {
          rfBaked[bd.id] = !rfBaked[bd.id];
          bk.setAttribute("aria-pressed", String(rfBaked[bd.id]));
          bk.textContent = "BAKE OUT 24H: " + (rfBaked[bd.id] ? "ON" : "OFF");
          rfToast(rfBaked[bd.id] ? "MST-03 baked: moisture driven off, ramp freely." : "Bake-out off: damp board again.");
        });
        card.appendChild(bk);
      } else {
        var nb = rfEl("p", "bnote", "");
        nb.textContent = "Dry board: no bake needed.";
        card.appendChild(nb);
      }
      bc.appendChild(card);
    });
    body.appendChild(bc);

    /* knobs */
    body.appendChild(rfEl("h3", "rf-sec", "Profile knobs"));
    var kn = rfEl("div", "rf-knobs");
    RF_KNOBS.forEach(function (k) {
      var wrap = rfEl("div", "rf-knob");
      var lab = rfEl("label", "", k.label);
      lab.setAttribute("for", k.id);
      wrap.appendChild(lab);
      var tip = rfEl("p", "tip", "");
      tip.textContent = k.tip;
      wrap.appendChild(tip);
      var val = rfEl("div", "val", k.val.toFixed(1) + " " + k.unit);
      val.id = k.id + "V";
      wrap.appendChild(val);
      var inp = document.createElement("input");
      inp.type = "range";
      inp.id = k.id;
      inp.min = String(k.min); inp.max = String(k.max);
      inp.step = String(k.step); inp.value = String(k.val);
      inp.setAttribute("aria-label", k.label + ", " + k.min + " to " + k.max + " " + k.unit);
      (function (kk, vv, ii) {
        ii.addEventListener("input", function () {
          vv.textContent = parseFloat(ii.value).toFixed(1) + " " + kk.unit;
        });
      })(k, val, inp);
      wrap.appendChild(inp);
      kn.appendChild(wrap);
    });
    body.appendChild(kn);

    var run = rfEl("button", "rf-btn pri", "RUN PROFILE");
    run.type = "button";
    run.id = "rfRun";
    run.addEventListener("click", rfRunProfile);
    body.appendChild(run);

    /* scope */
    body.appendChild(rfEl("h3", "rf-sec", "Scope, joint traces"));
    var sw = rfEl("div", "rf-scopewrap");
    var cv = document.createElement("canvas");
    cv.id = "rfScope";
    cv.className = "rf-scope";
    cv.width = 920; cv.height = 300;
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", "Temperature traces: oven air and the three board joint temperatures against time");
    sw.appendChild(cv);
    body.appendChild(sw);
    var lg = rfEl("div", "rf-legend");
    lg.innerHTML =
      "<span><span class=\"sw\" style=\"background:#9aa3ad\"></span>OVEN AIR</span>" +
      "<span><span class=\"sw\" style=\"background:#f2ede3\"></span>REF-01 JOINT</span>" +
      "<span><span class=\"sw\" style=\"background:#7cc4ff\"></span>HVY-02 JOINT</span>" +
      "<span><span class=\"sw\" style=\"background:#7de0a8\"></span>MST-03 JOINT</span>" +
      "<span><span class=\"sw\" style=\"background:#ff5a1f\"></span>LIQUIDUS 217 C</span>" +
      "<span><span class=\"sw\" style=\"background:#ff5d5d\"></span>SCORCH 260 C</span>";
    body.appendChild(lg);

    var read = rfEl("div", "rf-stats");
    read.id = "rfRead";
    body.appendChild(read);
    var note = rfEl("p", "rf-note", "");
    note.id = "rfNote";
    note.innerHTML = "No profile run yet. Set the knobs and press <b>RUN PROFILE</b>.";
    body.appendChild(note);
    var vr = rfEl("div", "rf-verdict", "");
    vr.id = "rfVerdict";
    vr.style.display = "none";
    body.appendChild(vr);

    var cert = rfEl("div", "rf-cert");
    cert.id = "rfCert";
    cert.appendChild(rfEl("h4", "", "REFLOW BAY CERTIFICATE"));
    var ch = rfEl("p", "", ""); ch.id = "rfCertHead"; cert.appendChild(ch);
    var cb = rfEl("p", "", ""); cb.id = "rfCertBody"; cert.appendChild(cb);
    var pre = rfEl("pre", "", ""); pre.id = "rfCertPre"; cert.appendChild(pre);
    var dl = rfEl("button", "rf-btn", "DOWNLOAD REPORT");
    dl.type = "button"; dl.id = "rfDl"; dl.disabled = true;
    dl.addEventListener("click", function () {
      var a = document.createElement("a");
      a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(rfBuildReport());
      a.download = "reflow-bay-report.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      rfToast("Report downloaded.");
    });
    cert.appendChild(dl);
    body.appendChild(cert);
  }

  function rfKnob(key) {
    for (var i = 0; i < RF_KNOBS.length; i++) {
      if (RF_KNOBS[i].key === key) return parseFloat(rf$(RF_KNOBS[i].id).value);
    }
    return NaN;
  }

  function rfRunProfile() {
    var k = {
      ramp: rfKnob("ramp"), soak: rfKnob("soak"),
      peak: rfKnob("peak"), dwell: rfKnob("dwell")
    };
    var air = rfGenAir(k.ramp, k.soak, k.peak, k.dwell);
    var sims = RF_BOARDS.map(function (b) { return rfSimBoard(air, b.tau); });
    var adj = RF_BOARDS.map(function (b, i) { return rfAdjudicate(b, sims[i]); });
    rfLastRun = { k: k, air: air, sims: sims, adj: adj };

    rfDrawScope(air, sims);
    rfRenderRead(sims, adj);

    var ship = 0, i;
    var whys = [];
    for (i = 0; i < adj.length; i++) {
      if (adj[i].v === "SHIP") ship++;
      whys.push(adj[i].why);
    }
    var note = rf$("rfNote");
    note.innerHTML = "";
    whys.forEach(function (w) {
      var p = rfEl("p", "", "");
      p.textContent = w;
      note.appendChild(p);
    });

    var vr = rf$("rfVerdict");
    vr.style.display = "block";
    var cert = rf$("rfCert"), dl = rf$("rfDl");
    if (ship === 3) {
      vr.className = "rf-verdict win";
      vr.textContent = "ALL THREE BOARDS SHIP: LINE QUALIFIED";
      var serial = "RF-" + Date.now().toString(36).toUpperCase();
      rf$("rfCertHead").textContent = "Serial " + serial + ": all three boards wet clean on one profile.";
      rf$("rfCertBody").textContent = "Profile: ramp " + k.ramp.toFixed(1) + " C/s, soak " +
        k.soak + " s at 160 C, peak " + k.peak + " C, dwell " + k.dwell + " s. " +
        "MST-03 bake-out: " + (rfBaked["MST-03"] ? "yes" : "no") + ".";
      var lines = RF_BOARDS.map(function (b, j) {
        return b.id + "  peak " + Math.round(sims[j].peak) + " C  TAL " + sims[j].tal +
          " s  max ramp " + sims[j].maxRamp.toFixed(1) + " C/s  -> SHIP";
      });
      rf$("rfCertPre").textContent = lines.join("\n");
      cert.classList.add("show");
      dl.disabled = false;
      rfToast("Line qualified: all three boards ship.");
    } else {
      vr.className = "rf-verdict lose";
      vr.textContent = ship + " OF 3 SHIP: REWORK THE PROFILE";
      cert.classList.remove("show");
      dl.disabled = true;
    }
  }

  function rfRenderRead(sims, adj) {
    var read = rf$("rfRead");
    read.innerHTML = "";
    RF_BOARDS.forEach(function (b, i) {
      var s = sims[i], a = adj[i];
      var box = rfEl("div", "rf-stat");
      var cls = a.v === "SHIP" ? "ship" : (a.v === "REWORK" ? "rework" : "scrap");
      box.innerHTML =
        "<div class=\"k\">" + b.id + " JOINT</div>" +
        "<div class=\"v\">PEAK " + Math.round(s.peak) + " C</div>" +
        "<div class=\"k\">TAL " + s.tal + " S ABOVE LIQUIDUS</div>" +
        "<div class=\"k\">MAX RAMP " + s.maxRamp.toFixed(1) + " C/S</div>" +
        "<div class=\"v " + cls + "\">" + a.v + "</div>";
      read.appendChild(box);
    });
  }

  function rfDrawScope(air, sims) {
    var cv = rf$("rfScope");
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d");
    var W = 920, H = 300, pL = 48, pR = 14, pT = 14, pB = 32;
    var n = air.length, tMax = n - 1, yMax = 280;
    function X(t) { return pL + (t / tMax) * (W - pL - pR); }
    function Y(c) { return pT + (1 - c / yMax) * (H - pT - pB); }

    function frame() {
      ctx.clearRect(0, 0, W, H);
      ctx.font = "10px 'IBM Plex Mono', monospace";
      var g;
      for (g = 0; g <= 280; g += 40) {
        ctx.strokeStyle = "rgba(242,237,227,0.08)";
        ctx.beginPath(); ctx.moveTo(pL, Y(g)); ctx.lineTo(W - pR, Y(g)); ctx.stroke();
        ctx.fillStyle = "#6e6b64";
        ctx.fillText(String(g) + " C", 6, Y(g) + 3);
      }
      for (g = 0; g <= tMax; g += 60) {
        ctx.fillStyle = "#6e6b64";
        ctx.fillText(String(g) + "s", X(g) - 8, H - 12);
      }
      /* limit lines */
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "#ff5a1f";
      ctx.beginPath(); ctx.moveTo(pL, Y(RF_LIQ)); ctx.lineTo(W - pR, Y(RF_LIQ)); ctx.stroke();
      ctx.fillStyle = "#ff5a1f";
      ctx.fillText("LIQUIDUS 217 C", W - pR - 118, Y(RF_LIQ) - 6);
      ctx.strokeStyle = "#ff5d5d";
      ctx.beginPath(); ctx.moveTo(pL, Y(RF_SCORCH)); ctx.lineTo(W - pR, Y(RF_SCORCH)); ctx.stroke();
      ctx.fillStyle = "#ff5d5d";
      ctx.fillText("SCORCH 260 C", W - pR - 108, Y(RF_SCORCH) - 6);
      ctx.setLineDash([]);
    }

    function traces(p) {
      var upto = Math.max(2, Math.floor(n * p));
      var i, j;
      /* oven air */
      ctx.strokeStyle = "#9aa3ad";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (i = 0; i < upto; i++) { var x = X(i), y = Y(air[i]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
      ctx.setLineDash([]);
      for (j = 0; j < sims.length; j++) {
        ctx.strokeStyle = RF_COLORS[j];
        ctx.lineWidth = 2;
        ctx.beginPath();
        var tr = sims[j].trace;
        for (i = 0; i < upto; i++) { var x2 = X(i), y2 = Y(tr[i]); if (i === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2); }
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    function drawAll(p) { frame(); traces(p); }

    if (RF_REDUCED) { drawAll(1); return; }
    var raf = (typeof window !== "undefined" && window.requestAnimationFrame) ?
      window.requestAnimationFrame.bind(window) : function (f) { f(0); };
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / 400);
      drawAll(p);
      if (p < 1) raf(step);
    }
    raf(step);
  }

  function rfBuildReport() {
    if (!rfLastRun) return "No profile run yet.";
    var k = rfLastRun.k;
    var out = ["THE REFLOW BAY, LINE REPORT",
      "Profile: ramp " + k.ramp.toFixed(1) + " C/s, soak " + k.soak + " s at 160 C, " +
      "peak " + k.peak + " C, dwell " + k.dwell + " s",
      "MST-03 bake-out: " + (rfBaked["MST-03"] ? "yes" : "no"), ""];
    RF_BOARDS.forEach(function (b, i) {
      var s = rfLastRun.sims[i], a = rfLastRun.adj[i];
      out.push(b.id + " (" + b.sub + "): joint peak " + Math.round(s.peak) + " C, " +
        "TAL " + s.tal + " s, max ramp " + s.maxRamp.toFixed(1) + " C/s => " + a.v);
      out.push("  " + a.why);
    });
    return out.join("\n");
  }

  function rfInit() {
    if (typeof document === "undefined") return;
    if (!document.querySelector(".dossier .actions")) return;
    rfBuildShell();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", rfInit);
    } else {
      rfInit();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      RF: {
        genAir: rfGenAir, simBoard: rfSimBoard, adjudicate: rfAdjudicate,
        BOARDS: RF_BOARDS, KNOBS: RF_KNOBS, baked: rfBaked,
        buildReport: rfBuildReport,
        LIQ: RF_LIQ, SCORCH: RF_SCORCH, POP_RAMP: RF_POP_RAMP,
        WET_PEAK: RF_WET_PEAK, WET_TAL: RF_WET_TAL
      }
    });
  }

})();

/* ================= PRECISION DISCIPLINE LAYER =================
   Additive presentation rules for every bench overlay. This layer never
   touches logic: it only tightens the shared visual grammar. Module
   styles injected later win wherever they set the same property
   explicitly; these rules fill the gaps (tabular numerals on every
   data readout, a visible keyboard focus ring on every control). */
(function pgDiscipline() {
  var css = [
    "div[class*=\"-overlay\"]{font-variant-numeric:tabular-nums;}",
    "div[class*=\"-overlay\"] :focus-visible{outline:2px solid var(--ember);outline-offset:2px;}"
  ].join("\n");
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
})();
/* ============================================================
   THE TRIAGE DESK
   Old Iron intake triage: three dead machines, five disciplined
   steps each (IDENTIFY, THEORIZE, TEST, RESOLVE, DOCUMENT).
   Order is enforced: you cannot test before you theorize and you
   cannot fix before a test confirms the hypothesis. Score starts
   at 100 per machine and mistakes cost points. Close all three
   tickets with an average of 70 or better to print the service
   ticket. Self-contained, appended at the end of features.js.
   ============================================================ */
(function () {
  "use strict";

  var TD_STEPS = ["IDENTIFY", "THEORIZE", "TEST", "RESOLVE", "DOCUMENT"];

  var TD_MACHINES = [
    {
      tag: "INTAKE-1042",
      name: "OptiPlex 9020 Tower",
      sn: "S/N 8F2KQ12",
      ticket: "Dead on arrival. No lights, no fans, no sign of life. The donor says a storm knocked out the street last night.",
      evidence: [
        { label: "Look at the front-panel LED", result: "Dark. No amber, no white. Completely unlit." },
        { label: "Press and hold the power button", result: "Nothing. No fan twitch, no click from the PSU, no relay sound." },
        { label: "Check the rear of the PSU", result: "Wall cable firmly seated. The rear rocker switch is ON." },
        { label: "Sniff the rear exhaust vents", result: "Faint burnt-plastic smell near the PSU exhaust." }
      ],
      symptoms: ["No power at all", "Fans spin, no POST", "Random reboots", "Distorted display"],
      symptom: 0,
      hyps: [
        "The storm surge killed the PSU",
        "The motherboard is dead",
        "The wall cable is unplugged",
        "The CMOS battery died"
      ],
      hyp: 0,
      tests: [
        { label: "Meter the wall outlet with the DMM", result: "120.4 V AC at the outlet. The wall is fine, so the fault is inside the box.", good: false },
        { label: "Swap in the known-good bench PSU", result: "Board LEDs light up and the fans spin. The original PSU is the fault.", good: true },
        { label: "Reseat the 24-pin ATX connector", result: "The connector was seated fine. Still dead.", good: false }
      ],
      fixes: [
        "Replace the PSU with a 290 W or better unit",
        "Replace the motherboard",
        "Replace the CMOS battery"
      ],
      fix: 0,
      notes: [
        "PSU failed after a surge event. Replaced with a 290 W unit. Booted to BIOS, ran a 15-minute stress, passed. Cleared for resale.",
        "It was dead. Fixed it.",
        "Replaced the motherboard. The unit now powers on."
      ],
      note: 0
    },
    {
      tag: "INTAKE-1043",
      name: "Supermicro 1U Render Node",
      sn: "S/N SM9X44TA",
      ticket: "Reboots itself every 20 to 30 minutes while the render queue runs. Sits idle for days without a hiccup.",
      evidence: [
        { label: "Open the lid, look at the heatsinks", result: "Both CPU heatsinks wear a dust blanket like felt. Air cannot pass through." },
        { label: "Check the BMC sensor page", result: "CPU1 reads 96 C at idle. The fan wall is pinned at 100 percent." },
        { label: "Read the system event log", result: "Four thermal-trip entries in the last two hours, all of them under load." },
        { label: "Feel the rear exhaust", result: "Hot air, weak flow. One fan grill is clogged solid with dust." }
      ],
      symptoms: ["No power at all", "Fans spin, no POST", "Random reboots", "Distorted display"],
      symptom: 2,
      hyps: [
        "The CPUs are cooking under dust",
        "The PSU is dropping rails under load",
        "A DIMM is failing when warm",
        "The OS install is corrupt"
      ],
      hyp: 0,
      tests: [
        { label: "Run it with the lid off and a desk fan aimed in", result: "Stays up for two hours under full load. Heat is the trigger.", good: true },
        { label: "Swap in the known-good bench PSU", result: "Still reboots at the 25-minute mark. The rails were clean anyway.", good: false },
        { label: "Run memtest86 overnight", result: "The RAM passes clean, zero errors.", good: false }
      ],
      fixes: [
        "Pull the sinks, clean them, repaste, reseat",
        "Replace the PSU",
        "Reinstall the OS"
      ],
      fix: 0,
      notes: [
        "Dust-choked heatsinks, 96 C at idle. Cleaned and repasted both CPUs, idle now 41 C. Burned in 4 hours under full load with no reboots.",
        "Reboots fixed.",
        "Replaced the PSU. The node seems stable."
      ],
      note: 0
    },
    {
      tag: "INTAKE-1044",
      name: "HP Z420 Workstation",
      sn: "S/N 2UA4120B7K",
      ticket: "Fans spin up loud, no picture on screen. It beeps at power-on: long, long, short, then repeats the pattern.",
      evidence: [
        { label: "Count the beeps at power-on", result: "Two long, one short, repeating. That is the board's memory beep code." },
        { label: "Check the display cable and monitor", result: "Cable seated. The monitor works fine on another box." },
        { label: "Open it and look at the DIMMs", result: "Four DIMMs installed. One has a scorch mark near its edge connector." },
        { label: "Check the board diagnostic LEDs", result: "The red memory LED on the board is lit." }
      ],
      symptoms: ["No power at all", "Fans spin, no POST", "Random reboots", "Distorted display"],
      symptom: 1,
      hyps: [
        "A DIMM is dead or shorted",
        "The GPU is dead",
        "The CPU is not seated",
        "The display cable is bad"
      ],
      hyp: 0,
      tests: [
        { label: "Strip to one DIMM in slot A2, rotate the sticks", result: "The box POSTs with sticks 1 through 3. Stick 4 kills it every single time.", good: true },
        { label: "Swap in the spare GPU", result: "Still no POST, same beep pattern.", good: false },
        { label: "Reseat the CPU", result: "No change. The beeps persist.", good: false }
      ],
      fixes: [
        "Retire stick 4, ship with the 3 good sticks tested",
        "Replace the GPU",
        "Replace the motherboard"
      ],
      fix: 0,
      notes: [
        "DIMM 4 shorted, scorch mark on the edge connector. Retired it. The remaining 24 GB passes two memtest passes. Cleared for resale.",
        "Bad RAM. Replaced.",
        "Replaced the GPU. The beeps are gone."
      ],
      note: 0
    }
  ];

  var TD_CSS = [
    ".td-overlay{position:fixed;inset:0;background:rgba(4,7,7,.94);z-index:90;display:none;overflow-y:auto;padding:18px 12px;}",
    ".td-overlay.open{display:block;}",
    ".td-panel{max-width:1020px;margin:0 auto;background:var(--panel);border:1px solid var(--line);padding:20px;}",
    ".td-panel h3{font-family:var(--font-d);font-size:24px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.02em;color:var(--ember);}",
    ".td-sub{color:var(--steel);font-size:12.5px;line-height:1.7;margin:0 0 14px;max-width:72ch;}",
    ".td-sub b{color:var(--paper);font-weight:600;}",
    ".td-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 12px;}",
    "@media(max-width:760px){.td-tabs{grid-template-columns:1fr;}}",
    ".td-tab{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;min-height:48px;text-align:left;cursor:pointer;color:var(--paper);font-family:var(--font-d);font-size:13px;}",
    ".td-tab .td-tag{font-family:var(--font-m);font-size:10.5px;color:var(--dim);display:block;letter-spacing:.08em;}",
    ".td-tab .td-st{font-family:var(--font-m);font-size:10.5px;letter-spacing:.08em;display:block;margin-top:2px;}",
    ".td-tab[aria-selected=\"true\"]{border-color:var(--ember);}",
    ".td-st.pending{color:var(--dim);}.td-st.open{color:var(--amber);}.td-st.online{color:var(--ice);}.td-st.closed{color:var(--mint);}",
    ".td-steps{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px;}",
    ".td-step{font-family:var(--font-m);font-size:10.5px;letter-spacing:.1em;padding:8px 10px;border:1px solid var(--line);color:var(--dim);}",
    ".td-step.cur{color:var(--ember);border-color:var(--ember);}",
    ".td-step.done{color:var(--mint);border-color:var(--mint);}",
    ".td-ticket{border:1px solid var(--line);background:var(--panel-2);padding:12px 14px;margin:0 0 12px;font-size:13px;line-height:1.65;}",
    ".td-ticket .td-k{font-family:var(--font-m);font-size:10.5px;color:var(--dim);letter-spacing:.1em;display:block;margin-bottom:4px;}",
    ".td-ev{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0 0 12px;}",
    "@media(max-width:760px){.td-ev{grid-template-columns:1fr;}}",
    ".td-findings{border:1px dashed var(--line);padding:10px 12px;margin:0 0 12px;font-size:12.5px;}",
    ".td-findings .td-k{font-family:var(--font-m);font-size:10.5px;color:var(--dim);letter-spacing:.1em;display:block;margin-bottom:6px;}",
    ".td-findings ul{margin:0;padding-left:18px;color:var(--steel);line-height:1.7;}",
    ".td-findings b{color:var(--paper);font-weight:600;}",
    ".td-opts{display:grid;gap:8px;margin:0 0 12px;}",
    ".td-opt{border:1px solid var(--line);background:var(--panel-2);color:var(--paper);padding:12px 14px;min-height:48px;text-align:left;cursor:pointer;font-family:var(--font-d);font-size:13.5px;line-height:1.5;}",
    ".td-opt:hover{border-color:var(--ember);}",
    ".td-opt:disabled{opacity:.45;cursor:default;}",
    ".td-opt.struck{text-decoration:line-through;}",
    ".td-opt.good{border-color:var(--mint);}",
    ".td-opt:focus-visible,.td-tab:focus-visible,.td-btn:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
    ".td-banner{border:1px solid var(--mint);color:var(--mint);padding:10px 12px;font-size:13px;margin:0 0 12px;}",
    ".td-stats{display:flex;gap:16px;flex-wrap:wrap;font-family:var(--font-m);font-size:11.5px;color:var(--steel);margin:0 0 12px;}",
    ".td-stats b{color:var(--paper);}",
    ".td-log{border:1px solid var(--line);padding:10px 12px;font-family:var(--font-m);font-size:11px;line-height:1.8;color:var(--steel);max-height:150px;overflow-y:auto;margin:0 0 12px;}",
    ".td-log .bad{color:var(--bad);}.td-log .good{color:var(--mint);}.td-log .dim{color:var(--dim);}",
    ".td-verdict{border:1px solid var(--ember);padding:14px;margin:14px 0 0;}",
    ".td-verdict h4{margin:0 0 6px;font-size:16px;text-transform:uppercase;letter-spacing:.03em;}",
    ".td-verdict.pass h4{color:var(--mint);}.td-verdict.fail h4{color:var(--bad);}",
    ".td-verdict p{font-size:13px;color:var(--steel);margin:0 0 10px;line-height:1.7;}",
    ".td-verdict table{font-family:var(--font-m);font-size:11.5px;color:var(--steel);border-collapse:collapse;margin:0 0 10px;}",
    ".td-verdict td,.td-verdict th{border:1px solid var(--line);padding:6px 10px;text-align:left;}",
    ".td-verdict th{color:var(--dim);font-weight:400;letter-spacing:.08em;font-size:10px;}",
    ".td-foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;}",
    ".td-btn{border:1px solid var(--line);background:var(--panel-2);color:var(--paper);padding:12px 18px;min-height:48px;cursor:pointer;font-family:var(--font-d);font-size:13px;}",
    ".td-btn.pri{border-color:var(--ember);color:var(--ember);}",
    ".td-btn:hover{border-color:var(--ember);}",
    ".td-hint{font-size:12px;color:var(--dim);margin:0 0 12px;}"
  ].join("\n");

  var tdS = null;      /* { mi, m:[per-machine state], log:[per-machine log lines] } */
  var tdEls = {};      /* live DOM refs */

  function tdNewState() {
    return {
      mi: 0,
      m: TD_MACHINES.map(function () {
        return { step: 0, score: 100, mins: 0, seen: [], tried: [], confirmed: false, status: "PENDING" };
      }),
      log: TD_MACHINES.map(function () { return []; })
    };
  }

  function tdEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function tdLog(mi, cls, msg) {
    tdS.log[mi].push({ cls: cls, msg: msg });
  }

  function tdMachine(i) { return TD_MACHINES[i]; }
  function tdMS(i) { return tdS.m[i]; }

  function tdStatusOf(i) {
    var s = tdS.m[i];
    if (s.step >= 5) return "CLOSED";
    if (s.step >= 3 && s.step < 5) return "FIXED";
    if (s.step > 0 || s.seen.length > 0) return "OPEN";
    return "PENDING";
  }

  function tdOpt(parent, label, attrs, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "td-opt";
    b.setAttribute("data-td", "opt");
    if (attrs) {
      for (var k in attrs) b.setAttribute("data-" + k, attrs[k]);
    }
    b.textContent = label;
    b.addEventListener("click", fn);
    parent.appendChild(b);
    return b;
  }

  function tdRender() {
    var mi = tdS.mi, m = tdMachine(mi), s = tdMS(mi);

    /* tabs */
    var tabs = tdEls.tabs; tabs.innerHTML = "";
    TD_MACHINES.forEach(function (mm, i) {
      var st = tdStatusOf(i);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "td-tab";
      b.setAttribute("aria-selected", i === mi ? "true" : "false");
      b.setAttribute("data-td", "tab");
      b.setAttribute("data-i", String(i));
      b.innerHTML = "<span class=\"td-tag\">" + tdEsc(mm.tag) + " " + tdEsc(mm.sn) + "</span>" +
        tdEsc(mm.name) +
        "<span class=\"td-st " + st.toLowerCase() + "\">" + st + "</span>";
      b.addEventListener("click", function () { tdS.mi = i; tdRender(); });
      tabs.appendChild(b);
    });

    /* stepper */
    var sp = tdEls.steps; sp.innerHTML = "";
    TD_STEPS.forEach(function (name, i) {
      var d = document.createElement("div");
      d.className = "td-step" + (i < s.step ? " done" : "") + (i === s.step && s.step < 5 ? " cur" : "");
      d.textContent = (i + 1) + ". " + name + (i < s.step ? " OK" : "");
      if (i === s.step && s.step < 5) d.setAttribute("aria-current", "step");
      sp.appendChild(d);
    });

    /* stats */
    tdEls.stats.innerHTML =
      "SCORE <b>" + s.score + "</b> &nbsp; SHOP TIME <b>" + s.mins + " MIN</b> &nbsp; TICKET <b>" +
      tdEsc(m.tag) + "</b> &nbsp; STATUS <b>" + tdStatusOf(mi) + "</b>";

    /* stage */
    var stage = tdEls.stage; stage.innerHTML = "";
    if (s.step >= 5) {
      var done = document.createElement("p");
      done.className = "td-banner";
      done.textContent = "Ticket closed. Score " + s.score + ". Move to the next machine or check the verdict below.";
      stage.appendChild(done);
    } else {
      var ticket = document.createElement("div");
      ticket.className = "td-ticket";
      ticket.innerHTML = "<span class=\"td-k\">SERVICE TICKET</span>" + tdEsc(m.ticket);
      stage.appendChild(ticket);
      if (s.step === 0) tdStageIdentify(stage, mi, m, s);
      else if (s.step === 1) tdStageTheorize(stage, mi, m, s);
      else if (s.step === 2) tdStageTest(stage, mi, m, s);
      else if (s.step === 3) tdStageResolve(stage, mi, m, s);
      else tdStageDocument(stage, mi, m, s);
    }

    /* log */
    var log = tdEls.log; log.innerHTML = "";
    tdS.log[mi].forEach(function (e) {
      var p = document.createElement("div");
      if (e.cls) p.className = e.cls;
      p.textContent = e.msg;
      log.appendChild(p);
    });
    log.scrollTop = log.scrollHeight;

    tdRenderVerdict();
  }

  function tdStageIdentify(stage, mi, m, s) {
    var h = document.createElement("p");
    h.className = "td-hint";
    h.textContent = "Step 1 of 5, IDENTIFY. Inspect the machine (at least two checks), then name the symptom class.";
    stage.appendChild(h);

    var ev = document.createElement("div");
    ev.className = "td-ev";
    m.evidence.forEach(function (e, i) {
      var seen = s.seen.indexOf(i) !== -1;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "td-opt";
      b.setAttribute("data-td", "ev");
      b.setAttribute("data-i", String(i));
      b.disabled = seen;
      b.textContent = (seen ? "Checked: " : "Check: ") + e.label;
      b.addEventListener("click", function () {
        s.seen.push(i); s.mins += 5;
        tdLog(mi, "", "INSPECT " + e.label + " -> " + e.result);
        toast("Finding recorded");
        tdRender();
      });
      ev.appendChild(b);
    });
    stage.appendChild(ev);

    if (s.seen.length > 0) {
      var f = document.createElement("div");
      f.className = "td-findings";
      var ul = "<ul>";
      s.seen.forEach(function (i) {
        ul += "<li><b>" + tdEsc(m.evidence[i].label) + ":</b> " + tdEsc(m.evidence[i].result) + "</li>";
      });
      ul += "</ul>";
      f.innerHTML = "<span class=\"td-k\">FINDINGS</span>" + ul;
      stage.appendChild(f);
    }

    var opts = document.createElement("div");
    opts.className = "td-opts";
    var ready = s.seen.length >= 2;
    if (!ready) {
      var wait = document.createElement("p");
      wait.className = "td-hint";
      wait.textContent = "Run at least " + (2 - s.seen.length) + " more inspection check(s) before calling the symptom.";
      opts.appendChild(wait);
    }
    m.symptoms.forEach(function (label, i) {
      var b = tdOpt(opts, label, { step: "identify", i: String(i) }, function () {
        if (i === m.symptom) {
          s.step = 1; tdLog(mi, "good", "IDENTIFY: symptom class \"" + label + "\" confirmed.");
          toast("Symptom identified");
        } else {
          s.score = Math.max(0, s.score - 10);
          tdLog(mi, "bad", "IDENTIFY: \"" + label + "\" is wrong. -10. Look at your findings again.");
          toast("Wrong symptom class, -10");
          b.classList.add("struck"); b.disabled = true;
        }
        tdRender();
      });
      b.disabled = !ready;
    });
    stage.appendChild(opts);
  }

  function tdStageTheorize(stage, mi, m, s) {
    var h = document.createElement("p");
    h.className = "td-hint";
    h.textContent = "Step 2 of 5, THEORIZE. Pick the one hypothesis that best fits the evidence. Guessing costs points.";
    stage.appendChild(h);
    var opts = document.createElement("div");
    opts.className = "td-opts";
    m.hyps.forEach(function (label, i) {
      tdOpt(opts, label, { step: "theorize", i: String(i) }, function (ev) {
        if (i === m.hyp) {
          s.step = 2; tdLog(mi, "good", "THEORIZE: \"" + label + "\" accepted. Now prove it with a test.");
          toast("Hypothesis accepted");
          tdRender();
        } else {
          s.score = Math.max(0, s.score - 10);
          tdLog(mi, "bad", "THEORIZE: \"" + label + "\" does not fit the evidence. -10.");
          toast("Hypothesis rejected, -10");
          ev.target.classList.add("struck"); ev.target.disabled = true;
          tdRender();
        }
      });
    });
    stage.appendChild(opts);
  }

  function tdStageTest(stage, mi, m, s) {
    var h = document.createElement("p");
    h.className = "td-hint";
    h.textContent = "Step 3 of 5, TEST. Run tests to confirm or kill the hypothesis. Each test costs 10 shop minutes. The wrong tests cost 5 points.";
    stage.appendChild(h);
    var opts = document.createElement("div");
    opts.className = "td-opts";
    m.tests.forEach(function (t, i) {
      var done = s.tried.indexOf(i) !== -1;
      var b = tdOpt(opts, (done ? "Ran: " : "Run: ") + t.label, { step: "test", i: String(i) }, function (ev) {
        if (done) return;
        s.tried.push(i); s.mins += 10;
        tdLog(mi, t.good ? "good" : "", "TEST \"" + t.label + "\" -> " + t.result);
        if (t.good) {
          s.confirmed = true;
          toast("Hypothesis confirmed");
        } else {
          s.score = Math.max(0, s.score - 5);
          tdLog(mi, "bad", "That test ruled nothing in. -5.");
          toast("Inconclusive test, -5");
          ev.target.classList.add("struck");
        }
        tdRender();
      });
      b.disabled = done;
      opts.appendChild(b);
    });
    stage.appendChild(opts);
    if (s.confirmed) {
      var bn = document.createElement("p");
      bn.className = "td-banner";
      bn.textContent = "Hypothesis confirmed by test. The fault is proven, move to RESOLVE.";
      stage.appendChild(bn);
      var go = document.createElement("button");
      go.type = "button";
      go.className = "td-btn pri";
      go.setAttribute("data-td", "to-resolve");
      go.textContent = "Move to RESOLVE";
      go.addEventListener("click", function () { s.step = 3; tdRender(); });
      stage.appendChild(go);
    }
  }

  function tdStageResolve(stage, mi, m, s) {
    var h = document.createElement("p");
    h.className = "td-hint";
    h.textContent = "Step 4 of 5, RESOLVE. Apply the fix the evidence proved. A wrong fix costs 15 points and the ticket stays open.";
    stage.appendChild(h);
    var opts = document.createElement("div");
    opts.className = "td-opts";
    m.fixes.forEach(function (label, i) {
      tdOpt(opts, label, { step: "resolve", i: String(i) }, function (ev) {
        if (i === m.fix) {
          s.step = 4; s.mins += 20;
          tdLog(mi, "good", "RESOLVE: \"" + label + "\" applied. The machine is back ONLINE. Document the work.");
          toast("Machine back online");
          tdRender();
        } else {
          s.score = Math.max(0, s.score - 15);
          tdLog(mi, "bad", "RESOLVE: \"" + label + "\" changed nothing. -15. The test already told you the fault.");
          toast("Wrong fix, -15");
          ev.target.classList.add("struck"); ev.target.disabled = true;
          tdRender();
        }
      });
    });
    stage.appendChild(opts);
  }

  function tdStageDocument(stage, mi, m, s) {
    var h = document.createElement("p");
    h.className = "td-hint";
    h.textContent = "Step 5 of 5, DOCUMENT. A ticket is not closed until the note is complete: what was wrong, what fixed it, and the proof.";
    stage.appendChild(h);
    var opts = document.createElement("div");
    opts.className = "td-opts";
    m.notes.forEach(function (label, i) {
      tdOpt(opts, label, { step: "document", i: String(i) }, function (ev) {
        if (i === m.note) {
          s.step = 5; s.mins += 5;
          tdLog(mi, "good", "DOCUMENT: service note accepted. Ticket " + m.tag + " CLOSED at score " + s.score + ".");
          toast("Ticket closed");
          tdRender();
        } else {
          s.score = Math.max(0, s.score - 5);
          tdLog(mi, "bad", "DOCUMENT: that note is incomplete or blames the wrong part. -5. The next tech reads this.");
          toast("Note rejected, -5");
          ev.target.classList.add("struck"); ev.target.disabled = true;
          tdRender();
        }
      });
    });
    stage.appendChild(opts);
  }

  function tdRenderVerdict() {
    var v = tdEls.verdict;
    v.innerHTML = "";
    v.className = "td-verdict";
    v.style.display = "none";
    var all = tdS.m.every(function (s) { return s.step >= 5; });
    if (!all) return;
    v.style.display = "block";
    var total = 0;
    tdS.m.forEach(function (s) { total += s.score; });
    var avg = Math.round(total / tdS.m.length);
    var pass = avg >= 70;
    v.classList.add(pass ? "pass" : "fail");

    var rows = "";
    TD_MACHINES.forEach(function (m, i) {
      var s = tdS.m[i];
      rows += "<tr><td>" + tdEsc(m.tag) + "</td><td>" + tdEsc(m.name) + "</td><td>" +
        s.score + "</td><td>" + s.mins + " MIN</td></tr>";
    });
    v.innerHTML =
      "<h4>" + (pass ? "Rack cleared" : "Rack rework") + "</h4>" +
      "<table><tr><th>TICKET</th><th>MACHINE</th><th>SCORE</th><th>TIME</th></tr>" + rows + "</table>" +
      "<p>Average score <b style=\"color:var(--paper)\">" + avg + "</b>. " +
      (pass
        ? "All three tickets are closed with a passing average. The service ticket is ready to print."
        : "The average is under 70. The shop does not ship rework. Reopen the rack and run the method properly.") +
      "</p>";

    var foot = document.createElement("div");
    foot.className = "td-foot";
    if (pass) {
      var pr = document.createElement("button");
      pr.type = "button";
      pr.className = "td-btn pri";
      pr.setAttribute("data-td", "print");
      pr.textContent = "Print the service ticket";
      pr.addEventListener("click", tdPrintTicket);
      foot.appendChild(pr);
    }
    var rs = document.createElement("button");
    rs.type = "button";
    rs.className = "td-btn";
    rs.setAttribute("data-td", "reset");
    rs.textContent = "Reopen the rack";
    rs.addEventListener("click", function () {
      tdS = tdNewState();
      toast("Rack reopened");
      tdRender();
    });
    foot.appendChild(rs);
    v.appendChild(foot);
  }

  function tdPrintTicket() {
    var lines = [];
    lines.push("THE TRIAGE DESK - SERVICE TICKET");
    lines.push("OLD IRON intake rack - disciplined triage record");
    lines.push("==================================================");
    TD_MACHINES.forEach(function (m, i) {
      var s = tdS.m[i];
      lines.push("");
      lines.push(m.tag + " - " + m.name + " (" + m.sn + ")");
      lines.push("Symptom:   " + m.symptoms[m.symptom]);
      lines.push("Cause:     " + m.hyps[m.hyp]);
      lines.push("Fix:       " + m.fixes[m.fix]);
      lines.push("Service note: " + m.notes[m.note]);
      lines.push("Score: " + s.score + " - Shop time: " + s.mins + " min");
    });
    lines.push("");
    lines.push("Closed by the bench. Identify, theorize, test, resolve, document.");
    var blob = new Blob([lines.join("\n")], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = "triage-desk-service-ticket.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { (window.URL || window.webkitURL).revokeObjectURL(a.href); }, 4000);
    toast("Service ticket downloaded");
  }

  function tdBuild() {
    var box = document.querySelector(".dossier .actions");
    if (!box || document.getElementById("tdBtn")) return;

    var st = document.createElement("style");
    st.textContent = TD_CSS;
    document.head.appendChild(st);

    var b = document.createElement("button");
    b.id = "tdBtn";
    b.className = "secondary";
    b.textContent = "Run the Triage Desk";
    b.addEventListener("click", function () {
      document.getElementById("tdOverlay").classList.add("open");
    });
    box.appendChild(b);

    var ov = document.createElement("div");
    ov.className = "td-overlay";
    ov.id = "tdOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "The Triage Desk");

    var panel = document.createElement("div");
    panel.className = "td-panel";
    panel.innerHTML =
      "<h3>The Triage Desk</h3>" +
      "<p class=\"td-sub\">The intake bench for <b>OLD IRON</b>: three dead machines, five disciplined steps each. " +
      "<b>Identify</b> the symptom from real inspections, <b>theorize</b> the cause, <b>test</b> to prove it, " +
      "<b>resolve</b> with the right fix, and <b>document</b> the work. The steps run in order, guessing costs points, " +
      "and the rack only ships with an average score of 70 or better.</p>";
    ov.appendChild(panel);

    tdEls.tabs = document.createElement("div");
    tdEls.tabs.className = "td-tabs";
    panel.appendChild(tdEls.tabs);

    tdEls.steps = document.createElement("div");
    tdEls.steps.className = "td-steps";
    panel.appendChild(tdEls.steps);

    tdEls.stats = document.createElement("div");
    tdEls.stats.className = "td-stats";
    panel.appendChild(tdEls.stats);

    tdEls.stage = document.createElement("div");
    panel.appendChild(tdEls.stage);

    var logWrap = document.createElement("div");
    var logK = document.createElement("p");
    logK.className = "td-hint";
    logK.textContent = "Shop log";
    logWrap.appendChild(logK);
    tdEls.log = document.createElement("div");
    tdEls.log.className = "td-log";
    tdEls.log.setAttribute("aria-live", "polite");
    logWrap.appendChild(tdEls.log);
    panel.appendChild(logWrap);

    tdEls.verdict = document.createElement("div");
    panel.appendChild(tdEls.verdict);

    var foot = document.createElement("div");
    foot.className = "td-foot";
    var close = document.createElement("button");
    close.type = "button";
    close.className = "td-btn";
    close.textContent = "Close bench";
    close.addEventListener("click", function () {
      document.getElementById("tdOverlay").classList.remove("open");
    });
    foot.appendChild(close);
    panel.appendChild(foot);

    document.body.appendChild(ov);

    tdS = tdNewState();
    tdLog(0, "dim", "Rack received. Three tickets waiting. Pick a machine and start identifying.");
    tdRender();
  }

  if (typeof document !== "undefined" && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tdBuild);
  } else if (typeof document !== "undefined") {
    tdBuild();
  }
})();
/* ============================================================
   THE CRIMP BAY
   Old Iron bench networking: hand-crimp Cat5e 8P8C plugs to the
   T568 standard. Three cables: a straight-through patch lead, a
   crossover, and a returned lead with a split-pair fault to find
   and fix. A real cable-tester model under the hood: a continuity
   wire map plus twisted-pair integrity per pair. Certify all three
   at 1000BASE-T to print the certification record. Self-contained,
   appended at the end of features.js.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- data: conductors, standards, cables ---------------- */

  var CB_COND = [
    { id: "WO",  label: "white-orange", pair: "P1" },
    { id: "O",   label: "orange",      pair: "P1" },
    { id: "WG",  label: "white-green", pair: "P2" },
    { id: "G",   label: "green",       pair: "P2" },
    { id: "B",   label: "blue",        pair: "P3" },
    { id: "WB",  label: "white-blue",  pair: "P3" },
    { id: "WBr", label: "white-brown", pair: "P4" },
    { id: "Br",  label: "brown",       pair: "P4" }
  ];

  var CB_T568B = ["WO", "O", "WG", "B", "WB", "G", "WBr", "Br"];
  var CB_T568A = ["WG", "G", "WO", "B", "WB", "O", "WBr", "Br"];

  /* twisted pairs as 0-based pin indices: (1,2) (3,6) (4,5) (7,8) */
  var CB_PAIRS = [[0, 1], [2, 5], [3, 4], [6, 7]];

  var CB_CABLES = [
    { tag: "PATCH-01", name: "Patch lead", kind: "straight",
      std: "T568B both ends",
      blurb: "A 2 m Cat5e patch lead for the bench switch. The shop end is crimped to T568B and sealed. Wire your end to T568B, straight through, pin for pin.",
      shop: CB_T568B.slice(), expect: CB_T568B.slice(),
      start: [null, null, null, null, null, null, null, null] },
    { tag: "XOVER-02", name: "Crossover", kind: "crossover",
      std: "T568A to T568B",
      blurb: "A crossover for a switch-to-switch uplink. The shop end is T568B and sealed; wire your end to T568A. Pairs 1-2 and 3-6 trade places, 4-5 and 7-8 stay put.",
      shop: CB_T568B.slice(), expect: CB_T568A.slice(),
      start: [null, null, null, null, null, null, null, null] },
    { tag: "RMA-03", name: "Returned lead", kind: "rma",
      std: "T568B both ends",
      blurb: "A returned lead. The customer says gigabit died overnight and the link will not come up. The shop end is sealed at T568B. Run the tester, read the fault, re-terminate your end, and certify it.",
      shop: CB_T568B.slice(), expect: CB_T568B.slice(),
      start: ["WO", "O", "WG", "B", "WB", "WBr", "G", "Br"] }
  ];

  function cbCond(id) {
    for (var i = 0; i < CB_COND.length; i++) {
      if (CB_COND[i].id === id) return CB_COND[i];
    }
    return null;
  }

  /* ---------------- the cable tester: pure logic ----------------
     userEnd/shopEnd/expect: arrays of 8 conductor ids (or null).
     Returns per-pin rows (wire map + fault), per-pair integrity,
     a fault list with plain-language diagnoses, and the verdict. */
  function cbEvaluate(userEnd, shopEnd, expect) {
    var pairOfPin = {};
    var pairInfo = CB_PAIRS.map(function (pr, k) {
      pairOfPin[pr[0]] = k;
      pairOfPin[pr[1]] = k;
      var ca = userEnd[pr[0]] || null, cbx = userEnd[pr[1]] || null;
      var ea = expect[pr[0]], eb = expect[pr[1]];
      var st;
      if (!ca || !cbx) st = "OPEN";
      else if (ca === ea && cbx === eb) st = "OK";
      else if (ca === eb && cbx === ea) st = "REVERSED";
      else if (cbCond(ca).pair !== cbCond(cbx).pair) st = "SPLIT";
      else st = "MISWIRE";
      return { pins: [pr[0] + 1, pr[1] + 1], status: st, ca: ca, cb: cbx };
    });
    var rows = [], faults = [];
    /* pair-level faults are reported once per pair, because a split pair
       can leave one pin of the pair wired correctly (as on RMA-03). */
    pairInfo.forEach(function (pi) {
      if (pi.status === "REVERSED") {
        faults.push({ pin: pi.pins[0], kind: "REVERSED",
          text: "Pins " + pi.pins[0] + " and " + pi.pins[1] + " are reversed inside the pair. The pair still twists, but the standard is pin-exact." });
      } else if (pi.status === "SPLIT") {
        faults.push({ pin: pi.pins[0], kind: "SPLIT",
          text: "Split pair on pins " + pi.pins[0] + " and " + pi.pins[1] + ": " +
            cbCond(pi.ca).label + " with " + cbCond(pi.cb).label +
            " is not a twisted pair. Continuity passes, but crosstalk kills the link." });
      }
    });
    for (var i = 0; i < 8; i++) {
      var c = userEnd[i] || null, e = expect[i];
      var tgt = c ? shopEnd.indexOf(c) : -1;
      var pk = pairOfPin[i], pi = pairInfo[pk];
      var row = {
        pin: i + 1,
        condLabel: c ? cbCond(c).label : "empty",
        shopLabel: cbCond(shopEnd[i]).label,
        map: c ? ((i + 1) + " to " + (tgt + 1)) : "open",
        pair: pi.status, fault: null
      };
      if (!c) {
        row.fault = "OPEN";
        faults.push({ pin: i + 1, kind: "OPEN",
          text: "Pin " + (i + 1) + " is empty. An open conductor is an open circuit." });
      } else if (c !== e) {
        if (pi.status === "MISWIRE") {
          row.fault = "MISWIRE";
          faults.push({ pin: i + 1, kind: "MISWIRE",
            text: "Pin " + (i + 1) + " carries " + cbCond(c).label +
              ", the standard calls for " + cbCond(e).label + "." });
        } else {
          /* REVERSED or SPLIT: already reported once at pair level */
          row.fault = pi.status;
        }
      }
      rows.push(row);
    }
    var pass = faults.length === 0;
    return { rows: rows, pairs: pairInfo, faults: faults, pass: pass,
      link: pass ? "1000BASE-T, LINK UP" : "NO LINK" };
  }

  /* ---------------- styles ---------------- */

  var CB_CSS = [
    ".cb-overlay{position:fixed;inset:0;background:rgba(4,7,7,.94);z-index:90;display:none;overflow-y:auto;padding:18px 12px;}",
    ".cb-overlay.open{display:block;}",
    ".cb-panel{max-width:1020px;margin:0 auto;background:var(--panel);border:1px solid var(--line);padding:20px;}",
    ".cb-panel h3{font-family:var(--font-d);font-size:24px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.02em;color:var(--ember);}",
    ".cb-spec{font-family:var(--font-m);font-size:10.5px;color:var(--dim);letter-spacing:.1em;margin:0 0 10px;}",
    ".cb-sub{color:var(--steel);font-size:12.5px;line-height:1.7;margin:0 0 14px;max-width:72ch;}",
    ".cb-sub b{color:var(--paper);font-weight:600;}",
    ".cb-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 12px;}",
    "@media(max-width:760px){.cb-tabs{grid-template-columns:1fr;}}",
    ".cb-tab{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;min-height:48px;text-align:left;cursor:pointer;color:var(--paper);font-family:var(--font-d);font-size:13px;}",
    ".cb-tab .cb-tag{font-family:var(--font-m);font-size:10.5px;color:var(--dim);display:block;letter-spacing:.08em;}",
    ".cb-tab .cb-st{font-family:var(--font-m);font-size:10.5px;letter-spacing:.08em;display:block;margin-top:2px;}",
    ".cb-tab[aria-selected=\"true\"]{border-color:var(--ember);}",
    ".cb-st.todo{color:var(--dim);}.cb-st.done{color:var(--mint);}",
    ".cb-blurb{border:1px dashed var(--line);padding:10px 12px;margin:0 0 12px;font-size:12.5px;line-height:1.7;color:var(--steel);}",
    ".cb-blurb b{color:var(--paper);}",
    ".cb-k{font-family:var(--font-m);font-size:10.5px;color:var(--dim);letter-spacing:.1em;display:block;margin:0 0 8px;}",
    ".cb-ref{width:100%;border-collapse:collapse;font-family:var(--font-m);font-size:11.5px;margin:0 0 14px;color:var(--steel);}",
    ".cb-ref th,.cb-ref td{border:1px solid var(--line);padding:6px 10px;text-align:left;}",
    ".cb-ref th{color:var(--dim);font-weight:400;letter-spacing:.08em;font-size:10px;}",
    ".cb-ref td b{color:var(--paper);font-weight:400;}",
    ".cb-pins{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;margin:0 0 8px;}",
    "@media(max-width:760px){.cb-pins{grid-template-columns:repeat(4,minmax(0,1fr));}}",
    ".cb-pin{border:1px solid var(--line);background:var(--panel-2);color:var(--paper);min-height:56px;padding:8px 4px;cursor:pointer;font-family:var(--font-m);font-size:11px;line-height:1.5;}",
    ".cb-pin .cb-pn{color:var(--dim);font-size:10px;letter-spacing:.08em;display:block;}",
    ".cb-pin .cb-pc{color:var(--paper);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".cb-pin .cb-pc.empty{color:var(--dim);}",
    ".cb-pin[aria-pressed=\"true\"]{border-color:var(--ember);}",
    ".cb-pin:hover{border-color:var(--ember);}",
    ".cb-hint{font-size:12px;color:var(--dim);margin:0 0 12px;min-height:18px;}",
    ".cb-hint b{color:var(--ember);font-weight:600;}",
    ".cb-tray{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 12px;}",
    "@media(max-width:760px){.cb-tray{grid-template-columns:repeat(2,minmax(0,1fr));}}",
    ".cb-cond{border:1px solid var(--line);background:var(--panel-2);color:var(--paper);min-height:48px;padding:10px 12px;cursor:pointer;font-family:var(--font-d);font-size:13px;text-align:left;line-height:1.4;}",
    ".cb-cond:hover{border-color:var(--ember);}",
    ".cb-cond .cb-cs{font-family:var(--font-m);font-size:10.5px;color:var(--dim);display:block;}",
    ".cb-sw{display:inline-block;width:14px;height:14px;border:1px solid var(--line);margin-right:8px;vertical-align:-2px;}",
    ".cb-sw-WO{background:linear-gradient(135deg,#e8e4da 50%,#e07b1a 50%);}",
    ".cb-sw-O{background:#e07b1a;}",
    ".cb-sw-WG{background:linear-gradient(135deg,#e8e4da 50%,#3fa34d 50%);}",
    ".cb-sw-G{background:#3fa34d;}",
    ".cb-sw-B{background:#2f6fd0;}",
    ".cb-sw-WB{background:linear-gradient(135deg,#e8e4da 50%,#2f6fd0 50%);}",
    ".cb-sw-WBr{background:linear-gradient(135deg,#e8e4da 50%,#8a5a2b 50%);}",
    ".cb-sw-Br{background:#8a5a2b;}",
    ".cb-actions{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px;}",
    ".cb-btn{border:1px solid var(--line);background:var(--panel-2);color:var(--paper);padding:12px 18px;min-height:48px;cursor:pointer;font-family:var(--font-d);font-size:13px;}",
    ".cb-btn.pri{border-color:var(--ember);color:var(--ember);}",
    ".cb-btn:hover{border-color:var(--ember);}",
    ".cb-btn:disabled{opacity:.45;cursor:default;}",
    ".cb-btn:focus-visible,.cb-pin:focus-visible,.cb-cond:focus-visible,.cb-tab:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
    ".cb-leds{display:flex;gap:6px;margin:0 0 10px;}",
    ".cb-led{flex:1;min-height:34px;border:1px solid var(--line);background:var(--panel-2);font-family:var(--font-m);font-size:10px;color:var(--dim);display:flex;align-items:center;justify-content:center;}",
    ".cb-led.lit{border-color:var(--ember);color:var(--ember);}",
    ".cb-led.good{border-color:var(--mint);color:var(--mint);}",
    ".cb-led.bad{border-color:var(--bad);color:var(--bad);}",
    ".cb-tres{width:100%;border-collapse:collapse;font-family:var(--font-m);font-size:11px;margin:0 0 10px;color:var(--steel);}",
    ".cb-tres th,.cb-tres td{border:1px solid var(--line);padding:6px 8px;text-align:left;}",
    ".cb-tres th{color:var(--dim);font-weight:400;letter-spacing:.08em;font-size:10px;}",
    ".cb-tres td.ok{color:var(--mint);}.cb-tres td.flt{color:var(--bad);}",
    ".cb-faults{margin:0 0 12px;padding-left:18px;color:var(--steel);font-size:12.5px;line-height:1.7;}",
    ".cb-faults b{color:var(--bad);font-weight:600;}",
    ".cb-verdict{border:1px solid var(--line);padding:12px 14px;margin:0 0 12px;font-size:13px;line-height:1.7;}",
    ".cb-verdict h4{margin:0 0 6px;font-size:15px;text-transform:uppercase;letter-spacing:.03em;font-family:var(--font-d);}",
    ".cb-verdict.pass{border-color:var(--mint);}.cb-verdict.pass h4{color:var(--mint);}",
    ".cb-verdict.fail{border-color:var(--bad);}.cb-verdict.fail h4{color:var(--bad);}",
    ".cb-verdict p{margin:0;color:var(--steel);font-size:12.5px;}",
    ".cb-foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center;}",
    ".cb-progress{font-family:var(--font-m);font-size:11.5px;color:var(--steel);margin-right:auto;}",
    ".cb-progress b{color:var(--paper);}"
  ].join("\n");

  /* ---------------- state ---------------- */

  var cbS = null;
  var cbEls = {};
  var CB_REDUCED = (typeof window !== "undefined" && window.matchMedia) ?
    window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;

  function cbNewState() {
    return {
      ci: 0,
      sel: -1,
      testing: false,
      cables: CB_CABLES.map(function (c) {
        return { user: c.start.slice(), tested: false, result: null,
          certified: false, faultsSeen: [] };
      })
    };
  }
  function cbCable() { return CB_CABLES[cbS.ci]; }
  function cbCS() { return cbS.cables[cbS.ci]; }

  function cbEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------------- render ---------------- */

  function cbRenderTabs() {
    var w = cbEls.tabs;
    w.innerHTML = "";
    CB_CABLES.forEach(function (c, i) {
      var s = cbS.cables[i];
      var b = cbEl("button", "cb-tab");
      b.type = "button";
      b.setAttribute("data-cb", "tab");
      b.setAttribute("data-i", String(i));
      b.setAttribute("aria-selected", i === cbS.ci ? "true" : "false");
      b.appendChild(cbEl("span", "cb-tag", c.tag + " - " + c.name));
      b.appendChild(cbEl("span", "cb-st " + (s.certified ? "done" : "todo"),
        s.certified ? "CERTIFIED" : "UNCERTIFIED"));
      b.addEventListener("click", function () {
        if (cbS.testing) return;
        cbS.ci = i;
        cbS.sel = -1;
        cbRenderAll();
      });
      w.appendChild(b);
    });
  }

  function cbRenderBlurb() {
    var w = cbEls.blurb;
    w.innerHTML = "";
    var c = cbCable();
    w.appendChild(cbEl("b", null, c.tag + " - " + c.name + " (" + c.std + "). "));
    w.appendChild(cbEl("span", null, c.blurb));
  }

  function cbBuildRef() {
    var t = document.createElement("table");
    t.className = "cb-ref";
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    ["PIN", "T568B", "T568A"].forEach(function (h) {
      var th = document.createElement("th");
      th.textContent = h;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = document.createElement("tbody");
    for (var i = 0; i < 8; i++) {
      var tr = document.createElement("tr");
      var td0 = document.createElement("td");
      td0.textContent = String(i + 1);
      tr.appendChild(td0);
      var td1 = document.createElement("td");
      td1.textContent = cbCond(CB_T568B[i]).label;
      tr.appendChild(td1);
      var td2 = document.createElement("td");
      td2.textContent = cbCond(CB_T568A[i]).label;
      tr.appendChild(td2);
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    return t;
  }

  function cbRenderPins() {
    var w = cbEls.pins;
    w.innerHTML = "";
    var s = cbCS();
    for (var i = 0; i < 8; i++) {
      (function (idx) {
        var b = cbEl("button", "cb-pin");
        b.type = "button";
        b.setAttribute("data-cb", "pin");
        b.setAttribute("data-i", String(idx));
        b.setAttribute("aria-pressed", cbS.sel === idx ? "true" : "false");
        b.setAttribute("aria-label", "Pin " + (idx + 1) +
          (s.user[idx] ? ", " + cbCond(s.user[idx]).label : ", empty"));
        b.appendChild(cbEl("span", "cb-pn", "PIN " + (idx + 1)));
        b.appendChild(cbEl("span", "cb-pc" + (s.user[idx] ? "" : " empty"),
          s.user[idx] ? cbCond(s.user[idx]).label : "EMPTY"));
        b.addEventListener("click", function () {
          if (cbS.testing) return;
          cbS.sel = (cbS.sel === idx) ? -1 : idx;
          cbRenderPins();
          cbRenderHint();
        });
        w.appendChild(b);
      })(i);
    }
  }

  function cbRenderHint() {
    var s = cbCS();
    var seated = s.user.filter(function (x) { return !!x; }).length;
    cbEls.hint.textContent = seated + " of 8 seated. " +
      (cbS.sel >= 0
        ? "Selected: pin " + (cbS.sel + 1) + ". Pick a conductor from the tray to seat it."
        : "Pick a pin, then a conductor from the tray.");
  }

  function cbRenderTray() {
    var w = cbEls.tray;
    w.innerHTML = "";
    var s = cbCS();
    CB_COND.forEach(function (cd) {
      var pinAt = s.user.indexOf(cd.id);
      var b = cbEl("button", "cb-cond");
      b.type = "button";
      b.setAttribute("data-cb", "cond");
      b.setAttribute("data-id", cd.id);
      var sw = cbEl("span", "cb-sw cb-sw-" + cd.id);
      sw.setAttribute("aria-hidden", "true");
      b.appendChild(sw);
      b.appendChild(cbEl("span", null, cd.label));
      b.appendChild(cbEl("span", "cb-cs",
        pinAt >= 0 ? "seated at pin " + (pinAt + 1) : "in tray"));
      b.addEventListener("click", function () { cbSeat(cd.id); });
      w.appendChild(b);
    });
  }

  function cbSeat(id) {
    if (cbS.testing) return;
    var s = cbCS();
    if (cbS.sel < 0) {
      toast("Pick a pin first, then a conductor.");
      return;
    }
    var from = s.user.indexOf(id);
    if (from === cbS.sel) return; /* seating what is already there: no change */
    if (from >= 0) s.user[from] = null;
    s.user[cbS.sel] = id;
    if (s.certified) {
      s.certified = false;
      toast("Certification cleared, the plug changed.");
    }
    s.tested = false;
    s.result = null;
    cbRenderAll();
  }

  function cbRenderActions() {
    var w = cbEls.actions;
    w.innerHTML = "";
    var clear = cbEl("button", "cb-btn", "Clear pin");
    clear.type = "button";
    clear.setAttribute("data-cb", "clear");
    clear.addEventListener("click", function () {
      if (cbS.testing) return;
      if (cbS.sel < 0) {
        toast("Pick a pin first.");
        return;
      }
      var s = cbCS();
      s.user[cbS.sel] = null;
      if (s.certified) {
        s.certified = false;
        toast("Certification cleared, the plug changed.");
      }
      s.tested = false;
      s.result = null;
      cbRenderAll();
    });
    w.appendChild(clear);
    var reset = cbEl("button", "cb-btn", "Reset cable");
    reset.type = "button";
    reset.setAttribute("data-cb", "reset");
    reset.addEventListener("click", function () {
      if (cbS.testing) return;
      var s = cbCS(), c = cbCable();
      s.user = c.start.slice();
      s.tested = false;
      s.result = null;
      s.certified = false;
      s.faultsSeen = [];
      cbS.sel = -1;
      toast("Cable reset");
      cbRenderAll();
    });
    w.appendChild(reset);
    var run = cbEl("button", "cb-btn pri", "Run the tester");
    run.type = "button";
    run.setAttribute("data-cb", "run");
    run.disabled = cbS.testing;
    run.addEventListener("click", cbRunTest);
    w.appendChild(run);
  }

  /* ---------------- the tester run ---------------- */

  function cbAppendRow(r, i) {
    var tr = document.createElement("tr");
    function td(txt, cls) {
      var d = document.createElement("td");
      d.textContent = txt;
      if (cls) d.className = cls;
      tr.appendChild(d);
    }
    td(String(r.pin));
    td(r.condLabel, r.fault ? "flt" : "ok");
    td(r.shopLabel);
    td(r.map);
    td(r.pair, r.pair === "OK" ? "ok" : "flt");
    cbEls.tbody.appendChild(tr);
    var led = cbEls.leds[i];
    led.classList.remove("lit");
    led.classList.add(r.fault ? "bad" : "good");
  }

  function cbTestStep(i) {
    var res = cbCS().result;
    cbEls.leds[i].classList.add("lit");
    cbAppendRow(res.rows[i], i);
  }

  function cbRenderVerdict(w) {
    var s = cbCS(), res = s.result, c = cbCable();
    var v = cbEl("div", "cb-verdict " + (res.pass ? "pass" : "fail"));
    if (res.pass) {
      v.appendChild(cbEl("h4", null, "Certified: link up"));
      v.appendChild(cbEl("p", null, c.tag + ": 1000BASE-T, all eight conductors to standard, all four pairs true twisted pairs."));
      if (s.faultsSeen.length) {
        v.appendChild(cbEl("p", null, "Faults found and cleared on this cable: " + s.faultsSeen.join("; ") + "."));
      }
    } else {
      v.appendChild(cbEl("h4", null, "No link"));
      var n = res.faults.length;
      v.appendChild(cbEl("p", null, n + (n === 1 ? " fault" : " faults") +
        " found. Read the table, fix the plug, and test again."));
      var ul = cbEl("ul", "cb-faults");
      res.faults.forEach(function (f) {
        var li = document.createElement("li");
        li.appendChild(cbEl("b", null, f.kind + ": "));
        li.appendChild(cbEl("span", null, f.text));
        ul.appendChild(li);
      });
      v.appendChild(ul);
    }
    w.appendChild(v);
  }

  function cbRenderTester() {
    var w = cbEls.test;
    w.innerHTML = "";
    var s = cbCS();
    if (!s.tested) {
      w.appendChild(cbEl("p", "cb-hint",
        "Wire the plug, then run the tester. The tester checks continuity pin by pin and verifies every twisted pair."));
      return;
    }
    var res = s.result;
    var leds = cbEl("div", "cb-leds");
    leds.setAttribute("aria-hidden", "true");
    cbEls.leds = [];
    for (var i = 0; i < 8; i++) {
      var d = cbEl("div", "cb-led", String(i + 1));
      leds.appendChild(d);
      cbEls.leds.push(d);
    }
    w.appendChild(leds);
    var t = document.createElement("table");
    t.className = "cb-tres";
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    ["PIN", "YOUR END", "SHOP END", "MAP", "PAIR"].forEach(function (h) {
      var th = document.createElement("th");
      th.textContent = h;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    t.appendChild(thead);
    cbEls.tbody = document.createElement("tbody");
    t.appendChild(cbEls.tbody);
    w.appendChild(t);
    if (cbS.testing) return; /* sweep steps fill the rows */
    res.rows.forEach(function (r, i) { cbAppendRow(r, i); });
    cbRenderVerdict(w);
  }

  function cbFinishTest() {
    var s = cbCS();
    cbS.testing = false;
    if (s.result.pass && !s.certified) {
      s.certified = true;
      toast(cbCable().tag + " certified at 1000BASE-T");
    }
    cbRenderAll();
  }

  function cbRunTest() {
    if (cbS.testing) return;
    var s = cbCS(), c = cbCable();
    var res = cbEvaluate(s.user, c.shop, c.expect);
    s.result = res;
    s.tested = true;
    res.faults.forEach(function (f) {
      var seen = f.kind + " at pin " + f.pin;
      if (s.faultsSeen.indexOf(seen) === -1) s.faultsSeen.push(seen);
    });
    cbS.testing = true;
    cbRenderTester();
    if (CB_REDUCED) {
      cbFinishTest();
      return;
    }
    var i = 0;
    (function step() {
      if (i < 8) {
        cbTestStep(i);
        i++;
        setTimeout(step, 200);
      } else {
        cbFinishTest();
      }
    })();
  }

  /* ---------------- certificate ---------------- */

  function cbDownloadCert() {
    var lines = [];
    lines.push("THE CRIMP BAY - CABLE CERTIFICATION RECORD");
    lines.push("OLD IRON bench network, hand-crimped Cat5e");
    lines.push("==================================================");
    CB_CABLES.forEach(function (c, i) {
      var s = cbS.cables[i];
      lines.push("");
      lines.push(c.tag + " - " + c.name + " (" + c.std + "): " +
        (s.certified ? "PASS at 1000BASE-T" : "NOT CERTIFIED"));
      if (s.faultsSeen.length) {
        lines.push("  Faults found and cleared: " + s.faultsSeen.join("; "));
      }
    });
    lines.push("");
    lines.push("Continuity is not correctness: every pair verified as a true twisted pair.");
    lines.push("Certified at the bench.");
    var blob = new Blob([lines.join("\n")], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = "crimp-bay-certification-record.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { (window.URL || window.webkitURL).revokeObjectURL(a.href); }, 4000);
    toast("Certification record downloaded");
  }

  /* ---------------- footer ---------------- */

  function cbRenderFoot() {
    var w = cbEls.foot;
    w.innerHTML = "";
    var n = cbS.cables.filter(function (s) { return s.certified; }).length;
    var p = cbEl("span", "cb-progress");
    p.appendChild(cbEl("b", null, n + " of 3"));
    p.appendChild(cbEl("span", null, " cables certified"));
    w.appendChild(p);
    var cert = cbEl("button", "cb-btn", "Download the certification record");
    cert.type = "button";
    cert.setAttribute("data-cb", "cert");
    cert.disabled = n < 3;
    cert.addEventListener("click", cbDownloadCert);
    w.appendChild(cert);
    var close = cbEl("button", "cb-btn", "Close bench");
    close.type = "button";
    close.setAttribute("data-cb", "close");
    close.addEventListener("click", function () {
      document.getElementById("cbOverlay").classList.remove("open");
    });
    w.appendChild(close);
  }

  function cbRenderAll() {
    cbRenderTabs();
    cbRenderBlurb();
    cbRenderPins();
    cbRenderHint();
    cbRenderTray();
    cbRenderActions();
    cbRenderTester();
    cbRenderFoot();
  }

  /* ---------------- build ---------------- */

  function cbBuild() {
    var box = document.querySelector(".dossier .actions");
    if (!box || document.getElementById("cbBtn")) return;

    var st = document.createElement("style");
    st.textContent = CB_CSS;
    document.head.appendChild(st);

    var b = document.createElement("button");
    b.id = "cbBtn";
    b.className = "secondary";
    b.textContent = "Run the Crimp Bay";
    b.addEventListener("click", function () {
      document.getElementById("cbOverlay").classList.add("open");
    });
    box.appendChild(b);

    var ov = document.createElement("div");
    ov.className = "cb-overlay";
    ov.id = "cbOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "The Crimp Bay");

    var panel = document.createElement("div");
    panel.className = "cb-panel";
    panel.appendChild(cbEl("h3", null, "The Crimp Bay"));
    panel.appendChild(cbEl("p", "cb-spec", "T568B/A - 8P8C - 3 CABLES"));

    var sub = cbEl("p", "cb-sub");
    sub.innerHTML = "The <b>OLD IRON</b> bench network runs on hand-crimped Cat5e. " +
      "Seat eight conductors into an 8P8C plug, match the T568 standard on the reference table, " +
      "run the cable tester, and certify three cables at a full gigabit. " +
      "<b>Continuity is not correctness:</b> the pairs must be true twisted pairs or the link will not train.";
    panel.appendChild(sub);

    cbEls.tabs = cbEl("div", "cb-tabs");
    panel.appendChild(cbEls.tabs);

    cbEls.blurb = cbEl("p", "cb-blurb");
    panel.appendChild(cbEls.blurb);

    panel.appendChild(cbEl("span", "cb-k", "T568 reference, pinout for both ends"));
    panel.appendChild(cbBuildRef());

    panel.appendChild(cbEl("span", "cb-k", "Your plug, pins 1 to 8"));
    cbEls.pins = cbEl("div", "cb-pins");
    panel.appendChild(cbEls.pins);

    cbEls.hint = cbEl("p", "cb-hint");
    panel.appendChild(cbEls.hint);

    panel.appendChild(cbEl("span", "cb-k", "Conductor tray"));
    cbEls.tray = cbEl("div", "cb-tray");
    panel.appendChild(cbEls.tray);

    cbEls.actions = cbEl("div", "cb-actions");
    panel.appendChild(cbEls.actions);

    panel.appendChild(cbEl("span", "cb-k", "Cable tester"));
    cbEls.test = cbEl("div", null);
    panel.appendChild(cbEls.test);

    cbEls.foot = cbEl("div", "cb-foot");
    panel.appendChild(cbEls.foot);

    ov.appendChild(panel);
    document.body.appendChild(ov);

    cbS = cbNewState();
    cbRenderAll();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", cbBuild);
    } else {
      cbBuild();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      CB: {
        CONDUCTORS: CB_COND, T568B: CB_T568B, T568A: CB_T568A,
        PAIRS: CB_PAIRS, CABLES: CB_CABLES, evaluate: cbEvaluate, cond: cbCond
      }
    });
  }

})();
/* ============================================================
   THE RAIL ROOM
   Old Iron bench 22: PSU rail qualification with a real DMM
   model under the hood. Plug in the mains, assert PS_ON, set the
   dial, plant COM and V+ on the 24-pin ATX connector, and read
   every rail against the ATX tolerance table. Three supplies:
   one healthy, one with a 12V rail under the floor, one with a
   marginal 5V rail and excessive ripple. Record all five
   required rails per PSU, call PASS / HOLD / FAIL, and print the
   certification record. Self-contained, appended at the end of
   features.js.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- data: ATX24 pinout, tolerances, PSUs ---------------- */

  var RR_PINS = [
    { n: 1,  color: "orange", net: "3V3",    sig: "3.3V" },
    { n: 2,  color: "orange", net: "3V3",    sig: "3.3V" },
    { n: 3,  color: "black",  net: "GND",    sig: "GND" },
    { n: 4,  color: "red",    net: "5V",     sig: "5V" },
    { n: 5,  color: "black",  net: "GND",    sig: "GND" },
    { n: 6,  color: "red",    net: "5V",     sig: "5V" },
    { n: 7,  color: "black",  net: "GND",    sig: "GND" },
    { n: 8,  color: "gray",   net: "PWR_OK", sig: "PWR_OK" },
    { n: 9,  color: "purple", net: "5VSB",   sig: "5VSB" },
    { n: 10, color: "yellow", net: "12V",    sig: "12V" },
    { n: 11, color: "yellow", net: "12V",    sig: "12V" },
    { n: 12, color: "orange", net: "3V3",    sig: "3.3V" },
    { n: 13, color: "orange", net: "3V3",    sig: "3.3V" },
    { n: 14, color: "blue",   net: "N12V",   sig: "-12V" },
    { n: 15, color: "black",  net: "GND",    sig: "GND" },
    { n: 16, color: "green",  net: "PSON",   sig: "PS_ON#" },
    { n: 17, color: "black",  net: "GND",    sig: "GND" },
    { n: 18, color: "black",  net: "GND",    sig: "GND" },
    { n: 19, color: "black",  net: "GND",    sig: "GND" },
    { n: 20, color: "none",   net: "NC",     sig: "n/c" },
    { n: 21, color: "red",    net: "5V",     sig: "5V" },
    { n: 22, color: "red",    net: "5V",     sig: "5V" },
    { n: 23, color: "red",    net: "5V",     sig: "5V" },
    { n: 24, color: "black",  net: "GND",    sig: "GND" }
  ];

  var RR_SWATCH = {
    orange: "#e07b1a", red: "#d64545", yellow: "#e0b81a", black: "#202226",
    gray: "#9aa0a6", purple: "#8a4baf", blue: "#2f6fd0", green: "#3fa34d",
    none: "transparent"
  };

  /* ATX tolerance table: lo/hi in volts, ripple ceiling in mV peak-to-peak */
  var RR_TOL = [
    { net: "12V",    label: "+12V",  lo: 11.40,  hi: 12.60,  rip: 120, note: "" },
    { net: "5V",     label: "+5V",   lo: 4.75,   hi: 5.25,   rip: 50,  note: "" },
    { net: "3V3",    label: "+3.3V", lo: 3.135,  hi: 3.465,  rip: 50,  note: "" },
    { net: "5VSB",   label: "+5VSB", lo: 4.75,   hi: 5.25,   rip: 50,  note: "live with mains plugged in, PSU off" },
    { net: "N12V",   label: "-12V",  lo: -13.20, hi: -10.80, rip: 120, note: "" },
    { net: "PWR_OK", label: "PWR_OK", lo: 2.4,   hi: 5.25,   rip: null, note: "TTL high, asserts 100 to 500 ms after rails stabilize" }
  ];

  var RR_REQ = ["12V", "5V", "3V3", "5VSB", "PWR_OK"];

  var RR_DIALS = [
    { id: "OFF",  label: "OFF" },
    { id: "V20",  label: "V DC 20" },
    { id: "V200", label: "V DC 200" },
    { id: "VAC",  label: "V AC 200" },
    { id: "A",    label: "A DC (fused)" },
    { id: "CONT", label: "CONT" }
  ];

  var RR_PSUS = [
    { tag: "PSU-A", name: "Stock 450W",
      blurb: "A stock 450W pull from a decommissioned office box. The traveler claims it is healthy. Trust, but verify: the refurb line ships nothing on a claim.",
      r12: 12.04, r5: 5.02, r33: 3.31, rn12: -11.95, vsb: 5.03, pg: 4.92,
      q12: 35, q5: 25, q33: 22, qsb: 20,
      verdict: "PASS",
      why: "Every rail sits inside its ATX window with margin, ripple is under the ceiling on all rails, and PWR_OK asserts cleanly after power-up. This one ships." },
    { tag: "PSU-B", name: "Recond 550W",
      blurb: "A reconditioned 550W unit. The traveler says the last box it fed would boot, then die the moment the GPU spun up. The 12V rail is where graphics cards live.",
      r12: 10.92, r5: 5.01, r33: 3.30, rn12: -12.05, vsb: 5.04, pg: 4.90,
      q12: 90, q5: 28, q33: 24, qsb: 20,
      verdict: "FAIL",
      why: "The 12V rail reads 10.92V against an 11.40V floor. A rail outside its window is a failed rail, no matter how healthy the rest look. This one goes to the scrap cage." },
    { tag: "PSU-C", name: "Pull 600W",
      blurb: "A 600W pull from a dusty tower. All rails light up and PWR_OK asserts, but the 5V line looks nervous on the shop scope. An average is not the whole story.",
      r12: 12.10, r5: 4.79, r33: 3.34, rn12: -11.90, vsb: 5.02, pg: 4.88,
      q12: 40, q5: 130, q33: 25, qsb: 22,
      verdict: "HOLD",
      why: "The 5V rail averages 4.79V, inside the 4.75 to 5.25 window, but it rides the floor and its 130mV ripple breaks the 50mV ceiling. In-spec average with out-of-spec ripple is a hold for load testing, not a pass." }
  ];

  /* ---------------- pure logic ---------------- */

  function rrPin(pinN) { return RR_PINS[pinN - 1]; }

  /* Voltage and ripple (mV peak-to-peak) at a pin. st: { mains, pson } */
  function rrPinVolt(psu, pinN, st) {
    var net = rrPin(pinN).net;
    if (!st.mains) return { v: 0, q: 0 };
    if (net === "5VSB") return { v: psu.vsb, q: psu.qsb };
    if (!st.pson) {
      if (net === "PSON") return { v: 5.0, q: 10 };
      return { v: 0, q: 0 };
    }
    switch (net) {
      case "12V":    return { v: psu.r12,  q: psu.q12 };
      case "5V":     return { v: psu.r5,   q: psu.q5 };
      case "3V3":    return { v: psu.r33,  q: psu.q33 };
      case "N12V":   return { v: psu.rn12, q: psu.q12 };
      case "PWR_OK": return { v: psu.pg,   q: 8 };
      case "PSON":   return { v: 0.04,     q: 5 };
      case "GND":    return { v: 0,        q: 2 };
      default:       return { v: 0,        q: 4 };
    }
  }

  /* Differential measurement: red minus black. */
  function rrMeasure(psu, redN, blackN, st) {
    var r = rrPinVolt(psu, redN, st), b = rrPinVolt(psu, blackN, st);
    return { v: r.v - b.v, q: Math.max(r.q, b.q) };
  }

  function rrWobble(q) {
    return (q / 2) * Math.sin(2 * Math.PI * Date.now() / 900) / 1000;
  }

  function rrTolOf(net) {
    for (var i = 0; i < RR_TOL.length; i++) {
      if (RR_TOL[i].net === net) return RR_TOL[i];
    }
    return null;
  }

  /* Meter display model. Returns { main, unit, sub }. */
  function rrDisp(psu, s) {
    if (s.fuse) return { main: "FUSE", unit: "", sub: "Fuse open. Replace it to keep measuring." };
    if (s.dial === "OFF") return { main: "----", unit: "", sub: "Meter is off." };
    if (!s.com || !s.red) return { main: "----", unit: "", sub: "Plant both probes on the connector." };
    var m = rrMeasure(psu, s.red, s.com, s);
    var wob = rrWobble(m.q);
    if (s.dial === "V20") {
      if (Math.abs(m.v) > 20) return { main: "OL", unit: "V DC", sub: "Over range on the 20V scale." };
      return { main: (m.v + wob).toFixed(2), unit: "V DC", sub: "RIPPLE " + m.q + "mV P-P" };
    }
    if (s.dial === "V200") {
      if (Math.abs(m.v) > 200) return { main: "OL", unit: "V DC", sub: "Over range." };
      return { main: (m.v + wob).toFixed(1), unit: "V DC", sub: "RIPPLE " + m.q + "mV P-P" };
    }
    if (s.dial === "VAC") {
      return { main: (Math.abs(wob) * 2).toFixed(2), unit: "V AC",
        sub: "AC mode on a DC rail reads near zero. Wrong mode for rails." };
    }
    if (s.dial === "A") {
      return { main: (m.v / 10).toFixed(2), unit: "A DC",
        sub: "Current mode is a near-short across the probes." };
    }
    var same = (rrPin(s.red).net === rrPin(s.com).net);
    if (same) return { main: "BEEP", unit: "", sub: "0.3 ohm. Same net on both probes." };
    return { main: "OL", unit: "", sub: "Open. Different nets." };
  }

  /* A DMM in current mode is a near-short: across a live rail it blows. */
  function rrMaybeBlowFuse(psu, s) {
    if (s.fuse || s.dial !== "A" || !s.com || !s.red) return false;
    var m = rrMeasure(psu, s.red, s.com, s);
    if (Math.abs(m.v) > 1) {
      s.fuse = true;
      s.com = 0; s.red = 0; s.readings = [];
      return true;
    }
    return false;
  }

  function rrCanRecord(s) {
    return !s.fuse && s.com && s.red && (s.dial === "V20" || s.dial === "V200");
  }

  function rrRecord(psu, s) {
    var m = rrMeasure(psu, s.red, s.com, s);
    var net = rrPin(s.red).net;
    var entry = { red: s.red, black: s.com, net: net, v: m.v, q: m.q };
    var done = false;
    for (var i = 0; i < s.readings.length; i++) {
      if (s.readings[i].net === net) { s.readings[i] = entry; done = true; }
    }
    if (!done) s.readings.push(entry);
    return entry;
  }

  function rrMissing(s) {
    return RR_REQ.filter(function (net) {
      return !s.readings.some(function (r) { return r.net === net; });
    });
  }

  function rrVerdict(psu, s, v) {
    s.verdict = v;
    s.judged = (v === psu.verdict);
  }

  /* ---------------- CSS ---------------- */

  var RR_CSS = [
    ".rr-overlay{position:fixed;inset:0;background:rgba(4,7,7,.94);z-index:90;display:none;overflow-y:auto;padding:18px 12px;}",
    ".rr-overlay.open{display:block;}",
    ".rr-panel{max-width:1020px;margin:0 auto;background:var(--panel);border:1px solid var(--line);padding:20px;}",
    ".rr-panel h3{font-family:var(--font-d);font-size:24px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.02em;color:var(--ember);}",
    ".rr-spec{font-family:var(--font-m);font-size:10.5px;color:var(--dim);letter-spacing:.1em;margin:0 0 10px;}",
    ".rr-sub{color:var(--steel);font-size:12.5px;line-height:1.7;margin:0 0 14px;max-width:72ch;}",
    ".rr-sub b{color:var(--paper);font-weight:600;}",
    ".rr-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 12px;}",
    "@media(max-width:760px){.rr-tabs{grid-template-columns:1fr;}}",
    ".rr-tab{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;min-height:48px;text-align:left;cursor:pointer;color:var(--paper);font-family:var(--font-d);font-size:13px;}",
    ".rr-tab .rr-tag{font-family:var(--font-m);font-size:10.5px;color:var(--dim);display:block;letter-spacing:.08em;}",
    ".rr-tab .rr-st{font-family:var(--font-m);font-size:10.5px;letter-spacing:.08em;display:block;margin-top:2px;}",
    ".rr-tab[aria-selected=\"true\"]{border-color:var(--ember);}",
    ".rr-st.todo{color:var(--dim);}.rr-st.done{color:var(--mint);}",
    ".rr-blurb{border:1px dashed var(--line);padding:10px 12px;margin:0 0 12px;font-size:12.5px;line-height:1.7;color:var(--steel);}",
    ".rr-blurb b{color:var(--paper);}",
    ".rr-k{font-family:var(--font-m);font-size:10.5px;color:var(--dim);letter-spacing:.1em;display:block;margin:0 0 8px;}",
    ".rr-tol{width:100%;border-collapse:collapse;font-family:var(--font-m);font-size:11px;margin:0 0 14px;color:var(--steel);}",
    ".rr-tol th,.rr-tol td{border:1px solid var(--line);padding:6px 8px;text-align:left;}",
    ".rr-tol th{color:var(--dim);font-weight:400;letter-spacing:.08em;font-size:10px;}",
    ".rr-tol td b{color:var(--paper);font-weight:400;}",
    ".rr-deck{border:1px solid var(--line);background:var(--panel-2);padding:12px;margin:0 0 14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;}",
    ".rr-deck .rr-dlabel{font-family:var(--font-m);font-size:10.5px;color:var(--dim);letter-spacing:.1em;width:100%;}",
    ".rr-btn{border:1px solid var(--line);background:var(--panel);color:var(--paper);padding:12px 18px;min-height:48px;cursor:pointer;font-family:var(--font-d);font-size:13px;}",
    ".rr-btn.pri{border-color:var(--ember);color:var(--ember);}",
    ".rr-btn.on{border-color:var(--mint);color:var(--mint);}",
    ".rr-btn.warn{border-color:var(--bad);color:var(--bad);}",
    ".rr-btn:hover{border-color:var(--ember);}",
    ".rr-btn:disabled{opacity:.45;cursor:default;}",
    ".rr-btn:focus-visible,.rr-pin:focus-visible,.rr-tab:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}",
    ".rr-pins{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 14px;}",
    ".rr-pin{border:1px solid var(--line);background:var(--panel-2);color:var(--paper);min-height:48px;padding:8px 10px;cursor:pointer;font-family:var(--font-m);font-size:12px;display:flex;align-items:center;gap:10px;text-align:left;}",
    ".rr-pin .rr-pn{color:var(--dim);font-size:10.5px;letter-spacing:.06em;min-width:34px;}",
    ".rr-pin .rr-ps{color:var(--paper);}",
    ".rr-pin .rr-probe{margin-left:auto;font-size:10px;letter-spacing:.08em;padding:3px 8px;border:1px solid var(--line);color:var(--dim);}",
    ".rr-pin .rr-probe.com{border-color:var(--paper);color:var(--paper);}",
    ".rr-pin .rr-probe.red{border-color:var(--ember);color:var(--ember);}",
    ".rr-pin:hover{border-color:var(--ember);}",
    ".rr-sw{display:inline-block;width:14px;height:14px;border:1px solid var(--line);flex:none;}",
    ".rr-meter{border:1px solid var(--line);background:#0a0d0d;padding:14px;margin:0 0 14px;}",
    ".rr-disp{font-family:var(--font-m);font-size:44px;color:var(--ember);letter-spacing:.04em;line-height:1.1;}",
    ".rr-disp .rr-unit{font-size:16px;color:var(--dim);margin-left:8px;}",
    ".rr-dsub{font-family:var(--font-m);font-size:11px;color:var(--dim);letter-spacing:.08em;margin-top:6px;}",
    ".rr-dprobes{font-family:var(--font-m);font-size:11px;color:var(--steel);margin-top:6px;}",
    ".rr-meterrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}",
    ".rr-reqchips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px;}",
    ".rr-chip{font-family:var(--font-m);font-size:10.5px;letter-spacing:.08em;padding:8px 10px;border:1px solid var(--line);color:var(--dim);}",
    ".rr-chip.got{border-color:var(--mint);color:var(--mint);}",
    ".rr-log{width:100%;border-collapse:collapse;font-family:var(--font-m);font-size:11px;margin:0 0 14px;color:var(--steel);}",
    ".rr-log th,.rr-log td{border:1px solid var(--line);padding:6px 8px;text-align:left;}",
    ".rr-log th{color:var(--dim);font-weight:400;letter-spacing:.08em;font-size:10px;}",
    ".rr-log td.ok{color:var(--mint);}.rr-log td.flt{color:var(--bad);}",
    ".rr-vbtns{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px;}",
    ".rr-vres{border:1px solid var(--line);padding:12px 14px;margin:0 0 12px;font-size:13px;line-height:1.7;}",
    ".rr-vres h4{margin:0 0 6px;font-size:15px;text-transform:uppercase;letter-spacing:.03em;font-family:var(--font-d);}",
    ".rr-vres.pass{border-color:var(--mint);}.rr-vres.pass h4{color:var(--mint);}",
    ".rr-vres.hold{border-color:var(--ember);}.rr-vres.hold h4{color:var(--ember);}",
    ".rr-vres.fail{border-color:var(--bad);}.rr-vres.fail h4{color:var(--bad);}",
    ".rr-vres p{margin:0;color:var(--steel);font-size:12.5px;}",
    ".rr-vres .rr-why{margin-top:8px;}",
    ".rr-foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center;}",
    ".rr-progress{font-family:var(--font-m);font-size:11.5px;color:var(--steel);margin-right:auto;}",
    ".rr-progress b{color:var(--paper);}"
  ].join("\n");

  /* ---------------- state ---------------- */

  var rrS = null;
  var rrEls = {};

  function rrNewState() {
    return {
      pi: 0,
      psus: RR_PSUS.map(function () {
        return { mains: false, pson: false, dial: "V20", arm: "COM",
                 com: 0, red: 0, readings: [], verdict: null, judged: null,
                 fuse: false };
      })
    };
  }
  function rrPsu() { return RR_PSUS[rrS.pi]; }
  function rrPS() { return rrS.psus[rrS.pi]; }

  function rrEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function rrCertified() {
    return rrS.psus.filter(function (s) { return s.judged === true; }).length;
  }

  /* ---------------- render ---------------- */

  function rrRenderTabs() {
    var w = rrEls.tabs;
    w.innerHTML = "";
    RR_PSUS.forEach(function (p, i) {
      var s = rrS.psus[i];
      var b = rrEl("button", "rr-tab");
      b.type = "button";
      b.setAttribute("data-rr", "tab");
      b.setAttribute("data-i", String(i));
      b.setAttribute("aria-selected", i === rrS.pi ? "true" : "false");
      b.appendChild(rrEl("span", "rr-tag", p.tag + " - " + p.name));
      b.appendChild(rrEl("span", "rr-st " + (s.judged === true ? "done" : "todo"),
        s.judged === true ? "CERTIFIED " + s.verdict : "UNCERTIFIED"));
      b.addEventListener("click", function () {
        rrS.pi = i;
        rrRenderAll();
      });
      w.appendChild(b);
    });
  }

  function rrRenderBlurb() {
    var w = rrEls.blurb;
    w.innerHTML = "";
    var p = rrPsu();
    w.appendChild(rrEl("b", null, p.tag + " - " + p.name + ". "));
    w.appendChild(rrEl("span", null, p.blurb));
  }

  function rrBuildTol() {
    var t = document.createElement("table");
    t.className = "rr-tol";
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    ["RAIL", "MIN", "MAX", "RIPPLE MAX", "NOTE"].forEach(function (h) {
      var th = document.createElement("th");
      th.textContent = h;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = document.createElement("tbody");
    RR_TOL.forEach(function (r) {
      var tr = document.createElement("tr");
      [["b", r.label],
       ["", r.lo.toFixed(r.net === "3V3" ? 3 : 2) + "V"],
       ["", r.hi.toFixed(r.net === "3V3" ? 3 : 2) + "V"],
       ["", r.rip == null ? "-" : r.rip + "mV P-P"],
       ["", r.note]].forEach(function (cell) {
        var td = document.createElement("td");
        if (cell[0] === "b") {
          var bb = document.createElement("b");
          bb.textContent = cell[1];
          td.appendChild(bb);
        } else {
          td.textContent = cell[1];
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  function rrRenderDeck() {
    var w = rrEls.deck;
    w.innerHTML = "";
    var s = rrPS();

    var mains = rrEl("button", "rr-btn" + (s.mains ? " on" : ""));
    mains.type = "button";
    mains.setAttribute("data-rr", "mains");
    mains.textContent = "Mains: " + (s.mains ? "plugged in" : "unplugged");
    mains.addEventListener("click", function () {
      s.mains = !s.mains;
      if (!s.mains) s.pson = false;
      rrRenderAll();
    });
    w.appendChild(mains);

    var power = rrEl("button", "rr-btn" + (s.pson ? " on" : ""));
    power.type = "button";
    power.setAttribute("data-rr", "power");
    power.textContent = "Power: " + (s.pson ? "on (PS_ON low)" : "off (PS_ON high)");
    power.disabled = !s.mains;
    power.addEventListener("click", function () {
      if (!s.mains) return;
      s.pson = !s.pson;
      rrRenderAll();
    });
    w.appendChild(power);

    w.appendChild(rrEl("span", "rr-dlabel", "Meter dial"));
    RR_DIALS.forEach(function (d) {
      var b = rrEl("button", "rr-btn" + (s.dial === d.id ? " pri" : "") +
        (d.id === "A" ? " warn" : ""));
      b.type = "button";
      b.setAttribute("data-rr", "dial");
      b.setAttribute("data-id", d.id);
      b.textContent = d.label;
      b.setAttribute("aria-pressed", s.dial === d.id ? "true" : "false");
      b.addEventListener("click", function () {
        s.dial = d.id;
        if (rrMaybeBlowFuse(rrPsu(), s)) {
          toast("Fuse blown: current mode across a live rail is a short. Readings cleared.");
        }
        rrRenderAll();
      });
      w.appendChild(b);
    });

    w.appendChild(rrEl("span", "rr-dlabel", "Probe to plant next"));
    var armC = rrEl("button", "rr-btn" + (s.arm === "COM" ? " pri" : ""));
    armC.type = "button";
    armC.setAttribute("data-rr", "armcom");
    armC.textContent = "COM (black)";
    armC.setAttribute("aria-pressed", s.arm === "COM" ? "true" : "false");
    armC.addEventListener("click", function () { s.arm = "COM"; rrRenderAll(); });
    w.appendChild(armC);
    var armR = rrEl("button", "rr-btn" + (s.arm === "RED" ? " pri" : ""));
    armR.type = "button";
    armR.setAttribute("data-rr", "armred");
    armR.textContent = "V+ (red)";
    armR.setAttribute("aria-pressed", s.arm === "RED" ? "true" : "false");
    armR.addEventListener("click", function () { s.arm = "RED"; rrRenderAll(); });
    w.appendChild(armR);
    var lift = rrEl("button", "rr-btn");
    lift.type = "button";
    lift.setAttribute("data-rr", "lift");
    lift.textContent = "Lift probes";
    lift.addEventListener("click", function () {
      s.com = 0; s.red = 0; s.arm = "COM";
      rrRenderAll();
    });
    w.appendChild(lift);

    if (s.fuse) {
      var fuse = rrEl("button", "rr-btn warn");
      fuse.type = "button";
      fuse.setAttribute("data-rr", "fuse");
      fuse.textContent = "Replace fuse";
      fuse.addEventListener("click", function () {
        s.fuse = false;
        toast("Fuse replaced. Set the dial to V DC before probing again.");
        rrRenderAll();
      });
      w.appendChild(fuse);
    }
  }

  function rrRenderPins() {
    var w = rrEls.pins;
    w.innerHTML = "";
    var s = rrPS();
    for (var row = 0; row < 12; row++) {
      [row + 1, row + 13].forEach(function (pinN) {
        var pin = rrPin(pinN);
        var b = rrEl("button", "rr-pin");
        b.type = "button";
        b.setAttribute("data-rr", "pin");
        b.setAttribute("data-i", String(pinN));
        var probe = (s.com === pinN) ? "com" : (s.red === pinN ? "red" : "");
        b.setAttribute("aria-label", "Pin " + pinN + ", " + pin.sig +
          " rail, " + pin.color + " wire" +
          (probe === "com" ? ". COM probe planted." : probe === "red" ? ". V+ probe planted." : "."));
        b.appendChild(rrEl("span", "rr-pn", "P" + pinN));
        var sw = rrEl("span", "rr-sw");
        sw.style.background = RR_SWATCH[pin.color] || "transparent";
        b.appendChild(sw);
        b.appendChild(rrEl("span", "rr-ps", pin.sig));
        var badge = rrEl("span", "rr-probe " + probe,
          probe === "com" ? "COM" : probe === "red" ? "V+" : "");
        b.appendChild(badge);
        b.addEventListener("click", function () {
          rrPlantProbe(pinN);
        });
        w.appendChild(b);
      });
    }
  }

  function rrPlantProbe(pinN) {
    var s = rrPS();
    if (s.arm === "COM") {
      if (s.com === pinN) { s.com = 0; }
      else { s.com = pinN; s.arm = "RED"; }
    } else {
      if (s.red === pinN) { s.red = 0; }
      else { s.red = pinN; }
    }
    if (s.red && s.com && s.red === s.com) s.red = 0;
    if (rrMaybeBlowFuse(rrPsu(), s)) {
      toast("Fuse blown: current mode across a live rail is a short. Readings cleared.");
    }
    rrRenderAll();
  }

  function rrRenderMeter() {
    var w = rrEls.meter;
    w.innerHTML = "";
    rrEls.dMain = rrEl("div", "rr-disp");
    rrEls.dUnit = rrEl("span", "rr-unit");
    rrEls.dMain.appendChild(rrEls.dUnit);
    w.appendChild(rrEls.dMain);
    rrEls.dSub = rrEl("div", "rr-dsub");
    w.appendChild(rrEls.dSub);
    rrEls.dProbes = rrEl("div", "rr-dprobes");
    w.appendChild(rrEls.dProbes);
    var row = rrEl("div", "rr-meterrow");
    var rec = rrEl("button", "rr-btn pri");
    rec.type = "button";
    rec.setAttribute("data-rr", "record");
    rec.textContent = "Record reading";
    rec.addEventListener("click", function () {
      var s = rrPS();
      if (!rrCanRecord(s)) {
        toast("Set the dial to V DC and plant both probes first.");
        return;
      }
      var e = rrRecord(rrPsu(), s);
      toast("Recorded " + e.net + ": " + e.v.toFixed(2) + "V (P" + e.red + " ref P" + e.black + ").");
      rrRenderAll();
    });
    row.appendChild(rec);
    w.appendChild(row);
    rrTick();
  }

  function rrTick() {
    if (!rrS || !rrEls.dMain) return;
    var s = rrPS();
    var d = rrDisp(rrPsu(), s);
    rrEls.dMain.textContent = d.main;
    rrEls.dMain.appendChild(rrEls.dUnit);
    rrEls.dUnit.textContent = d.unit || "";
    rrEls.dSub.textContent = d.sub || "";
    rrEls.dProbes.textContent = "COM " + (s.com ? "on P" + s.com : "not planted") +
      "   V+ " + (s.red ? "on P" + s.red : "not planted");
  }

  function rrNetLabel(net) {
    var t = rrTolOf(net);
    return t ? t.label : net;
  }

  function rrRenderReq() {
    var w = rrEls.req;
    w.innerHTML = "";
    var s = rrPS();
    var miss = {};
    rrMissing(s).forEach(function (n) { miss[n] = true; });
    RR_REQ.forEach(function (net) {
      var got = !miss[net];
      var chip = rrEl("span", "rr-chip" + (got ? " got" : ""), null);
      if (got) {
        var r = s.readings.filter(function (x) { return x.net === net; })[0];
        chip.textContent = rrNetLabel(net) + ": " + r.v.toFixed(2) + "V RECORDED";
      } else {
        chip.textContent = rrNetLabel(net) + ": MISSING";
      }
      w.appendChild(chip);
    });
  }

  function rrRenderLog() {
    var w = rrEls.log;
    w.innerHTML = "";
    var s = rrPS();
    if (!s.readings.length) {
      w.appendChild(rrEl("p", "rr-dsub", "No readings recorded yet."));
      return;
    }
    var t = document.createElement("table");
    t.className = "rr-log";
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    ["#", "RED PIN", "REF PIN", "RAIL", "VOLTS", "RIPPLE", "IN SPEC"].forEach(function (h) {
      var th = document.createElement("th");
      th.textContent = h;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = document.createElement("tbody");
    s.readings.forEach(function (r, i) {
      var tr = document.createElement("tr");
      var tol = rrTolOf(r.net);
      var inSpec = true;
      if (tol) {
        inSpec = (r.v >= tol.lo - 1e-9 && r.v <= tol.hi + 1e-9) &&
          (tol.rip == null || r.q <= tol.rip);
      }
      [["", String(i + 1)],
       ["", "P" + r.red],
       ["", "P" + r.black],
       ["b", rrNetLabel(r.net)],
       ["", r.v.toFixed(2) + "V"],
       ["", r.q + "mV P-P"],
       [inSpec ? "ok" : "flt", inSpec ? "YES" : "NO"]].forEach(function (cell) {
        var td = document.createElement("td");
        if (cell[0] === "b") {
          var bb = document.createElement("b");
          bb.textContent = cell[1];
          td.appendChild(bb);
        } else {
          td.textContent = cell[1];
          if (cell[0]) td.className = cell[0];
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    w.appendChild(t);
  }

  function rrRenderVerdict() {
    var w = rrEls.vres;
    w.innerHTML = "";
    var s = rrPS();
    var p = rrPsu();
    var vb = rrEls.vbtns;
    vb.innerHTML = "";
    ["PASS", "HOLD", "FAIL"].forEach(function (v) {
      var b = rrEl("button", "rr-btn" + (v === "PASS" ? " on" : v === "FAIL" ? " warn" : " pri"));
      b.type = "button";
      b.setAttribute("data-rr", "verdict");
      b.setAttribute("data-v", v);
      b.textContent = "Verdict: " + v;
      b.disabled = rrMissing(s).length > 0 || s.judged != null;
      b.addEventListener("click", function () {
        rrVerdict(p, s, v);
        rrRenderAll();
      });
      vb.appendChild(b);
    });

    if (s.judged == null) {
      var miss = rrMissing(s);
      if (miss.length) {
        w.appendChild(rrEl("p", "rr-dsub",
          "Record all five required rails to unlock the verdict: " +
          miss.map(rrNetLabel).join(", ") + " still missing."));
      } else {
        w.appendChild(rrEl("p", "rr-dsub",
          "All five rails recorded. Call it: PASS ships the unit, HOLD sends it to load testing, FAIL sends it to the scrap cage."));
      }
      return;
    }

    var box = rrEl("div", "rr-vres " + (s.judged ? s.verdict.toLowerCase() : "fail"));
    var h = rrEl("h4", null, s.judged ? "CERTIFIED: " + s.verdict : "VOID: THE CORRECT CALL WAS " + p.verdict);
    box.appendChild(h);
    var why = rrEl("p", "rr-why", p.why);
    box.appendChild(why);
    w.appendChild(box);
    if (!s.judged) {
      var rerun = rrEl("button", "rr-btn pri");
      rerun.type = "button";
      rerun.setAttribute("data-rr", "rerun");
      rerun.textContent = "Re-run this PSU";
      rerun.addEventListener("click", function () {
        var ns = rrS.psus[rrS.pi];
        ns.readings = []; ns.verdict = null; ns.judged = null;
        ns.fuse = false; ns.com = 0; ns.red = 0; ns.arm = "COM";
        rrRenderAll();
      });
      w.appendChild(rerun);
    }
  }

  function rrRenderFoot() {
    var w = rrEls.foot;
    w.innerHTML = "";
    var n = rrCertified();
    var p = rrEl("span", "rr-progress");
    p.appendChild(rrEl("b", null, n + " of 3"));
    p.appendChild(rrEl("span", null, " PSUs certified"));
    w.appendChild(p);
    var cert = rrEl("button", "rr-btn", "Download the certification record");
    cert.type = "button";
    cert.setAttribute("data-rr", "cert");
    cert.disabled = n < 3;
    cert.addEventListener("click", rrDownloadCert);
    w.appendChild(cert);
    var close = rrEl("button", "rr-btn", "Close bench");
    close.type = "button";
    close.setAttribute("data-rr", "close");
    close.addEventListener("click", function () {
      document.getElementById("rrOverlay").classList.remove("open");
    });
    w.appendChild(close);
  }

  function rrDownloadCert() {
    var lines = [];
    lines.push("THE RAIL ROOM - PSU CERTIFICATION RECORD");
    lines.push("OLD IRON refurb line, 24-pin ATX rail qualification");
    lines.push("");
    RR_PSUS.forEach(function (p, i) {
      var s = rrS.psus[i];
      lines.push(p.tag + " " + p.name + ": " + (s.verdict || "UNCERTIFIED"));
      s.readings.forEach(function (r) {
        lines.push("  " + rrNetLabel(r.net) + " @ P" + r.red + " (ref P" + r.black + "): " +
          r.v.toFixed(2) + "V, ripple " + r.q + "mV P-P");
      });
      lines.push("");
    });
    var blob = new Blob([lines.join("\n")], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = "rail-room-certification.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { (window.URL || window.webkitURL).revokeObjectURL(a.href); }, 4000);
    toast("Certification record downloaded");
  }

  function rrRenderAll() {
    rrRenderTabs();
    rrRenderBlurb();
    rrRenderDeck();
    rrRenderPins();
    rrRenderMeter();
    rrRenderReq();
    rrRenderLog();
    rrRenderVerdict();
    rrRenderFoot();
  }

  /* ---------------- build ---------------- */

  function rrBuild() {
    var box = document.querySelector(".dossier .actions");
    if (!box || document.getElementById("rrBtn")) return;

    var st = document.createElement("style");
    st.textContent = RR_CSS;
    document.head.appendChild(st);

    var b = document.createElement("button");
    b.id = "rrBtn";
    b.className = "secondary";
    b.textContent = "Run the Rail Room";
    b.addEventListener("click", function () {
      document.getElementById("rrOverlay").classList.add("open");
    });
    box.appendChild(b);

    var ov = document.createElement("div");
    ov.className = "rr-overlay";
    ov.id = "rrOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "The Rail Room");

    var panel = document.createElement("div");
    panel.className = "rr-panel";
    panel.appendChild(rrEl("h3", null, "The Rail Room"));
    panel.appendChild(rrEl("p", "rr-spec", "ATX 24-PIN - DMM - 3 PSUS"));

    var sub = rrEl("p", "rr-sub");
    sub.innerHTML = "The <b>OLD IRON</b> refurb line ships no PSU on a claim. " +
      "Plug in the mains, press power, and set the meter to V DC. Plant the black COM probe " +
      "on a ground pin, walk the red probe across the rails, and record <b>12V, 5V, 3.3V, 5VSB, and PWR_OK</b>. " +
      "Then call the verdict: <b>PASS</b> ships the unit, <b>HOLD</b> sends it to load testing, <b>FAIL</b> sends it to the scrap cage. " +
      "A meter in current mode across a live rail is a blown fuse; continuity mode beeps on a shared net.";
    panel.appendChild(sub);

    rrEls.tabs = rrEl("div", "rr-tabs");
    panel.appendChild(rrEls.tabs);

    rrEls.blurb = rrEl("p", "rr-blurb");
    panel.appendChild(rrEls.blurb);

    panel.appendChild(rrEl("span", "rr-k", "ATX tolerance table"));
    panel.appendChild(rrBuildTol());

    panel.appendChild(rrEl("span", "rr-k", "Bench controls"));
    rrEls.deck = rrEl("div", "rr-deck");
    panel.appendChild(rrEls.deck);

    panel.appendChild(rrEl("span", "rr-k", "24-pin ATX connector, front view"));
    rrEls.pins = rrEl("div", "rr-pins");
    panel.appendChild(rrEls.pins);

    panel.appendChild(rrEl("span", "rr-k", "Meter"));
    rrEls.meter = rrEl("div", "rr-meter");
    panel.appendChild(rrEls.meter);

    panel.appendChild(rrEl("span", "rr-k", "Required rails"));
    rrEls.req = rrEl("div", "rr-reqchips");
    panel.appendChild(rrEls.req);

    rrEls.log = rrEl("div", null);
    panel.appendChild(rrEls.log);

    panel.appendChild(rrEl("span", "rr-k", "Verdict"));
    rrEls.vbtns = rrEl("div", "rr-vbtns");
    panel.appendChild(rrEls.vbtns);
    rrEls.vres = rrEl("div", null);
    panel.appendChild(rrEls.vres);

    rrEls.foot = rrEl("div", "rr-foot");
    panel.appendChild(rrEls.foot);

    ov.appendChild(panel);
    document.body.appendChild(ov);

    rrS = rrNewState();
    rrRenderAll();

    if (typeof setInterval !== "undefined") {
      setInterval(rrTick, 300);
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", rrBuild);
    } else {
      rrBuild();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      RR: {
        PINS: RR_PINS, TOL: RR_TOL, PSUS: RR_PSUS, REQUIRED: RR_REQ, DIALS: RR_DIALS,
        pinVolt: rrPinVolt, measure: rrMeasure, disp: rrDisp, tolOf: rrTolOf,
        newState: rrNewState, record: rrRecord, missing: rrMissing,
        maybeBlowFuse: rrMaybeBlowFuse, verdict: rrVerdict, canRecord: rrCanRecord
      }
    });
  }

})();
/* ============================================================
   THE SWITCH ROOM
   Old Iron bench networking: IP addressing and subnet design for
   the refurb shop's three network zones. Task 1 is real CIDR math
   (network, broadcast, usable hosts, first/last usable) with a live
   binary worksheet that shows the bits. Task 2 is subnet design:
   pick a prefix that fits the host count, plant an aligned subnet
   inside the base block, and place the gateway on a usable host.
   Certify all three zones with zero addressing errors to print the
   certification record. Self-contained, appended at the end of
   features.js.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- pure IPv4 math (no DOM) ---------------- */

  function swParseIP(s) {
    if (typeof s !== "string") return null;
    var p = s.trim().split(".");
    if (p.length !== 4) return null;
    var n = 0;
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(p[i])) return null;
      var v = parseInt(p[i], 10);
      if (v < 0 || v > 255) return null;
      n = n * 256 + v;
    }
    return n >>> 0;
  }

  function swInt2ip(n) {
    n = n >>> 0;
    return ((n >>> 24) & 255) + "." + ((n >>> 16) & 255) + "." +
           ((n >>> 8) & 255) + "." + (n & 255);
  }

  function swMask(p) {
    if (p <= 0) return 0;
    if (p >= 32) return 0xFFFFFFFF;
    return (0xFFFFFFFF << (32 - p)) >>> 0;
  }

  function swNet(ip, p) { return (ip & swMask(p)) >>> 0; }
  function swBcast(ip, p) { return (swNet(ip, p) | (~swMask(p) >>> 0)) >>> 0; }
  function swUsable(p) {
    if (p < 0 || p > 30) return 0;
    return Math.pow(2, 32 - p) - 2;
  }
  function swFirst(ip, p) { return (swNet(ip, p) + 1) >>> 0; }
  function swLast(ip, p) { return (swBcast(ip, p) - 1) >>> 0; }

  function swBin8(v) {
    var s = (v & 255).toString(2);
    while (s.length < 8) s = "0" + s;
    return s;
  }

  function swOctets(n) {
    n = n >>> 0;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }

  /* ---------------- scenarios ---------------- */

  var SW_T1_PREFIXES = [24, 25, 26, 27, 28];
  var SW_T1_NETS = ["192.168", "10.20", "172.16"];

  function swPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function swGenT1() {
    var net = swPick(SW_T1_NETS);
    var o3 = 1 + Math.floor(Math.random() * 253);
    var o4 = 1 + Math.floor(Math.random() * 253);
    return { ip: swParseIP(net + "." + o3 + "." + o4), p: swPick(SW_T1_PREFIXES) };
  }

  var SW_ZONES = [
    { tag: "SHOP FLOOR",  need: 12, base: "10.14.0.0", baseP: 24,
      blurb: "The workbenches: twelve refurbished desktops that PXE-boot their test images from the shop server. They need their own subnet, carved from the shop base block." },
    { tag: "BURN-IN ROW", need: 28, base: "10.14.1.0", baseP: 24,
      blurb: "The burn-in racks: twenty-eight test nodes hammering GPUs around the clock. Give the row a subnet with room to spare, carved from the burn-in base block." },
    { tag: "FRONT OFFICE", need: 55, base: "10.14.2.0", baseP: 24,
      blurb: "The front office: fifty-five seats between desks, printers, and the point-of-sale. One subnet from the office base block, big enough for all of them." }
  ];

  function swNewZoneState(z) {
    return {
      def: z, t1: swGenT1(),
      a1: { net: "", bcast: "", hosts: "", first: "", last: "" },
      a2: { prefix: "", subnet: "", gw: "" },
      t1ok: false, t2ok: false, bitsOpen: false, checks: 0,
      hint1: false
    };
  }

  /* ---------------- checks (pure, exported for tests) ---------------- */

  function swCheckT1(zs, a) {
    var t1 = zs.t1, out = {};
    var netI = swNet(t1.ip, t1.p), bcI = swBcast(t1.ip, t1.p);
    var exp = {
      net: swInt2ip(netI),
      bcast: swInt2ip(bcI),
      hosts: String(swUsable(t1.p)),
      first: swInt2ip(swFirst(t1.ip, t1.p)),
      last: swInt2ip(swLast(t1.ip, t1.p))
    };
    var keys = ["net", "bcast", "hosts", "first", "last"];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var got = (a[k] || "").trim();
      if (k === "hosts") {
        out[k] = { ok: got === exp[k], msg: got === exp[k] ? "Correct: " + exp[k] + " usable hosts" : "Not yet: count the host bits, 2^n minus network and broadcast" };
      } else {
        out[k] = { ok: got === exp[k], msg: got === exp[k] ? "Correct: " + exp[k] : "Not yet: recheck the bits" };
      }
    }
    out.all = out.net.ok && out.bcast.ok && out.hosts.ok && out.first.ok && out.last.ok;
    out.exp = exp;
    return out;
  }

  function swCheckT2(zs, a) {
    var out = {};
    var need = zs.def.need;
    var baseNet = swParseIP(zs.def.base), baseP = zs.def.baseP;
    var p = parseInt(a.prefix, 10);
    out.prefix = { ok: false, msg: "Pick a prefix from the list" };
    if (a.prefix !== "" && !isNaN(p) && p >= 24 && p <= 30) {
      var u = swUsable(p);
      out.prefix = u >= need
        ? { ok: true, msg: "Correct: /" + p + " holds " + u + " usable, the zone needs " + need }
        : { ok: false, msg: "Too small: /" + p + " holds " + u + " usable, the zone needs " + need };
    }
    var netI = swParseIP(a.subnet);
    out.subnet = { ok: false, msg: "Enter the subnet network address as a dotted quad" };
    if (netI !== null && out.prefix.ok) {
      var hostBits = 32 - p;
      var aligned = (hostBits === 0) || ((netI & ((1 << hostBits) - 1)) === 0);
      var inside = ((netI & swMask(baseP)) >>> 0) === baseNet;
      if (!inside) {
        out.subnet = { ok: false, msg: "Outside the base block: it must live inside " + zs.def.base + "/" + baseP };
      } else if (!aligned) {
        out.subnet = { ok: false, msg: "Not aligned: /" + p + " subnets start on host-bit boundaries (host bits all zero)" };
      } else {
        out.subnet = { ok: true, msg: "Correct: " + swInt2ip(netI) + "/" + p + " is aligned inside " + zs.def.base + "/" + baseP };
      }
    } else if (netI !== null && !out.prefix.ok) {
      out.subnet = { ok: false, msg: "Fix the prefix first, then the alignment can be judged" };
    }
    var gwI = swParseIP(a.gw);
    out.gw = { ok: false, msg: "Enter the gateway as a dotted quad" };
    if (gwI !== null && out.subnet.ok) {
      var snet = swNet(netI, p), sbc = swBcast(netI, p);
      if (gwI === snet) {
        out.gw = { ok: false, msg: "That is the network address itself, not a usable host" };
      } else if (gwI === sbc) {
        out.gw = { ok: false, msg: "That is the broadcast address, not a usable host" };
      } else if (gwI > snet && gwI < sbc) {
        out.gw = { ok: true, msg: "Correct: " + swInt2ip(gwI) + " is a usable host in " + swInt2ip(snet) + "/" + p };
      } else {
        out.gw = { ok: false, msg: "Outside the subnet: pick a host between " + swInt2ip(snet + 1) + " and " + swInt2ip(sbc - 1) };
      }
    } else if (gwI !== null && !out.subnet.ok) {
      out.gw = { ok: false, msg: "Plant the subnet first, then place the gateway inside it" };
    }
    out.all = out.prefix.ok && out.subnet.ok && out.gw.ok;
    return out;
  }

  /* ---------------- styles ---------------- */

  var SW_CSS = [
    ".sw-overlay{position:fixed;inset:0;background:rgba(4,7,7,.94);z-index:90;display:none;overflow-y:auto;padding:18px 12px;}",
    ".sw-overlay.open{display:block;}",
    ".sw-panel{max-width:1020px;margin:0 auto;background:var(--panel);border:1px solid var(--line);padding:20px;}",
    ".sw-panel h3{font-family:var(--font-d);font-size:24px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.02em;color:var(--ember);}",
    ".sw-spec{font-family:var(--font-m);font-size:10.5px;color:var(--dim);letter-spacing:.1em;margin:0 0 10px;}",
    ".sw-sub{color:var(--steel);font-size:12.5px;line-height:1.7;margin:0 0 14px;max-width:72ch;}",
    ".sw-sub b{color:var(--paper);font-weight:600;}",
    ".sw-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 12px;}",
    "@media(max-width:760px){.sw-tabs{grid-template-columns:1fr;}}",
    ".sw-tab{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;min-height:48px;text-align:left;cursor:pointer;color:var(--paper);font-family:var(--font-d);font-size:13px;}",
    ".sw-tab .sw-tag{font-family:var(--font-m);font-size:10.5px;color:var(--dim);display:block;letter-spacing:.08em;}",
    ".sw-tab .sw-st{font-family:var(--font-m);font-size:10.5px;letter-spacing:.08em;display:block;margin-top:2px;}",
    ".sw-tab[aria-selected=\"true\"]{border-color:var(--ember);}",
    ".sw-st.todo{color:var(--dim);}.sw-st.part{color:var(--ember);}.sw-st.done{color:var(--mint);}",
    ".sw-blurb{border:1px dashed var(--line);padding:10px 12px;margin:0 0 12px;font-size:12.5px;line-height:1.7;color:var(--steel);}",
    ".sw-blurb b{color:var(--paper);}",
    ".sw-k{font-family:var(--font-m);font-size:10.5px;color:var(--dim);letter-spacing:.1em;display:block;margin:14px 0 8px;}",
    ".sw-card{border:1px solid var(--line);background:var(--panel-2);padding:14px;margin:0 0 12px;}",
    ".sw-card.done{border-color:var(--mint);}",
    ".sw-q{font-family:var(--font-m);font-size:13px;color:var(--paper);margin:0 0 4px;}",
    ".sw-q b{color:var(--ember);font-weight:600;}",
    ".sw-note{font-size:12px;color:var(--dim);margin:0 0 10px;line-height:1.6;}",
    ".sw-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 10px;}",
    ".sw-fld label{display:block;font-family:var(--font-m);font-size:10.5px;color:var(--dim);letter-spacing:.08em;margin:0 0 4px;}",
    ".sw-fld input,.sw-fld select{width:100%;min-height:48px;background:var(--ink);border:1px solid var(--line);color:var(--paper);font-family:var(--font-m);font-size:14px;padding:8px 10px;box-sizing:border-box;}",
    ".sw-fld input:disabled,.sw-fld select:disabled{opacity:.55;}",
    ".sw-fmsg{font-family:var(--font-m);font-size:10.5px;letter-spacing:.06em;margin:4px 0 0;min-height:16px;}",
    ".sw-fmsg.good{color:var(--mint);}.sw-fmsg.bad{color:var(--ember);}",
    ".sw-btnrow{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 2px;}",
    ".sw-btn{border:1px solid var(--line);background:var(--ink);color:var(--paper);font-family:var(--font-d);font-size:13px;min-height:48px;padding:10px 18px;cursor:pointer;letter-spacing:.04em;}",
    ".sw-btn.primary{background:var(--ember);border-color:var(--ember);color:#0a0a0a;font-weight:700;}",
    ".sw-btn:disabled{opacity:.45;cursor:default;}",
    ".sw-btn:hover:not(:disabled){border-color:var(--ember);}",
    ".sw-btn.primary:hover:not(:disabled){border-color:var(--paper);}",
    ".sw-hint{font-size:12px;color:var(--steel);line-height:1.7;margin:8px 0 0;max-width:72ch;display:none;}",
    ".sw-hint.show{display:block;}",
    ".sw-hint b{color:var(--paper);}",
    ".sw-bits{width:100%;border-collapse:collapse;font-family:var(--font-m);font-size:11.5px;margin:8px 0 4px;color:var(--steel);display:none;}",
    ".sw-bits.show{display:table;}",
    ".sw-bits th,.sw-bits td{border:1px solid var(--line);padding:6px 10px;text-align:left;}",
    ".sw-bits th{color:var(--dim);font-weight:400;letter-spacing:.08em;font-size:10px;}",
    ".sw-bits td b{color:var(--paper);font-weight:400;}",
    ".sw-bits .sw-dim{color:var(--dim);}",
    ".sw-banner{border:1px solid var(--mint);color:var(--mint);font-family:var(--font-m);font-size:12px;letter-spacing:.1em;padding:10px 12px;margin:12px 0 0;}",
    "@media(prefers-reduced-motion:no-preference){.sw-pop{animation:swpop .2s ease-out;}}",
    "@keyframes swpop{0%{transform:scale(.96);}100%{transform:scale(1);}}",
    ".sw-done{border:1px solid var(--ember);padding:18px;margin:0 0 12px;}",
    ".sw-done h4{font-family:var(--font-d);font-size:18px;color:var(--ember);margin:0 0 8px;text-transform:uppercase;letter-spacing:.03em;}",
    ".sw-done p{color:var(--steel);font-size:12.5px;line-height:1.7;margin:0 0 8px;}",
    ".sw-done p b{color:var(--paper);}",
    ".sw-zline{font-family:var(--font-m);font-size:11.5px;color:var(--steel);margin:0 0 4px;}",
    ".sw-zline b{color:var(--paper);font-weight:400;}",
    ".sw-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0 0;}",
    ".sw-progress{font-family:var(--font-m);font-size:11.5px;color:var(--dim);letter-spacing:.08em;margin-right:auto;}",
    ".sw-progress b{color:var(--paper);font-weight:600;}",
    ".sw-panel button:focus-visible,.sw-panel input:focus-visible,.sw-panel select:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}"
  ];

  /* ---------------- element helper ---------------- */

  function swEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---------------- state ---------------- */

  var swS = null;
  var swEls = {};

  function swNewState() {
    return {
      zones: SW_ZONES.map(swNewZoneState),
      tab: 0,
      done: false
    };
  }

  function swZone() { return swS.zones[swS.tab]; }

  function swCertified() {
    var n = 0;
    for (var i = 0; i < swS.zones.length; i++) {
      if (swS.zones[i].t1ok && swS.zones[i].t2ok) n++;
    }
    return n;
  }

  /* ---------------- binary worksheet ---------------- */

  function swBuildBits(zs) {
    var t = document.createElement("table");
    t.className = "sw-bits";
    t.setAttribute("aria-label", "Binary worksheet");
    var head = document.createElement("tr");
    ["", "octet 1", "octet 2", "octet 3", "octet 4"].forEach(function (h) {
      var th = document.createElement("th");
      th.textContent = h;
      head.appendChild(th);
    });
    t.appendChild(head);
    var p = zs.t1.p;
    var rows = [
      { label: "address", val: zs.t1.ip },
      { label: "mask /" + p, val: swMask(p) },
      { label: "network", val: swNet(zs.t1.ip, p) },
      { label: "broadcast", val: swBcast(zs.t1.ip, p) }
    ];
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      var lab = document.createElement("th");
      lab.textContent = r.label;
      tr.appendChild(lab);
      var octs = swOctets(r.val);
      for (var i = 0; i < 4; i++) {
        var td = document.createElement("td");
        var bits = swBin8(octs[i]);
        var netBits = Math.min(8, Math.max(0, p - i * 8));
        var nb = document.createElement("b");
        nb.textContent = bits.slice(0, netBits);
        var hb = document.createElement("span");
        hb.className = "sw-dim";
        hb.textContent = bits.slice(netBits);
        td.appendChild(nb);
        td.appendChild(hb);
        tr.appendChild(td);
      }
      t.appendChild(tr);
    });
    return t;
  }

  /* ---------------- zone panel ---------------- */

  var SW_T1_FIELDS = [
    { key: "net", label: "Network address" },
    { key: "bcast", label: "Broadcast address" },
    { key: "hosts", label: "Usable hosts" },
    { key: "first", label: "First usable" },
    { key: "last", label: "Last usable" }
  ];

  function swFieldMsg(container, key, res) {
    var m = container.querySelector("[data-swmsg=\"" + key + "\"]");
    if (!m) return;
    m.textContent = (res.ok ? "CORRECT: " : "NOT YET: ") + res.msg.replace(/^(Correct|Not yet):\s*/, "");
    m.className = "sw-fmsg " + (res.ok ? "good" : "bad");
  }

  function swBuildZone() {
    var w = swEls.zone;
    w.innerHTML = "";
    var zs = swZone(), i = swS.tab;

    var blurb = swEl("p", "sw-blurb");
    blurb.innerHTML = "<b>" + zs.def.tag + ".</b> " + zs.def.blurb;
    w.appendChild(blurb);

    /* ---- task 1 ---- */
    var c1 = swEl("div", "sw-card" + (zs.t1ok ? " done" : ""));
    var q1 = swEl("p", "sw-q");
    q1.innerHTML = "1. Read the address. A host reports <b>" + swInt2ip(zs.t1.ip) + "/" + zs.t1.p + "</b>. Give the five facts.";
    c1.appendChild(q1);
    var n1 = swEl("p", "sw-note", "AND the address with the mask for the network; the broadcast flips every host bit to 1; the count is 2 to the host bits, minus the network and the broadcast.");
    c1.appendChild(n1);

    var fgrid = swEl("div", "sw-fields");
    SW_T1_FIELDS.forEach(function (f) {
      var fld = swEl("div", "sw-fld");
      var lab = document.createElement("label");
      lab.textContent = f.label;
      lab.setAttribute("for", "sw_z" + i + "_" + f.key);
      var inp = document.createElement("input");
      inp.id = "sw_z" + i + "_" + f.key;
      inp.type = "text";
      inp.setAttribute("inputmode", f.key === "hosts" ? "numeric" : "decimal");
      inp.setAttribute("autocomplete", "off");
      inp.setAttribute("spellcheck", "false");
      inp.value = zs.a1[f.key] || "";
      inp.disabled = zs.t1ok;
      (function (key, el) {
        el.addEventListener("input", function () { zs.a1[key] = el.value; });
      })(f.key, inp);
      var msg = swEl("p", "sw-fmsg");
      msg.setAttribute("data-swmsg", f.key);
      msg.setAttribute("aria-live", "polite");
      lab.appendChild(inp);
      fld.appendChild(lab);
      fld.appendChild(msg);
      fgrid.appendChild(fld);
    });
    c1.appendChild(fgrid);

    var b1row = swEl("div", "sw-btnrow");
    var check1 = swEl("button", "sw-btn primary", "Check the five facts");
    check1.type = "button";
    check1.id = "sw_z" + i + "_check1";
    check1.disabled = zs.t1ok;
    check1.addEventListener("click", function () { swOnCheck1(i); });
    b1row.appendChild(check1);
    var bitsBtn = swEl("button", "sw-btn", zs.bitsOpen ? "Hide the bits" : "Show the bits");
    bitsBtn.type = "button";
    bitsBtn.addEventListener("click", function () {
      zs.bitsOpen = !zs.bitsOpen;
      swBuildZone();
    });
    b1row.appendChild(bitsBtn);
    var newAddr = swEl("button", "sw-btn", "New addresses");
    newAddr.type = "button";
    newAddr.addEventListener("click", function () {
      var fresh = swNewZoneState(zs.def);
      fresh.checks = zs.checks;
      swS.zones[i] = fresh;
      if (swS.done) { swS.done = false; swEls.done.innerHTML = ""; }
      swRenderTabs();
      swBuildZone();
      swRenderFoot();
      toast("Fresh addresses dealt for " + zs.def.tag);
    });
    b1row.appendChild(newAddr);
    c1.appendChild(b1row);

    var bits = swBuildBits(zs);
    if (zs.bitsOpen) bits.classList.add("show");
    bits.id = "sw_z" + i + "_bits";
    c1.appendChild(bits);

    var hint = swEl("p", "sw-hint" + (zs.hint1 ? " show" : ""));
    hint.innerHTML = "<b>Method, not answers.</b> Write the address and the mask in binary, AND them for the network. " +
      "The broadcast is the network with every host bit set to 1. Usable hosts are 2^(host bits) minus 2. " +
      "First usable is network plus one; last usable is broadcast minus one.";
    c1.appendChild(hint);
    w.appendChild(c1);

    /* ---- task 2 ---- */
    var c2 = swEl("div", "sw-card" + (zs.t2ok ? " done" : ""));
    var q2 = swEl("p", "sw-q");
    q2.innerHTML = "2. Carve the subnet. The base block is <b>" + zs.def.base + "/" + zs.def.baseP + "</b> and this zone needs <b>" + zs.def.need + " hosts</b>.";
    c2.appendChild(q2);
    var n2 = swEl("p", "sw-note", "Pick the smallest prefix that still fits, plant the subnet on an aligned boundary inside the base block, and put the gateway on any usable host. Convention parks the gateway on the first usable address.");
    c2.appendChild(n2);

    var f2 = swEl("div", "sw-fields");
    var fldP = swEl("div", "sw-fld");
    var labP = document.createElement("label");
    labP.textContent = "Prefix length";
    labP.setAttribute("for", "sw_z" + i + "_prefix");
    var sel = document.createElement("select");
    sel.id = "sw_z" + i + "_prefix";
    sel.disabled = zs.t2ok;
    var opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Choose";
    sel.appendChild(opt0);
    for (var pp = 24; pp <= 30; pp++) {
      var o = document.createElement("option");
      o.value = String(pp);
      o.textContent = "/" + pp + " (" + swUsable(pp) + " usable)";
      sel.appendChild(o);
    }
    sel.value = zs.a2.prefix || "";
    (function (el) {
      el.addEventListener("change", function () { zs.a2.prefix = el.value; });
    })(sel);
    var msgP = swEl("p", "sw-fmsg");
    msgP.setAttribute("data-swmsg", "prefix");
    msgP.setAttribute("aria-live", "polite");
    labP.appendChild(sel);
    fldP.appendChild(labP);
    fldP.appendChild(msgP);
    f2.appendChild(fldP);

    [["subnet", "Subnet network address"], ["gw", "Gateway address"]].forEach(function (pair) {
      var fld = swEl("div", "sw-fld");
      var lab = document.createElement("label");
      lab.textContent = pair[1];
      lab.setAttribute("for", "sw_z" + i + "_" + pair[0]);
      var inp = document.createElement("input");
      inp.id = "sw_z" + i + "_" + pair[0];
      inp.type = "text";
      inp.setAttribute("inputmode", "decimal");
      inp.setAttribute("autocomplete", "off");
      inp.setAttribute("spellcheck", "false");
      inp.value = zs.a2[pair[0]] || "";
      inp.disabled = zs.t2ok;
      (function (key, el) {
        el.addEventListener("input", function () { zs.a2[key] = el.value; });
      })(pair[0], inp);
      var msg = swEl("p", "sw-fmsg");
      msg.setAttribute("data-swmsg", pair[0]);
      msg.setAttribute("aria-live", "polite");
      lab.appendChild(inp);
      fld.appendChild(lab);
      fld.appendChild(msg);
      f2.appendChild(fld);
    });
    c2.appendChild(f2);

    var b2row = swEl("div", "sw-btnrow");
    var check2 = swEl("button", "sw-btn primary", "Check the subnet");
    check2.type = "button";
    check2.id = "sw_z" + i + "_check2";
    check2.disabled = zs.t2ok;
    check2.addEventListener("click", function () { swOnCheck2(i); });
    b2row.appendChild(check2);
    c2.appendChild(b2row);
    w.appendChild(c2);

    if (zs.t1ok && zs.t2ok) {
      var ban = swEl("div", "sw-banner sw-pop", "ZONE CERTIFIED: " + zs.def.tag + " (" + zs.checks + " checks)");
      w.appendChild(ban);
    }
  }

  function swOnCheck1(i) {
    var zs = swS.zones[i];
    zs.checks++;
    var res = swCheckT1(zs, zs.a1);
    var card = swEls.zone;
    SW_T1_FIELDS.forEach(function (f) { swFieldMsg(card, f.key, res[f.key]); });
    if (res.all && !zs.t1ok) {
      zs.t1ok = true;
      toast("Task 1 correct: " + zs.def.tag);
      if (zs.t2ok) swZoneCertified(i);
      else { swRenderTabs(); swBuildZone(); }
    } else if (!res.all) {
      var hint = card.querySelector(".sw-hint");
      if (hint) hint.classList.add("show");
      zs.hint1 = true;
      swRenderTabs();
    }
  }

  function swOnCheck2(i) {
    var zs = swS.zones[i];
    zs.checks++;
    var res = swCheckT2(zs, zs.a2);
    var card = swEls.zone;
    ["prefix", "subnet", "gw"].forEach(function (k) { swFieldMsg(card, k, res[k]); });
    if (res.all && !zs.t2ok) {
      zs.t2ok = true;
      toast("Subnet correct: " + zs.def.tag);
      if (zs.t1ok) swZoneCertified(i);
      else { swRenderTabs(); swBuildZone(); }
    } else {
      swRenderTabs();
    }
  }

  function swZoneCertified(i) {
    swRenderTabs();
    swBuildZone();
    var n = swCertified();
    swRenderFoot();
    if (n === swS.zones.length && !swS.done) {
      swS.done = true;
      swRenderDone();
      toast("Shop network certified");
    }
  }

  /* ---------------- tabs, done, foot ---------------- */

  function swRenderTabs() {
    var w = swEls.tabs;
    w.innerHTML = "";
    swS.zones.forEach(function (zs, i) {
      var b = swEl("button", "sw-tab");
      b.type = "button";
      b.id = "sw_tab_" + i;
      b.setAttribute("aria-selected", i === swS.tab ? "true" : "false");
      var tag = swEl("span", "sw-tag", "ZONE " + (i + 1) + " OF 3");
      var nm = swEl("span", null, zs.def.tag);
      var st = swEl("span", "sw-st " + (zs.t1ok && zs.t2ok ? "done" : (zs.t1ok || zs.t2ok ? "part" : "todo")),
        zs.t1ok && zs.t2ok ? "CERTIFIED" : (zs.t1ok || zs.t2ok ? "HALF DONE" : "OPEN"));
      b.appendChild(tag);
      b.appendChild(nm);
      b.appendChild(st);
      (function (idx) {
        b.addEventListener("click", function () {
          swS.tab = idx;
          swRenderTabs();
          swBuildZone();
        });
      })(i);
      w.appendChild(b);
    });
  }

  function swRenderDone() {
    var w = swEls.done;
    w.innerHTML = "";
    var d = swEl("div", "sw-done sw-pop");
    d.appendChild(swEl("h4", null, "Shop network certified"));
    var p = swEl("p");
    p.innerHTML = "All three zones address cleanly: <b>zero addressing errors</b> across reads and carves. " +
      "The record below is the proof the wiring closet gets.";
    d.appendChild(p);
    swS.zones.forEach(function (zs) {
      var z = swEl("p", "sw-zline");
      z.innerHTML = "<b>" + zs.def.tag + "</b> " + swInt2ip(zs.t1.ip) + "/" + zs.t1.p +
        " read, " + zs.a2.subnet + "/" + zs.a2.prefix + " carved, gateway " + zs.a2.gw +
        " (" + zs.checks + " checks)";
      d.appendChild(z);
    });
    w.appendChild(d);
  }

  function swDownloadCert() {
    var lines = [];
    lines.push("THE PROVING GROUND: THE SWITCH ROOM");
    lines.push("OLD IRON bench network certification record");
    lines.push("issued: " + new Date().toISOString());
    lines.push("");
    swS.zones.forEach(function (zs, i) {
      var r1 = swCheckT1(zs, zs.a1).exp;
      lines.push("ZONE " + (i + 1) + ": " + zs.def.tag);
      lines.push("  address read: " + swInt2ip(zs.t1.ip) + "/" + zs.t1.p);
      lines.push("  network: " + r1.net + "  broadcast: " + r1.bcast);
      lines.push("  usable: " + r1.hosts + "  first: " + r1.first + "  last: " + r1.last);
      lines.push("  subnet carved: " + zs.a2.subnet + "/" + zs.a2.prefix + " from " + zs.def.base + "/" + zs.def.baseP);
      lines.push("  gateway: " + zs.a2.gw + "  (hosts needed: " + zs.def.need + ")");
      lines.push("  checks used: " + zs.checks);
      lines.push("");
    });
    lines.push("verdict: SHOP NETWORK CERTIFIED, zero addressing errors");
    var blob = new Blob([lines.join("\n")], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = "switch-room-certification.txt";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      (window.URL || window.webkitURL).revokeObjectURL(a.href);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 4000);
    toast("Certification record downloaded");
  }

  function swRenderFoot() {
    var w = swEls.foot;
    w.innerHTML = "";
    var p = swEl("span", "sw-progress");
    var b = swEl("b", null, swCertified() + " of 3");
    p.appendChild(b);
    p.appendChild(swEl("span", null, " zones certified"));
    w.appendChild(p);
    var cert = swEl("button", "sw-btn", "Download the certification record");
    cert.type = "button";
    cert.setAttribute("data-sw", "cert");
    cert.disabled = swCertified() < 3;
    cert.addEventListener("click", swDownloadCert);
    w.appendChild(cert);
    var close = swEl("button", "sw-btn", "Close bench");
    close.type = "button";
    close.setAttribute("data-sw", "close");
    close.addEventListener("click", function () {
      document.getElementById("swOverlay").classList.remove("open");
    });
    w.appendChild(close);
  }

  /* ---------------- build ---------------- */

  function swBuild() {
    var box = document.querySelector(".dossier .actions");
    if (!box || document.getElementById("swBtn")) return;

    var st = document.createElement("style");
    st.textContent = SW_CSS.join("\n");
    document.head.appendChild(st);

    var b = document.createElement("button");
    b.id = "swBtn";
    b.className = "secondary";
    b.textContent = "Run the Switch Room";
    b.addEventListener("click", function () {
      document.getElementById("swOverlay").classList.add("open");
    });
    box.appendChild(b);

    var ov = document.createElement("div");
    ov.className = "sw-overlay";
    ov.id = "swOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "The Switch Room");

    var panel = document.createElement("div");
    panel.className = "sw-panel";
    panel.appendChild(swEl("h3", null, "The Switch Room"));
    panel.appendChild(swEl("p", "sw-spec", "CIDR MATH \u00B7 3 ZONES \u00B7 BINARY PROOF"));

    var sub = swEl("p", "sw-sub");
    sub.innerHTML = "The <b>OLD IRON</b> refurb shop is wiring three network zones and the switch will not forgive a bad address. " +
      "Every IPv4 address is 32 bits: the prefix length says how many belong to the network, the rest name the hosts. " +
      "For each zone, <b>read the address</b> (network, broadcast, usable hosts, first and last usable), then <b>carve the subnet</b> " +
      "from the base block and place the gateway. Certify all three zones with zero addressing errors.";
    panel.appendChild(sub);

    swEls.tabs = swEl("div", "sw-tabs");
    panel.appendChild(swEls.tabs);

    swEls.zone = swEl("div", null);
    panel.appendChild(swEls.zone);

    swEls.done = swEl("div", null);
    panel.appendChild(swEls.done);

    swEls.foot = swEl("div", "sw-foot");
    panel.appendChild(swEls.foot);

    ov.appendChild(panel);
    document.body.appendChild(ov);

    swS = swNewState();
    swRenderTabs();
    swBuildZone();
    swRenderFoot();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", swBuild);
    } else {
      swBuild();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      SW: {
        parseIP: swParseIP, int2ip: swInt2ip, mask: swMask,
        net: swNet, bcast: swBcast, usable: swUsable,
        first: swFirst, last: swLast, bin8: swBin8,
        genT1: swGenT1, zones: function () { return swS ? swS.zones : null; },
        checkT1: swCheckT1, checkT2: swCheckT2,
        newState: swNewState, newZoneState: swNewZoneState,
        certified: function () { return swS ? swCertified() : -1; }
      }
    });
  }

})();
/* ============================================================
   THE STATIC ROOM
   Old Iron bench 24: ESD-safe handling qualification for the
   refurb line. A real triboelectric charge model (120 pF human
   body capacitance, charge rates per flooring) and RC bleed
   physics (V = V0 e^-t/RC) under the hood. The player tests the
   wrist strap at the station tester, walks to the parts bin on
   carpet or tile, reclips, waits for the meter to fall below the
   board's HBM rating, and only then touches the board. Three
   boards, two spare straps, two ESD kills fails the bench.
   Self-contained, appended at the end of features.js.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- pure physics core (no DOM) ---------------- */

  var SR_C = 120e-12;            /* human body capacitance, farads */
  var SR_MAT_R = 10e9;           /* dissipative shoe plus mat path, ohms: tau 1.2 s */
  var SR_PASS_R = 10e6;          /* tester: PASS below this */
  var SR_MARG_R = 100e9;         /* tester: MARGINAL below this */

  var SR_WALKS = {
    carpet: { rate: 2000, secs: 8,  label: "carpet" },
    tile:   { rate: 120,  secs: 14, label: "tile" }
  };

  var SR_STRAPS = {
    GOOD:  { r: 1e6,      label: "GOOD"  },
    DIRTY: { r: 50e9,     label: "DIRTY" },
    DEAD:  { r: Infinity, label: "DEAD"  }
  };

  var SR_BOARDS = [
    { tag: "BOARD A", name: "486 ISA POST card", rating: 2000, strap: "GOOD",
      blurb: "A logic-heavy POST card with protection diodes on every pin. Rated 2000 V HBM. Your strap tests good, so this is the warmup." },
    { tag: "BOARD B", name: "Pentium II slot cartridge", rating: 1000, strap: "DIRTY",
      blurb: "A Slot 1 cartridge, edge connector exposed. Rated 1000 V HBM. The strap in the drawer tests marginal: slow bleed, or swap it." },
    { tag: "BOARD C", name: "NE2000 clone (unprotected CMOS)", rating: 500, strap: "DEAD",
      blurb: "An unprotected CMOS network card, the most fragile thing on the line. Rated 500 V HBM. The strap is dead: swap it from the drawer, or route every discharge through the grounded mat." }
  ];

  var SR_KILL_PINS = ["address bus", "data bus", "reset line", "IRQ line"];

  function srCharge(v0, rate, secs) {
    return v0 + rate * secs;
  }

  function srBleed(v0, r, secs) {
    if (!isFinite(r)) return v0;
    if (secs <= 0 || v0 <= 0) return v0;
    return v0 * Math.exp(-secs / (r * SR_C));
  }

  function srTau(r) {
    return isFinite(r) ? r * SR_C : Infinity;
  }

  function srTester(r) {
    if (!isFinite(r) || r >= SR_MARG_R) return { verdict: "FAIL", cls: "bad" };
    if (r >= SR_PASS_R) return { verdict: "MARGINAL", cls: "warn" };
    return { verdict: "PASS", cls: "good" };
  }

  function srBand(v, rating) {
    if (v >= rating) return { label: "DANGER: at or above the board rating", cls: "bad" };
    if (v >= rating / 2) return { label: "CAUTION: within half of the board rating", cls: "warn" };
    return { label: "SAFE: well below the board rating", cls: "good" };
  }

  function srTouch(v, rating) {
    return v < rating;
  }

  function srEnergyMJ(v) {
    return 0.5 * SR_C * v * v * 1000;
  }

  function srFmtV(v) {
    return Math.round(v).toLocaleString("en-US") + " V";
  }

  function srFmtR(r) {
    if (!isFinite(r)) return "open circuit";
    if (r >= 1e9) return (r / 1e9).toFixed(1) + " GΩ";
    if (r >= 1e6) return (r / 1e6).toFixed(1) + " MΩ";
    return Math.round(r / 1e3) + " kΩ";
  }

  /* ---------------- state ---------------- */

  function srNewBoardState(def) {
    return {
      def: def,
      strap: def.strap,
      strapKnown: false,
      clipped: true,
      loc: "bench",
      v: 120,
      certified: false,
      certV: null,
      certR: null,
      log: ["Shift start: body at " + srFmtV(120) + " (ambient). Clip the strap story short: walk, reclip, wait, touch."]
    };
  }

  function srNewState() {
    return {
      boards: SR_BOARDS.map(srNewBoardState),
      active: 0,
      spares: 2,
      kills: 0,
      failed: false,
      done: false
    };
  }

  function srCertified(s) {
    var n = 0, i;
    for (i = 0; i < s.boards.length; i++) if (s.boards[i].certified) n++;
    return n;
  }

  function srBleedR(bs) {
    if (bs.loc === "bench" && bs.clipped) return SR_STRAPS[bs.strap].r;
    if (bs.loc === "mat") return SR_MAT_R;
    return Infinity;
  }

  function srLog(bs, msg) {
    bs.log.push(msg);
    if (bs.log.length > 60) bs.log.shift();
  }

  /* ---------------- actions (pure, operate on state) ---------------- */

  function srActTest(s, bi) {
    var bs = s.boards[bi];
    if (bs.certified || s.failed) return null;
    bs.strapKnown = true;
    var r = SR_STRAPS[bs.strap].r;
    var t = srTester(r);
    srLog(bs, "Strap tester: " + bs.strap + " strap, " + srFmtR(r) + ", " + t.verdict + " (shop standard: PASS under 10 MΩ, MARGINAL to 100 GΩ, FAIL at open).");
    return t;
  }

  function srActSwap(s, bi) {
    var bs = s.boards[bi];
    if (bs.certified || s.failed) return null;
    if (s.spares <= 0) return { ok: false, msg: "The drawer is empty. No spare straps left." };
    s.spares--;
    bs.strap = "GOOD";
    bs.strapKnown = false;
    bs.clipped = false;
    srLog(bs, "Swapped in a fresh strap from the drawer (" + s.spares + " left). It still needs a tester check, and the clip is off until you reclip at the bench.");
    return { ok: true };
  }

  function srActWalk(s, bi, floor, dest) {
    var bs = s.boards[bi];
    if (bs.certified || s.failed) return null;
    var w = SR_WALKS[floor];
    var v0 = bs.v;
    bs.v = srCharge(bs.v, w.rate, w.secs);
    bs.clipped = false;
    bs.loc = dest;
    srLog(bs, "Walked " + w.secs + " s on " + w.label + " to the " + dest + ": +" +
      Math.round(w.rate * w.secs).toLocaleString("en-US") + " V. Body now " + srFmtV(bs.v) +
      " (strap unclipped while walking, no bleed).");
    return { v0: v0, v1: bs.v };
  }

  function srActReclip(s, bi) {
    var bs = s.boards[bi];
    if (bs.certified || s.failed || bs.loc !== "bench") return null;
    bs.clipped = true;
    var tau = srTau(SR_STRAPS[bs.strap].r);
    srLog(bs, "Reclipped the strap at the bench. Bleed time constant now " +
      (isFinite(tau) ? (tau < 0.01 ? "under a millisecond" : tau.toFixed(1) + " s") : "none (open circuit)") + ".");
    return true;
  }

  function srActWait(s, bi, secs) {
    var bs = s.boards[bi];
    if (bs.certified || s.failed) return null;
    var r = srBleedR(bs);
    var v0 = bs.v;
    bs.v = srBleed(bs.v, r, secs);
    var path = bs.loc === "bench" ? "strap" : (bs.loc === "mat" ? "mat and dissipative shoes" : "no ground path");
    srLog(bs, "Waited " + secs + " s (" + path + "): " + srFmtV(v0) + " to " + srFmtV(bs.v) + ".");
    return { v0: v0, v1: bs.v };
  }

  function srActTouch(s, bi) {
    var bs = s.boards[bi];
    if (bs.certified || s.failed) return null;
    if (!bs.strapKnown) return { ok: false, msg: "Test the strap first. No touches before the tester." };
    if (bs.loc !== "bench" || !bs.clipped) return { ok: false, msg: "Touch the board at the bench, strap clipped." };
    var v = bs.v, rating = bs.def.rating;
    if (srTouch(v, rating)) {
      bs.certified = true;
      bs.certV = v;
      bs.certR = SR_STRAPS[bs.strap].r;
      srLog(bs, "Touched the board at " + srFmtV(v) + ", under the " + rating.toLocaleString("en-US") +
        " V HBM rating. CERTIFIED.");
      if (srCertified(s) === s.boards.length) s.done = true;
      return { ok: true, certified: true, v: v };
    }
    s.kills++;
    var pin = SR_KILL_PINS[(bi + s.kills) % SR_KILL_PINS.length];
    var mj = srEnergyMJ(v);
    var dead = s.kills >= 2;
    srLog(bs, "ESD EVENT: " + srFmtV(v) + " discharged into the " + pin + " (" + mj.toFixed(1) +
      " mJ through 120 pF). Gate-oxide rupture, board scrapped." + (dead ? " Second kill: the bench is FAILED." : " One kill on the record; the replacement board is on the bench."));
    var nb = srNewBoardState(bs.def);
    nb.log = bs.log.slice();
    s.boards[bi] = nb;
    if (dead) s.failed = true;
    return { ok: true, certified: false, event: true, v: v, failed: dead };
  }

  function srActReset(s) {
    var keep = srNewState();
    s.boards = keep.boards; s.active = 0; s.spares = 2; s.kills = 0;
    s.failed = false; s.done = false;
  }

  /* ---------------- view helpers ---------------- */

  function srEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var SR_CSS = [
    ".sr-overlay{position:fixed;inset:0;background:rgba(4,7,7,.94);z-index:90;display:none;overflow-y:auto;padding:18px 12px;}",
    ".sr-overlay.open{display:block;}",
    ".sr-panel{max-width:1020px;margin:0 auto;background:var(--panel);border:1px solid var(--line);padding:20px;}",
    ".sr-panel h3{font-family:var(--font-d);font-size:24px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.02em;color:var(--ember);}",
    ".sr-spec{font-family:var(--font-m);font-size:10.5px;color:var(--dim);letter-spacing:.1em;margin:0 0 10px;}",
    ".sr-sub{color:var(--steel);font-size:12.5px;line-height:1.7;margin:0 0 14px;max-width:72ch;}",
    ".sr-sub b{color:var(--paper);font-weight:600;}",
    ".sr-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 12px;}",
    "@media(max-width:760px){.sr-tabs{grid-template-columns:1fr;}}",
    ".sr-tab{border:1px solid var(--line);background:var(--panel-2);padding:10px 12px;min-height:48px;text-align:left;cursor:pointer;color:var(--paper);font-family:var(--font-d);font-size:13px;}",
    ".sr-tab .sr-tag{font-family:var(--font-m);font-size:10.5px;color:var(--dim);display:block;letter-spacing:.08em;}",
    ".sr-tab .sr-st{font-family:var(--font-m);font-size:10.5px;letter-spacing:.08em;display:block;margin-top:2px;}",
    ".sr-tab[aria-selected=\"true\"]{border-color:var(--ember);}",
    ".sr-st.todo{color:var(--dim);}.sr-st.part{color:var(--ember);}.sr-st.done{color:var(--mint);}.sr-st.dead{color:var(--ember);}",
    ".sr-card{border:1px solid var(--line);background:var(--panel-2);padding:14px;margin:0 0 12px;}",
    ".sr-card.done{border-color:var(--mint);}",
    ".sr-blurb{border:1px dashed var(--line);padding:10px 12px;margin:0 0 12px;font-size:12.5px;line-height:1.7;color:var(--steel);}",
    ".sr-blurb b{color:var(--paper);}",
    ".sr-k{font-family:var(--font-m);font-size:10.5px;color:var(--dim);letter-spacing:.1em;display:block;margin:14px 0 8px;}",
    ".sr-meter{border:1px solid var(--line);background:var(--ink);padding:12px 14px;margin:0 0 12px;}",
    ".sr-meter .sr-v{font-family:var(--font-m);font-size:26px;color:var(--paper);letter-spacing:.02em;}",
    ".sr-meter .sr-band{font-family:var(--font-m);font-size:11px;letter-spacing:.08em;margin-top:4px;display:block;}",
    ".sr-band.good{color:var(--mint);}.sr-band.warn{color:var(--ember);}.sr-band.bad{color:var(--ember);font-weight:700;}",
    ".sr-where{font-family:var(--font-m);font-size:11px;color:var(--dim);letter-spacing:.06em;margin:8px 0 0;}",
    ".sr-where b{color:var(--paper);font-weight:400;}",
    ".sr-btnrow{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 2px;}",
    ".sr-btn{border:1px solid var(--line);background:var(--ink);color:var(--paper);font-family:var(--font-d);font-size:13px;min-height:48px;padding:10px 18px;cursor:pointer;letter-spacing:.04em;}",
    ".sr-btn.primary{background:var(--ember);border-color:var(--ember);color:#0a0a0a;font-weight:700;}",
    ".sr-btn:disabled{opacity:.45;cursor:default;}",
    ".sr-btn:hover:not(:disabled){border-color:var(--ember);}",
    ".sr-btn.primary:hover:not(:disabled){border-color:var(--paper);}",
    ".sr-log{font-family:var(--font-m);font-size:11.5px;color:var(--steel);line-height:1.8;border:1px solid var(--line);background:var(--ink);padding:10px 12px;max-height:180px;overflow-y:auto;margin:10px 0 0;}",
    ".sr-log div{margin:0 0 2px;}",
    ".sr-log .sr-ev{color:var(--ember);}",
    ".sr-banner{border:1px solid var(--mint);color:var(--mint);font-family:var(--font-m);font-size:12px;letter-spacing:.1em;padding:10px 12px;margin:12px 0 0;}",
    ".sr-fail{border:1px solid var(--ember);color:var(--ember);font-family:var(--font-m);font-size:12px;letter-spacing:.1em;padding:10px 12px;margin:12px 0 0;}",
    "@media(prefers-reduced-motion:no-preference){.sr-pop{animation:srpop .2s ease-out;}}",
    "@keyframes srpop{0%{transform:scale(.96);}100%{transform:scale(1);}}",
    ".sr-done{border:1px solid var(--ember);padding:18px;margin:0 0 12px;}",
    ".sr-done h4{font-family:var(--font-d);font-size:18px;color:var(--ember);margin:0 0 8px;text-transform:uppercase;letter-spacing:.03em;}",
    ".sr-done p{color:var(--steel);font-size:12.5px;line-height:1.7;margin:0 0 8px;}",
    ".sr-done p b{color:var(--paper);}",
    ".sr-zline{font-family:var(--font-m);font-size:11.5px;color:var(--steel);margin:0 0 4px;}",
    ".sr-zline b{color:var(--paper);font-weight:400;}",
    ".sr-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0 0;}",
    ".sr-progress{font-family:var(--font-m);font-size:11.5px;color:var(--dim);letter-spacing:.08em;margin-right:auto;}",
    ".sr-progress b{color:var(--paper);font-weight:600;}",
    ".sr-panel button:focus-visible{outline:2px solid var(--ember);outline-offset:2px;}"
  ];

  var srS = null;
  var srEls = {};

  function srBoardStatus(bs) {
    if (bs.certified) return { t: "CERTIFIED", c: "done" };
    if (bs.strapKnown && bs.clipped && bs.v < bs.def.rating) return { t: "READY TO TOUCH", c: "part" };
    if (bs.strapKnown) return { t: "IN PROGRESS", c: "part" };
    return { t: "STRAP UNTESTED", c: "todo" };
  }

  function srRenderTabs() {
    var w = srEls.tabs;
    w.innerHTML = "";
    var i, bs, st;
    for (i = 0; i < srS.boards.length; i++) {
      bs = srS.boards[i];
      st = srBoardStatus(bs);
      var t = srEl("button", "sr-tab", null);
      t.setAttribute("data-sr", "tab");
      t.setAttribute("data-i", String(i));
      t.setAttribute("aria-selected", i === srS.active ? "true" : "false");
      t.appendChild(srEl("span", "sr-tag", bs.def.tag + " · " + bs.def.rating.toLocaleString("en-US") + " V HBM"));
      t.appendChild(srEl("span", null, bs.def.name));
      t.appendChild(srEl("span", "sr-st " + st.c, st.t));
      (function (idx) {
        t.addEventListener("click", function () { srS.active = idx; srRenderAll(); });
      })(i);
      w.appendChild(t);
    }
  }

  function srMeter(bs) {
    var m = srEl("div", "sr-meter", null);
    m.appendChild(srEl("div", "sr-v", srFmtV(bs.v)));
    var band = srBand(bs.v, bs.def.rating);
    m.appendChild(srEl("span", "sr-band " + band.cls, band.label));
    var r = SR_STRAPS[bs.strap].r;
    var tk = bs.strapKnown ? srTester(r) : null;
    m.appendChild(srEl("div", "sr-where",
      "Location: " + bs.loc.toUpperCase() + "  ·  Strap: " +
      (tk ? bs.strap + " " + srFmtR(r) + " (" + tk.verdict + ")" : "UNTESTED") +
      "  ·  Clip: " + (bs.clipped ? "ON" : "OFF") +
      "  ·  Spares in drawer: " + srS.spares + "  ·  Kills on record: " + srS.kills + " of 2"));
    return m;
  }

  function srBtnRow(buttons) {
    var row = srEl("div", "sr-btnrow", null);
    var i;
    for (i = 0; i < buttons.length; i++) {
      var b = srEl("button", "sr-btn" + (buttons[i].primary ? " primary" : ""), buttons[i].label);
      b.type = "button";
      b.setAttribute("data-sr", buttons[i].name);
      if (buttons[i].disabled) b.disabled = true;
      (function (fn) { b.addEventListener("click", fn); })(buttons[i].fn);
      row.appendChild(b);
    }
    return row;
  }

  function srBoardButtons(bs, bi) {
    var out = [];
    if (bs.loc === "bench") {
      out.push({ name: "walk-carpet", label: "Walk to bin (carpet, 8 s)", fn: function () { srActWalk(srS, bi, "carpet", "bin"); srRenderAll(); } });
      out.push({ name: "walk-tile", label: "Walk to bin (tile, 14 s)", fn: function () { srActWalk(srS, bi, "tile", "bin"); srRenderAll(); } });
      out.push({ name: "go-mat", label: "Step onto the discharge mat", fn: function () { bs.loc = "mat"; bs.clipped = false; srLog(bs, "Stepped onto the grounded discharge mat (strap unclipped)."); srRenderAll(); } });
    } else if (bs.loc === "bin") {
      out.push({ name: "back-carpet", label: "Walk back (carpet, 8 s)", fn: function () { srActWalk(srS, bi, "carpet", "bench"); srRenderAll(); } });
      out.push({ name: "back-tile", label: "Walk back (tile, 14 s)", fn: function () { srActWalk(srS, bi, "tile", "bench"); srRenderAll(); } });
      out.push({ name: "bin-mat", label: "Go to the discharge mat", fn: function () { bs.loc = "mat"; srLog(bs, "Walked to the discharge mat."); srRenderAll(); } });
    } else {
      out.push({ name: "mat-bench", label: "Step back to the bench", fn: function () { bs.loc = "bench"; srLog(bs, "Stepped back to the bench."); srRenderAll(); } });
    }
    return out;
  }

  function srBuildBoard() {
    var bi = srS.active, bs = srS.boards[bi];
    var w = srEls.board;
    w.innerHTML = "";
    w.className = bs.certified ? "sr-card done sr-pop" : "sr-card";

    var blurb = srEl("p", "sr-blurb", null);
    blurb.innerHTML = "<b>" + bs.def.tag + ": " + bs.def.name + ".</b> " + bs.def.blurb;
    w.appendChild(blurb);

    w.appendChild(srMeter(bs));

    var k1 = srEl("span", "sr-k", "STEP 1 · STRAP");
    w.appendChild(k1);
    w.appendChild(srBtnRow([
      { name: "test", label: "Test the wrist strap", fn: function () { srActTest(srS, bi); srRenderAll(); } },
      { name: "swap", label: "Swap strap (" + srS.spares + " left)", disabled: srS.spares <= 0, fn: function () {
          var r = srActSwap(srS, bi);
          if (r && !r.ok) { srToast(r.msg); }
          srRenderAll();
        } }
    ]));

    var k2 = srEl("span", "sr-k", "STEP 2 · FETCH THE BOARD");
    w.appendChild(k2);
    w.appendChild(srEl("p", "sr-where", "You are at the " + bs.loc.toUpperCase() + ". Walking unclips the strap: carpet builds 2,000 V/s, tile builds 120 V/s."));
    w.appendChild(srBtnRow(srBoardButtons(bs, bi)));

    var k3 = srEl("span", "sr-k", "STEP 3 · BLEED DOWN AND TOUCH");
    w.appendChild(k3);
    w.appendChild(srBtnRow([
      { name: "reclip", label: "Reclip the strap", disabled: bs.loc !== "bench" || bs.clipped, fn: function () { srActReclip(srS, bi); srRenderAll(); } },
      { name: "wait1", label: "Wait 1 s", fn: function () { srActWait(srS, bi, 1); srRenderAll(); } },
      { name: "wait5", label: "Wait 5 s", fn: function () { srActWait(srS, bi, 5); srRenderAll(); } },
      { name: "touch", label: "Touch the board", primary: true, disabled: !bs.strapKnown, fn: function () {
          var r = srActTouch(srS, bi);
          if (r && !r.ok) { srToast(r.msg); return; }
          if (r && r.event) { srToast("ESD EVENT. The board is scrapped."); }
          srRenderAll();
        } }
    ]));

    var log = srEl("div", "sr-log", null);
    var i;
    for (i = 0; i < bs.log.length; i++) {
      var line = srEl("div", bs.log[i].indexOf("ESD EVENT") === 0 ? "sr-ev" : null, bs.log[i]);
      log.appendChild(line);
    }
    log.scrollTop = log.scrollHeight;
    w.appendChild(log);
  }

  function srToast(msg) {
    if (typeof toast === "function") { toast(msg); return; }
    if (typeof window !== "undefined" && window.__srToast) window.__srToast(msg);
  }

  function srDownloadCert() {
    var lines = [];
    var i, bs;
    lines.push("THE STATIC ROOM · ESD HANDLING CERTIFICATION");
    lines.push("OLD IRON refurb line · human body model 120 pF");
    lines.push("");
    for (i = 0; i < srS.boards.length; i++) {
      bs = srS.boards[i];
      lines.push(bs.def.tag + ": " + bs.def.name);
      lines.push("  HBM rating: " + bs.def.rating + " V");
      lines.push("  Touch voltage: " + Math.round(bs.certV) + " V");
      lines.push("  Strap at touch: " + bs.strap + " " + srFmtR(bs.certR));
      lines.push("  Verdict: CERTIFIED, zero discharge events");
      lines.push("");
    }
    lines.push("Kills on record: " + srS.kills);
    lines.push("Standard: strap PASS under 10 MΩ, MARGINAL 10 MΩ to 100 GΩ, FAIL at open circuit.");
    var blob = new Blob([lines.join("\n")], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = (window.URL || window.webkitURL).createObjectURL(blob);
    a.download = "static-room-certification.txt";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      (window.URL || window.webkitURL).revokeObjectURL(a.href);
      a.remove();
    }, 4000);
    srToast("Certification record downloaded");
  }

  function srRenderFoot() {
    var w = srEls.foot;
    w.innerHTML = "";
    if (srS.failed) {
      w.appendChild(srEl("div", "sr-fail", "BENCH FAILED: two ESD kills. Reset the bench and run it clean."));
      w.appendChild(srBtnRow([
        { name: "reset", label: "Reset the bench", fn: function () { srActReset(srS); srRenderAll(); } }
      ]));
      return;
    }
    var p = srEl("span", "sr-progress", null);
    p.innerHTML = "Certified <b>" + srCertified(srS) + " of 3</b> boards · kills <b>" + srS.kills + "</b> of 2 allowed";
    w.appendChild(p);
    var cert = srEl("button", "sr-btn", "Download the certification record");
    cert.type = "button";
    cert.setAttribute("data-sr", "cert");
    cert.disabled = srCertified(srS) < 3;
    cert.addEventListener("click", srDownloadCert);
    w.appendChild(cert);
    var close = srEl("button", "sr-btn", "Close bench");
    close.type = "button";
    close.setAttribute("data-sr", "close");
    close.addEventListener("click", function () {
      document.getElementById("srOverlay").classList.remove("open");
    });
    w.appendChild(close);
  }

  function srRenderDone() {
    var w = srEls.done;
    w.innerHTML = "";
    if (!srS.done) return;
    var d = srEl("div", "sr-done sr-pop", null);
    d.appendChild(srEl("h4", null, "Line certified"));
    var p = srEl("p", null, null);
    p.innerHTML = "All three boards handled with <b>zero discharge events</b>. You read the strap, respected the flooring, and let the physics do the work. The certification record is ready below.";
    d.appendChild(p);
    var i, bs;
    for (i = 0; i < srS.boards.length; i++) {
      bs = srS.boards[i];
      var z = srEl("p", "sr-zline", null);
      z.innerHTML = "<b>" + bs.def.tag + ":</b> touched at " + srFmtV(bs.certV) + " against a " +
        bs.def.rating.toLocaleString("en-US") + " V rating, strap " + bs.strap + " " + srFmtR(bs.certR);
      d.appendChild(z);
    }
    w.appendChild(d);
  }

  function srRenderAll() {
    srRenderTabs();
    srBuildBoard();
    srRenderDone();
    srRenderFoot();
  }

  /* ---------------- build ---------------- */

  function srBuild() {
    var box = document.querySelector(".dossier .actions");
    if (!box || document.getElementById("srBtn")) return;

    var st = document.createElement("style");
    st.textContent = SR_CSS.join("\n");
    document.head.appendChild(st);

    var b = document.createElement("button");
    b.id = "srBtn";
    b.className = "secondary";
    b.textContent = "Run the Static Room";
    b.addEventListener("click", function () {
      document.getElementById("srOverlay").classList.add("open");
    });
    box.appendChild(b);

    var ov = document.createElement("div");
    ov.className = "sr-overlay";
    ov.id = "srOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "The Static Room");

    var panel = document.createElement("div");
    panel.className = "sr-panel";
    panel.appendChild(srEl("h3", null, "The Static Room"));
    panel.appendChild(srEl("p", "sr-spec", "ESD PHYSICS · 3 BOARDS · HBM"));

    var sub = srEl("p", "sr-sub", null);
    sub.innerHTML = "The <b>OLD IRON</b> refurb line handles boards that die if you look at them wrong, electrically speaking. " +
      "Your body is a 120 pF capacitor: walking on carpet charges it at 2,000 volts per second, tile at 120. " +
      "A good wrist strap bleeds that charge in under a millisecond; a dirty one takes seconds; a dead one never does. " +
      "For each board, <b>test the strap</b>, <b>walk to the bin</b>, <b>reclip and wait</b> until the meter clears the board's HBM rating, " +
      "then <b>touch</b>. Two discharge events fail the bench.";
    panel.appendChild(sub);

    srEls.tabs = srEl("div", "sr-tabs");
    panel.appendChild(srEls.tabs);

    srEls.board = srEl("div", null);
    panel.appendChild(srEls.board);

    srEls.done = srEl("div", null);
    panel.appendChild(srEls.done);

    srEls.foot = srEl("div", "sr-foot");
    panel.appendChild(srEls.foot);

    ov.appendChild(panel);
    document.body.appendChild(ov);

    srS = srNewState();
    srRenderAll();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", srBuild);
    } else {
      srBuild();
    }
  }

  /* node test hook: harmless in the browser */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      SR: {
        C: SR_C, MAT_R: SR_MAT_R, WALKS: SR_WALKS, STRAPS: SR_STRAPS, BOARDS: SR_BOARDS,
        charge: srCharge, bleed: srBleed, tau: srTau, tester: srTester, band: srBand,
        touch: srTouch, energyMJ: srEnergyMJ,
        newState: srNewState, newBoardState: srNewBoardState, certified: srCertified,
        bleedR: srBleedR, test: srActTest, swap: srActSwap, walk: srActWalk,
        reclip: srActReclip, wait: srActWait, touchAct: srActTouch, reset: srActReset
      }
    });
  }

})();
