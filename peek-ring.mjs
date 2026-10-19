import fs from "node:fs";
const t = fs.readFileSync("E:/himeyuri/tools/conformance.mjs", "utf8").split("\n");
t.forEach((l, i) => { if (/RING|ring|is_letter|is_mark|outside/.test(l)) console.log("    " + (i + 1) + "  " + l.slice(0, 110)); });
