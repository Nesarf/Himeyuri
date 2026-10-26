// 读 .hm-ittgn-krgn-m。JS 这一侧的一份，与 self/ittgn.hmoca 配对：
// 那一份写容器，这一份读容器 —— 与 src/format.mjs 和 self/fmt.hmoca 是同一种安排，
// 而且验收里两边对得上，所以格式只要歪一点就会当场红。
//
// 为什么启动器不自己读文件：bin/hmyr.mjs 有一条被验收盯着的性质 —— 它不直接碰文件系统，
// 读文件那件事由加载器与这里各管一段。所以解容器落在这里。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const 魔数 = "HMYRITTGN";
const 版 = 1;
export const 容器后缀 = ".hm-ittgn-krgn-m";

export const 是容器 = (名) => String(名 || "").toLowerCase().endsWith(容器后缀);

// 只读，不落地。给「列」与「验」用。
export const 读容器 = (路) => {
  let 字节;
  try { 字节 = fs.readFileSync(路); }
  catch { return { ok: false, 错: "HMYR-E0413 读不到：" + 路 }; }
  if (字节.length < 12 || 字节.subarray(0, 9).toString("latin1") !== 魔数) {
    return { ok: false, 错: "HMYR-E0413 这不是容器：" + 路 };
  }
  if (字节[9] !== 版) return { ok: false, 错: "HMYR-E0415 版本不认识：" + 字节[9] };
  const 数 = 字节.readUInt16LE(10);
  let 位 = 12;
  const 成员们 = [];
  for (let i = 0; i < 数; i++) {
    if (位 + 2 > 字节.length) return { ok: false, 错: "HMYR-E0416 成员表截断" };
    const 名长 = 字节.readUInt16LE(位);
    const 名起 = 位 + 2;
    const 长位 = 名起 + 名长;
    if (长位 + 4 > 字节.length) return { ok: false, 错: "HMYR-E0416 成员表截断" };
    const 名 = 字节.subarray(名起, 长位).toString("utf8");
    const 数据长 = 字节.readUInt32LE(长位);
    const 起 = 长位 + 4;
    if (起 + 数据长 > 字节.length) return { ok: false, 错: "HMYR-E0416 成员数据截断" };
    成员们.push({ 名, 数据: 字节.subarray(起, 起 + 数据长) });
    位 = 起 + 数据长;
  }
  return { ok: true, 成员们 };
};

// 写：与 self/ittgn.hmoca 的「装」逐字节对齐。验收拿它做对照 —— 一份 HMYR 写的、
// 一份 JS 写的，落在同一个包上，字节相同才算格式真的定住了。
export const 写容器 = (路, 成员们) => {
  const 段们 = [Buffer.from(魔数, "latin1"), Buffer.from([版])];
  const 数 = Buffer.alloc(2);
  数.writeUInt16LE(成员们.length, 0);
  段们.push(数);
  for (const m of 成员们) {
    const 名 = Buffer.from(m.名, "utf8");
    const 头 = Buffer.alloc(2);
    头.writeUInt16LE(名.length, 0);
    const 长 = Buffer.alloc(4);
    长.writeUInt32LE(m.数据.length, 0);
    段们.push(头, 名, 长, m.数据);
  }
  fs.writeFileSync(路, Buffer.concat(段们));
  return { ok: true, 大小: fs.statSync(路).size };
};

// 解到临时目录，并挑一个入口。
//
// 入口的挑法按 design/FILETYPE.txt 第二节的第二节：先源码后字节码，名字先 main
// 后与包同名，都没有就取同阶的第一个。挑不出来不是崩溃，是一句说得清的话。
const 找入口 = (目录, 包路) => {
  const 包名 = path.basename(包路).replace(new RegExp("\\" + 容器后缀 + "$", "i"), "");
  const 候选 = [];
  const 走 = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) 走(p);
      else if (/\.hmoca$/i.test(e.name)) 候选.push({ p, 阶: 0 });
      else if (/\.hmoks$/i.test(e.name)) 候选.push({ p, 阶: 1 });
    }
  };
  走(目录);
  const 基 = (p) => path.basename(p).replace(/\.[^.]+$/, "");
  const 挑 = (阶) => {
    const 同阶 = 候选.filter((c) => c.阶 === 阶);
    return 同阶.find((c) => 基(c.p) === "main") || 同阶.find((c) => 基(c.p) === 包名) || 同阶[0];
  };
  return ((挑(0) || 挑(1)) || {}).p || null;
};

export const 解容器 = (包路) => {
  const r = 读容器(包路);
  if (!r.ok) return r;
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "hmyr-ittgn-"));
  const 根 = path.resolve(目录);
  for (const m of r.成员们) {
    const 归 = path.resolve(目录, m.名);
    // 成员名是从文件里读出来的，所以它不能被无条件相信：跳出目录的那一种要拦下来，
    // 否则一个包就能往它想去的地方写文件。
    if (归 !== 根 && !归.startsWith(根 + path.sep)) {
      return { ok: false, 错: "HMYR-E0417 成员路径跳出容器：" + m.名 };
    }
    fs.mkdirSync(path.dirname(归), { recursive: true });
    fs.writeFileSync(归, m.数据);
  }
  const 入口 = 找入口(目录, 包路);
  if (!入口) return { ok: false, 错: "HMYR-E0418 容器里没有可跑的入口（要先有 hmoca 或 hmoks 成员）" };
  return { ok: true, 目录, 入口, 成员们: r.成员们 };
};
