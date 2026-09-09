/* RISC-V Playground core: RV32I assembler + interpreter. No DOM, pure logic.
   Shared between node tests (module.exports) and the browser page (globals). */
"use strict";

var RV_ABI = {zero:0,ra:1,sp:2,gp:3,tp:4,t0:5,t1:6,t2:7,s0:8,fp:8,s1:9,a0:10,a1:11,a2:12,a3:13,a4:14,a5:15,a6:16,a7:17,s2:18,s3:19,s4:20,s5:21,s6:22,s7:23,s8:24,s9:25,s10:26,s11:27,t3:28,t4:29,t5:30,t6:31};
var RV_REGNAMES = ["zero","ra","sp","gp","tp","t0","t1","t2","s0","s1","a0","a1","a2","a3","a4","a5","a6","a7","s2","s3","s4","s5","s6","s7","s8","s9","s10","s11","t3","t4","t5","t6"];

function rvParseReg(s, line) {
  s = String(s).trim().toLowerCase();
  var n;
  if (s.charAt(0) === "x") n = parseInt(s.slice(1), 10);
  else if (RV_ABI.hasOwnProperty(s)) n = RV_ABI[s];
  else throw { line: line, msg: "bad register '" + s + "'" };
  if (isNaN(n) || n < 0 || n > 31 || (s.charAt(0) === "x" && !/^\d+$/.test(s.slice(1)))) throw { line: line, msg: "bad register '" + s + "'" };
  return n;
}
function rvParseImm(s, line) {
  s = String(s).trim().toLowerCase();
  var neg = false;
  if (s.charAt(0) === "-") { neg = true; s = s.slice(1); }
  else if (s.charAt(0) === "+") s = s.slice(1);
  var v = (s.indexOf("0x") === 0) ? parseInt(s, 16) : parseInt(s, 10);
  if (isNaN(v)) throw { line: line, msg: "bad number '" + s + "'" };
  return neg ? -v : v;
}
function rvParseMem(s, line) {
  var m = String(s).trim().match(/^(-?[^\s\(]*)\(\s*([^\)\s]+)\s*\)$/);
  if (!m) throw { line: line, msg: "bad memory operand '" + s + "' (want off(reg))" };
  return { off: m[1] === "" ? 0 : rvParseImm(m[1], line), rs: rvParseReg(m[2], line) };
}

var RV_OPS = {
  addi:{op:0x13,f3:0,ty:"I"}, slti:{op:0x13,f3:2,ty:"I"}, sltiu:{op:0x13,f3:3,ty:"I"},
  xori:{op:0x13,f3:4,ty:"I"}, ori:{op:0x13,f3:6,ty:"I"}, andi:{op:0x13,f3:7,ty:"I"},
  slli:{op:0x13,f3:1,ty:"Is"}, srli:{op:0x13,f3:5,ty:"Is",f7:0}, srai:{op:0x13,f3:5,ty:"Is",f7:32},
  add:{op:0x33,f3:0,f7:0,ty:"R"}, sub:{op:0x33,f3:0,f7:32,ty:"R"},
  sll:{op:0x33,f3:1,f7:0,ty:"R"}, slt:{op:0x33,f3:2,f7:0,ty:"R"}, sltu:{op:0x33,f3:3,f7:0,ty:"R"},
  xor:{op:0x33,f3:4,f7:0,ty:"R"}, srl:{op:0x33,f3:5,f7:0,ty:"R"}, sra:{op:0x33,f3:5,f7:32,ty:"R"},
  or:{op:0x33,f3:6,f7:0,ty:"R"}, and:{op:0x33,f3:7,f7:0,ty:"R"},
  lb:{op:0x03,f3:0,ty:"L"}, lh:{op:0x03,f3:1,ty:"L"}, lw:{op:0x03,f3:2,ty:"L"},
  lbu:{op:0x03,f3:4,ty:"L"}, lhu:{op:0x03,f3:5,ty:"L"},
  sb:{op:0x23,f3:0,ty:"S"}, sh:{op:0x23,f3:1,ty:"S"}, sw:{op:0x23,f3:2,ty:"S"},
  beq:{op:0x63,f3:0,ty:"B"}, bne:{op:0x63,f3:1,ty:"B"}, blt:{op:0x63,f3:4,ty:"B"},
  bge:{op:0x63,f3:5,ty:"B"}, bltu:{op:0x63,f3:6,ty:"B"}, bgeu:{op:0x63,f3:7,ty:"B"},
  jal:{op:0x6F,ty:"J"}, jalr:{op:0x67,f3:0,ty:"Jr"},
  lui:{op:0x37,ty:"U"}, auipc:{op:0x17,ty:"U"},
  ecall:{op:0x73,ty:"E"}
};

