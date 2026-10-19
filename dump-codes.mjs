const fs = await import("node:fs");
const 源 = fs.readFileSync("E:/himeyuri/conformance/codes.mjs", "utf8");
const 条 = [];
for (const 行 of 源.split(/\r?\n/)) {
  const m = /\{ code: "([A-Z0-9\-]+)", stage: "([a-z]+)"([^}]*)/.exec(行);
  if (!m) continue;
  const 含 = /meaning: "([^"]*)"/.exec(m[3]);
  const 内 = /internal: true/.test(m[3]);
  const 预 = /planned: true/.test(m[3]);
  条.push({ code: m[1], stage: m[2], meaning: 含 ? 含[1] : "", 内, 预 });
}
条.sort((a, b) => a.code.localeCompare(b.code));
console.log("  共 " + 条.length + " 个");
条.forEach((e) => console.log("  " + e.code.padEnd(12) + (e.内 ? "[内]" : "    ") + (e.预 ? "[预]" : "    ") + e.meaning));
