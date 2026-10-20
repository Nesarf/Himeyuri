// 诊断：一门语言里「这段话有错」的最小形状。
//
// 它单独立在这里，是因为它不属于任何一个阶段：切词器产出它、parser 产出它、
// 加载器转发它、启动器读它。原先它住在 src/lexer.mjs 里，于是凡是要记诊断的地方
// 都得 import 宿主的切词器——那是把「记录错误」和「怎么切词」绑在一起，
// 而 Stage 0 换成子集那两层之后，这个绑法成了一条假的依赖：
// 加载器其实一次也没有调到宿主的切词器，却写着它。
//
// 三个字段的名字与位置（severity · code · message · line · column）是外面看得见的东西，
// 换掉它们等于换掉所有读诊断的人。tests/conformance 里那些码表也是按这个形状读的。
export class Diagnostics {
  constructor() { this.items = []; }
  add(severity, code, message, line, column) {
    this.items.push({ severity, code, message, line, column });
  }
  error(code, message, line, column) { this.add("error", code, message, line, column); }
  warn(code, message, line, column) { this.add("warning", code, message, line, column); }
  get errors() { return this.items.filter((d) => d.severity === "error"); }
  get warnings() { return this.items.filter((d) => d.severity === "warning"); }
}
