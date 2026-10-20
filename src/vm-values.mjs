// 字节码虚拟机的两种聚合值。
//
// 它们存在的原因是：执行器判断一个值是什么，该问它自己的标签，而不是问宿主怎么看它。
// 在这之前元组是 JS 数组、记录是 JS 对象，于是 VM 里到处是 Array.isArray 与 typeof v === "object"——
// 那些问的是「宿主认不认得这种形状」，而 VM 想知道的是「它是什么」。
//
// 放在单独一份里，是因为执行器与内置表都要用它。两边各自定义一份会让「同一个元组」
// 在两边成为两种东西，而那类错误不会当场报出来。
export class 类元组 {
  constructor(items) { this.tag = "tuple"; this.items = items; }
}

export class 类记录 {
  constructor(fields) { this.tag = "record"; this.fields = fields; }
}