function rvEncR(f7, rs2, rs1, f3, rd, op) { return (((f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0); }
function rvEncI(imm, rs1, f3, rd, op) { return ((((imm & 0xFFF) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0); }
function rvEncS(imm, rs2, rs1, f3, op) {
  imm &= 0xFFF;
  return (((((imm >> 5) & 0x7F) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((imm & 0x1F) << 7) | op) >>> 0);
}
function rvEncB(off, rs2, rs1, f3, op) {
  var w = ((((off >> 12) & 1) << 31) | (((off >> 11) & 1) << 7) | (((off >> 5) & 0x3F) << 25) | (((off >> 1) & 0xF) << 8));
  return ((w | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | op) >>> 0);
}
function rvEncU(imm20, rd, op) { return ((((imm20 & 0xFFFFF) << 12) | (rd << 7) | op) >>> 0); }
function rvEncJ(off, rd, op) {
  var w = ((((off >> 20) & 1) << 31) | (((off >> 12) & 0xFF) << 12) | (((off >> 11) & 1) << 20) | (((off >> 1) & 0x3FF) << 21));
  return ((w | (rd << 7) | op) >>> 0);
}
function rvRange(v, lo, hi, what, line) {
  if (v < lo || v > hi) throw { line: line, msg: what + " " + v + " out of range [" + lo + "," + hi + "]" };
}
function rvAligned(v, what, line) {
  if (v & 1) throw { line: line, msg: what + " target misaligned (offset " + v + ")" };
}

function rvExpandPseudo(op, args, ln) {
  if (op === "nop") return [["addi", ["x0", "x0", "0"]]];
  if (op === "mv" && args.length === 2) return [["addi", [args[0], args[1], "0"]]];
  if (op === "ret" && args.length === 0) return [["jalr", ["x0", "0(x1)"]]];
  if (op === "j" && args.length === 1) return [["jal", ["x0", args[0]]]];
  if (op === "li" && args.length === 2) {
    var v = rvParseImm(args[1], ln);
    if (v >= -2048 && v <= 2047) return [["addi", [args[0], "x0", String(v)]]];
    var hi = (v + 0x800) >> 12, lo = v - (hi << 12);
    return [["lui", [args[0], String(hi)]], ["addi", [args[0], args[0], String(lo)]]];
  }
  return [[op, args]];
}

function rvEncode(op, args, addr, labels, line) {
  var d = RV_OPS[op];
  if (!d) throw { line: line, msg: "unknown instruction '" + op + "'" };
  function need(n) { if (args.length !== n) throw { line: line, msg: op + " wants " + n + " operands, got " + args.length }; }
  switch (d.ty) {
    case "R": {
      need(3);
      return rvEncR(d.f7, rvParseReg(args[2], line), rvParseReg(args[1], line), d.f3, rvParseReg(args[0], line), d.op);
    }
    case "I": {
      need(3);
      var im = rvParseImm(args[2], line); rvRange(im, -2048, 2047, "immediate", line);
      return rvEncI(im, rvParseReg(args[1], line), d.f3, rvParseReg(args[0], line), d.op);
    }
    case "Is": {
      need(3);
      var sh = rvParseImm(args[2], line); rvRange(sh, 0, 31, "shift amount", line);
      return rvEncR(d.f7, sh, rvParseReg(args[1], line), d.f3, rvParseReg(args[0], line), d.op);
    }
    case "L": {
      need(2);
      var lm = rvParseMem(args[1], line); rvRange(lm.off, -2048, 2047, "offset", line);
      return rvEncI(lm.off, lm.rs, d.f3, rvParseReg(args[0], line), d.op);
    }
    case "S": {
      need(2);
      var sm = rvParseMem(args[1], line); rvRange(sm.off, -2048, 2047, "offset", line);
      return rvEncS(sm.off, rvParseReg(args[0], line), sm.rs, d.f3, d.op);
    }
    case "B": {
      need(3);
      var tgt = String(args[2]).toLowerCase();
      if (!labels.hasOwnProperty(tgt)) throw { line: line, msg: "unknown label '" + args[2] + "'" };
      var off = labels[tgt] - addr;
      rvRange(off, -4096, 4094, "branch offset", line); rvAligned(off, "branch", line);
      return rvEncB(off, rvParseReg(args[1], line), rvParseReg(args[0], line), d.f3, d.op);
    }
    case "J": {
      need(2);
      var jt = String(args[1]).toLowerCase();
      if (!labels.hasOwnProperty(jt)) throw { line: line, msg: "unknown label '" + args[1] + "'" };
      var joff = labels[jt] - addr;
      rvRange(joff, -1048576, 1048574, "jump offset", line); rvAligned(joff, "jump", line);
      return rvEncJ(joff, rvParseReg(args[0], line), d.op);
    }
    case "Jr": {
      need(2);
      var jm = rvParseMem(args[1], line); rvRange(jm.off, -2048, 2047, "offset", line);
      return rvEncI(jm.off, jm.rs, d.f3, rvParseReg(args[0], line), d.op);
    }
    case "U": {
      need(2);
      var u = rvParseImm(args[1], line);
      return rvEncU(u, rvParseReg(args[0], line), d.op);
    }
    case "E": {
      if (args.length) throw { line: line, msg: "ecall takes no operands" };
      return 0x73;
    }
  }
  throw { line: line, msg: "cannot encode '" + op + "'" };
}

function rvUnescape(s, line) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === "\\") {
      i++;
      if (i >= s.length) throw { line: line, msg: "dangling backslash at end of string" };
      var e = s.charAt(i);
      if (e === "n") out.push(10);
      else if (e === "t") out.push(9);
      else if (e === "r") out.push(13);
      else if (e === "0") out.push(0);
      else if (e === "\\") out.push(92);
      else if (e === '"') out.push(34);
      else throw { line: line, msg: "bad escape '\\" + e + "' (use \\n \\t \\r \\0 \\\\ \\\")" };
    } else out.push(s.charCodeAt(i) & 0xFF);
  }
  return out;
}

function rvAssemble(src) {
  var DATA_BASE = 0x800, STACK_TOP = 0x1000;
  var raw = String(src).split("\n");
  var items = [];
  var labels = {};
  var seg = "text";
  var addrs = { text: 0, data: DATA_BASE };
  function curAddr() { return addrs[seg]; }
  function adv(n, ln) {
    addrs[seg] += n;
    if (seg === "text" && addrs.text >= DATA_BASE)
      throw { line: ln, msg: "code grew into the data segment (0x800); keep programs under ~500 instructions" };
    if (seg === "data" && addrs.data > STACK_TOP)
      throw { line: ln, msg: "data grew into the stack; use less .word/.string/.zero" };
  }
  for (var i = 0; i < raw.length; i++) {
    var ln = i + 1;
    var t = raw[i].replace(/#.*$/, "").trim();
    if (!t) continue;
    var m = t.match(/^([A-Za-z_][\w.]*)\s*:\s*(.*)$/);
    var label = null;
    if (m) { label = m[1].toLowerCase(); t = m[2].trim(); }
    if (label) {
      if (labels.hasOwnProperty(label)) throw { line: ln, msg: "duplicate label '" + label + "'" };
      labels[label] = curAddr();
    }
    if (!t) continue;
    if (t.charAt(0) === ".") {
      var dm = t.match(/^\.(\w+)\s*(.*)$/);
      if (dm && dm[1] === "text") { seg = "text"; continue; }
      if (dm && dm[1] === "data") { seg = "data"; continue; }
      if (dm && dm[1] === "word") {
        var vals = dm[2].split(",").map(function (s) { return rvParseImm(s, ln); });
        if (!vals.length) throw { line: ln, msg: ".word needs values" };
        items.push({ line: ln, op: ".word", args: vals, addr: curAddr(), src: raw[i].trim() });
        adv(4 * vals.length, ln);
      } else if (dm && dm[1] === "string") {
        var sm = dm[2].match(/^\s*"((?:[^"\\]|\\.)*)"\s*$/);
        if (!sm) throw { line: ln, msg: ".string needs a quoted string, like .string \"hi\"" };
        var sbytes = rvUnescape(sm[1], ln);
        sbytes.push(0);
        items.push({ line: ln, op: ".bytes", bytes: sbytes, addr: curAddr(), src: raw[i].trim() });
        adv((sbytes.length + 3) & ~3, ln);
      } else if (dm && dm[1] === "zero") {
        var zc = rvParseImm(dm[2], ln);
        if (zc < 0 || zc > 4096) throw { line: ln, msg: ".zero count out of range" };
        var zb = [];
        for (var zi = 0; zi < zc; zi++) zb.push(0);
        items.push({ line: ln, op: ".bytes", bytes: zb, addr: curAddr(), src: raw[i].trim() });
        adv((zc + 3) & ~3, ln);
      } else throw { line: ln, msg: "unsupported directive '" + t + "' (try .text .data .word .string .zero)" };
      continue;
    }
    var sp = t.search(/\s/);
    var op = (sp < 0 ? t : t.slice(0, sp)).toLowerCase();
    var rest = sp < 0 ? "" : t.slice(sp).trim();
    var args = rest ? rest.split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s.length; }) : [];
    if (op === "la") {
      if (args.length !== 2) throw { line: ln, msg: "la wants 2 operands: la rd, label" };
      items.push({ line: ln, op: "la", args: args, addr: curAddr(), src: raw[i].trim() });
      adv(8, ln);
      continue;
    }
    var expanded = rvExpandPseudo(op, args, ln);
    for (var k = 0; k < expanded.length; k++) {
      items.push({ line: ln, op: expanded[k][0], args: expanded[k][1], addr: curAddr(), src: raw[i].trim() });
      adv(4, ln);
    }
  }
  /* second pass: expand la rd, label now that every label address is known */
  for (var fi = 0; fi < items.length; fi++) {
    var lit = items[fi];
    if (lit.op !== "la") continue;
    var ltgt = String(lit.args[1]).toLowerCase();
    if (!labels.hasOwnProperty(ltgt)) throw { line: lit.line, msg: "unknown label '" + lit.args[1] + "'" };
    var loff = labels[ltgt] - lit.addr;
    var lhi = (loff + 0x800) >> 12, llo = loff - (lhi << 12);
    items.splice(fi, 1,
      { line: lit.line, op: "auipc", args: [lit.args[0], String(lhi)], addr: lit.addr, src: lit.src },
      { line: lit.line, op: "addi", args: [lit.args[0], lit.args[0], String(llo)], addr: lit.addr + 4, src: lit.src });
    fi++;
  }
  var size = Math.max(addrs.text, addrs.data);
  var img = new Uint8Array(size);
  var words = [], listing = [];
  function putW(a, w) {    img[a] = w & 0xFF; img[a + 1] = (w >>> 8) & 0xFF;
    img[a + 2] = (w >>> 16) & 0xFF; img[a + 3] = (w >>> 24) & 0xFF;
  }
  items.forEach(function (it) {
    if (it.op === ".word") {
      it.args.forEach(function (v, j) {
        var wv = v >>> 0;
        putW(it.addr + j * 4, wv);
        words.push(wv);
        listing.push({ addr: it.addr + j * 4, word: wv, src: it.src, line: it.line });
      });
    } else if (it.op === ".bytes") {
      for (var b = 0; b < it.bytes.length; b++) img[it.addr + b] = it.bytes[b] & 0xFF;
      listing.push({ addr: it.addr, word: null, src: it.src, line: it.line, note: it.bytes.length + " bytes" });
    } else {
      var w = rvEncode(it.op, it.args, it.addr, labels, it.line);
      putW(it.addr, w);
      words.push(w);
      listing.push({ addr: it.addr, word: w, src: it.src, line: it.line });
    }
  });
  var entry = 0;
  for (var ei = 0; ei < items.length; ei++) {
    if (items[ei].op !== ".word" && items[ei].op !== ".bytes") { entry = items[ei].addr; break; }
  }
  return { words: words, labels: labels, listing: listing, image: img, entry: entry };
}

