import fs from "node:fs";
const lines = fs.readFileSync("E:/himeyuri/test/embed.test.mjs", "utf8").split("\n");
lines.forEach((l, i) => {
  if (/file effect|writing builtin/.test(l)) {
    for (let k = Math.max(0, i - 6); k <= Math.min(lines.length - 1, i + 3); k++) console.log("    " + (k + 1) + "  " + lines[k].slice(0, 108));
    console.log("    ---");
  }
});