/* CPU */
function rvCpu(image, entry) {
  var MEMSZ = 4096;
  if (!(image instanceof Uint8Array)) throw { trap: "rvCpu needs a Uint8Array program image (use rvAssemble(src).image)" };
  if (image.length > MEMSZ) throw { trap: "program too big for 4K memory" };
  var mem = new Uint8Array(MEMSZ);
  mem.set(image, 0);
  var R = new Array(32);
  for (var r = 0; r < 32; r++) R[r] = 0;
  R[2] = 0x1000;
  return { mem: mem, memsz: MEMSZ, R: R, pc: (entry >>> 0) || 0, halted: false, steps: 0, out: [], lastWord: 0 };
}
function rvLoadW(cpu, a) {
  if (a & 3) throw { trap: "misaligned load at 0x" + (a >>> 0).toString(16) };
  if (a + 4 > cpu.memsz || a < 0) throw { trap: "load out of bounds at 0x" + (a >>> 0).toString(16) };
  return (cpu.mem[a] | (cpu.mem[a + 1] << 8) | (cpu.mem[a + 2] << 16) | (cpu.mem[a + 3] << 24)) | 0;
}
function rvStep(cpu) {
  if (cpu.halted) return "halt";
  var pc = cpu.pc >>> 0;
  if (pc & 3) throw { trap: "misaligned PC 0x" + pc.toString(16) };
  if (pc + 4 > cpu.memsz) throw { trap: "PC ran off the end of memory" };
  var w = (cpu.mem[pc] | (cpu.mem[pc + 1] << 8) | (cpu.mem[pc + 2] << 16) | (cpu.mem[pc + 3] << 24)) >>> 0;
  cpu.lastWord = w;
  var op = w & 0x7F, rd = (w >>> 7) & 31, f3 = (w >>> 12) & 7;
  var rs1 = (w >>> 15) & 31, rs2 = (w >>> 20) & 31, f7 = (w >>> 25) & 0x7F;
  var R = cpu.R;
  var npc = (pc + 4) >>> 0;
  function sx(v, bits) { return (v << (32 - bits)) >> (32 - bits); }
  function wr(d, v) { if (d) R[d] = v | 0; }
  function chkA(a, n) { if (a + n > cpu.memsz || a < 0) throw { trap: "memory access out of bounds at 0x" + (a >>> 0).toString(16) }; }
  switch (op) {
    case 0x33: {
      var a = R[rs1] | 0, b = R[rs2] | 0;
      if (f7 === 0) {
        if (f3 === 0) wr(rd, a + b);
        else if (f3 === 1) wr(rd, a << (b & 31));
        else if (f3 === 2) wr(rd, a < b ? 1 : 0);
        else if (f3 === 3) wr(rd, (a >>> 0) < (b >>> 0) ? 1 : 0);
        else if (f3 === 4) wr(rd, a ^ b);
        else if (f3 === 5) wr(rd, a >>> (b & 31));
        else if (f3 === 6) wr(rd, a | b);
        else if (f3 === 7) wr(rd, a & b);
        else throw { trap: "bad funct3" };
      } else if (f7 === 32) {
        if (f3 === 0) wr(rd, a - b);
        else if (f3 === 5) wr(rd, a >> (b & 31));
        else throw { trap: "bad funct7/funct3" };
      } else throw { trap: "bad funct7" };
      break;
    }
    case 0x13: {
      var imm = sx(w >>> 20, 12), s1 = R[rs1] | 0;
      if (f3 === 0) wr(rd, s1 + imm);
      else if (f3 === 1) { if (f7 !== 0) throw { trap: "bad shift encoding" }; wr(rd, s1 << (rs2 & 31)); }
      else if (f3 === 2) wr(rd, s1 < imm ? 1 : 0);
      else if (f3 === 3) wr(rd, (s1 >>> 0) < (imm >>> 0) ? 1 : 0);
      else if (f3 === 4) wr(rd, s1 ^ imm);
      else if (f3 === 6) wr(rd, s1 | imm);
      else if (f3 === 7) wr(rd, s1 & imm);
      else if (f3 === 5) {
        if (f7 === 0) wr(rd, s1 >>> (rs2 & 31));
        else if (f7 === 32) wr(rd, s1 >> (rs2 & 31));
        else throw { trap: "bad shift funct7" };
      } else throw { trap: "bad funct3" };
      break;
    }
    case 0x03: {
      var lo = sx(w >>> 20, 12), ad = (R[rs1] + lo) | 0, au = ad >>> 0;
      if (f3 === 2) { if (au & 3) throw { trap: "misaligned lw" }; chkA(au, 4); wr(rd, rvLoadW(cpu, au)); }
      else if (f3 === 1) { if (au & 1) throw { trap: "misaligned lh" }; chkA(au, 2); wr(rd, sx(cpu.mem[au] | (cpu.mem[au + 1] << 8), 16)); }
      else if (f3 === 0) { chkA(au, 1); wr(rd, sx(cpu.mem[au], 8)); }
      else if (f3 === 5) { if (au & 1) throw { trap: "misaligned lhu" }; chkA(au, 2); wr(rd, cpu.mem[au] | (cpu.mem[au + 1] << 8)); }
      else if (f3 === 4) { chkA(au, 1); wr(rd, cpu.mem[au]); }
      else throw { trap: "bad load funct3" };
      break;
    }
    case 0x23: {
      var so = sx(((w >>> 25) << 5) | ((w >>> 7) & 31), 12), sa = (R[rs1] + so) | 0, su = sa >>> 0, sv = R[rs2] | 0;
      if (f3 === 2) { if (su & 3) throw { trap: "misaligned sw" }; chkA(su, 4); cpu.mem[su] = sv & 0xFF; cpu.mem[su + 1] = (sv >>> 8) & 0xFF; cpu.mem[su + 2] = (sv >>> 16) & 0xFF; cpu.mem[su + 3] = (sv >>> 24) & 0xFF; }
      else if (f3 === 1) { if (su & 1) throw { trap: "misaligned sh" }; chkA(su, 2); cpu.mem[su] = sv & 0xFF; cpu.mem[su + 1] = (sv >>> 8) & 0xFF; }
      else if (f3 === 0) { chkA(su, 1); cpu.mem[su] = sv & 0xFF; }
      else throw { trap: "bad store funct3" };
      break;
    }
    case 0x63: {
      var bo = sx((((w >>> 31) & 1) << 12) | (((w >>> 7) & 1) << 11) | (((w >>> 25) & 0x3F) << 5) | (((w >>> 8) & 0xF) << 1), 13);
      var x = R[rs1] | 0, y = R[rs2] | 0, take = false;
      if (f3 === 0) take = x === y;
      else if (f3 === 1) take = x !== y;
      else if (f3 === 4) take = x < y;
      else if (f3 === 5) take = x >= y;
      else if (f3 === 6) take = (x >>> 0) < (y >>> 0);
      else if (f3 === 7) take = (x >>> 0) >= (y >>> 0);
      else throw { trap: "bad branch funct3" };
      if (take) npc = (pc + bo) >>> 0;
      break;
    }
    case 0x6F: {
      var jo = sx((((w >>> 31) & 1) << 20) | (((w >>> 12) & 0xFF) << 12) | (((w >>> 20) & 1) << 11) | (((w >>> 21) & 0x3FF) << 1), 21);
      wr(rd, pc + 4); npc = (pc + jo) >>> 0;
      break;
    }
    case 0x67: {
      var ji = sx(w >>> 20, 12);
      wr(rd, pc + 4); npc = ((R[rs1] + ji) & ~1) >>> 0;
      break;
    }
    case 0x37: wr(rd, w & 0xFFFFF000); break;
    case 0x17: wr(rd, (pc + (w & 0xFFFFF000)) | 0); break;
    case 0x73: {
      if (w !== 0x73) throw { trap: "bad SYSTEM encoding" };
      var svc = R[17] | 0;
      if (svc === 10) { cpu.halted = true; cpu.pc = npc; R[0] = 0; cpu.steps++; return "halt"; }
      if (svc === 1) { cpu.out.push({ t: "int", v: R[10] | 0 }); }
      else if (svc === 4) { cpu.out.push({ t: "char", v: R[10] & 0xFF }); }
      else throw { trap: "unknown ecall service " + svc + " (use 1=print int, 4=print char, 10=halt)" };
      break;
    }
    default: throw { trap: "illegal instruction 0x" + w.toString(16) + " at PC 0x" + pc.toString(16) };
  }
  R[0] = 0;
  cpu.pc = npc;
  cpu.steps++;
  return "ok";
}
function rvRun(cpu, limit) {
  limit = limit || 200000;
  while (!cpu.halted) {
    if (cpu.steps >= limit) throw { trap: "runaway program: " + limit + " steps with no halt (check your loop)" };
    rvStep(cpu);
  }
  return cpu;
}

/* Disassembler for the bench readout */
function rvDis(w) {
  w = w >>> 0;
  var op = w & 0x7F, rd = (w >>> 7) & 31, f3 = (w >>> 12) & 7;
  var rs1 = (w >>> 15) & 31, rs2 = (w >>> 20) & 31, f7 = (w >>> 25) & 0x7F;
  function sx(v, bits) { return (v << (32 - bits)) >> (32 - bits); }
  function rn(r) { return "x" + r; }
  var Rtab = { "0x33": null };
  if (op === 0x33) {
    var nm = { "0,0": "add", "0,32": "sub", "1,0": "sll", "2,0": "slt", "3,0": "sltu", "4,0": "xor", "5,0": "srl", "5,32": "sra", "6,0": "or", "7,0": "and" }[f3 + "," + f7];
    return nm ? nm + " " + rn(rd) + "," + rn(rs1) + "," + rn(rs2) : ".word 0x" + w.toString(16);
  }
  if (op === 0x13) {
    var im = sx(w >>> 20, 12);
    if (f3 === 1) return "slli " + rn(rd) + "," + rn(rs1) + "," + rs2;
    if (f3 === 5) return (f7 === 32 ? "srai " : "srli ") + rn(rd) + "," + rn(rs1) + "," + rs2;
    var nm2 = { 0: "addi", 2: "slti", 3: "sltiu", 4: "xori", 6: "ori", 7: "andi" }[f3];
    return nm2 ? nm2 + " " + rn(rd) + "," + rn(rs1) + "," + im : ".word 0x" + w.toString(16);
  }
  if (op === 0x03) {
    var nm3 = { 0: "lb", 1: "lh", 2: "lw", 4: "lbu", 5: "lhu" }[f3];
    return nm3 ? nm3 + " " + rn(rd) + "," + sx(w >>> 20, 12) + "(" + rn(rs1) + ")" : ".word 0x" + w.toString(16);
  }
  if (op === 0x23) {
    var nm4 = { 0: "sb", 1: "sh", 2: "sw" }[f3];
    return nm4 ? nm4 + " " + rn(rs2) + "," + sx(((w >>> 25) << 5) | ((w >>> 7) & 31), 12) + "(" + rn(rs1) + ")" : ".word 0x" + w.toString(16);
  }
  if (op === 0x63) {
    var nm5 = { 0: "beq", 1: "bne", 4: "blt", 5: "bge", 6: "bltu", 7: "bgeu" }[f3];
    var bo = sx((((w >>> 31) & 1) << 12) | (((w >>> 7) & 1) << 11) | (((w >>> 25) & 0x3F) << 5) | (((w >>> 8) & 0xF) << 1), 13);
    return nm5 ? nm5 + " " + rn(rs1) + "," + rn(rs2) + ",pc+" + bo : ".word 0x" + w.toString(16);
  }
  if (op === 0x6F) {
    var jo = sx((((w >>> 31) & 1) << 20) | (((w >>> 12) & 0xFF) << 12) | (((w >>> 20) & 1) << 11) | (((w >>> 21) & 0x3FF) << 1), 21);
    return "jal " + rn(rd) + ",pc+" + jo;
  }
  if (op === 0x67) return "jalr " + rn(rd) + "," + sx(w >>> 20, 12) + "(" + rn(rs1) + ")";
  if (op === 0x37) return "lui " + rn(rd) + ",0x" + ((w >>> 12) & 0xFFFFF).toString(16);
  if (op === 0x17) return "auipc " + rn(rd) + ",0x" + ((w >>> 12) & 0xFFFFF).toString(16);
  if (w === 0x73) return "ecall";
  return ".word 0x" + w.toString(16);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { rvAssemble: rvAssemble, rvCpu: rvCpu, rvStep: rvStep, rvRun: rvRun, rvDis: rvDis, RV_REGNAMES: RV_REGNAMES, rvLoadW: rvLoadW };
}
