# 把 Himeyuri 导出的像素文本变成 PNG。
#
# 文本格式：第一行 "w 宽"，第二行 "h 高"，之后每行是逗号分隔的颜色码（0xRRGGBB）。
# 这一步要动文件、要用图像库，所以它不在语言里，而在一个子进程里——
# 与颜色那条桥、native 那个窗口同一个做法。
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
with open(src, encoding="utf-8") as fh:
    lines = [l.rstrip("\n") for l in fh if l.strip()]
w = int(lines[0].split()[1])
h = int(lines[1].split()[1])
img = Image.new("RGB", (w, h))
px = img.load()
for y in range(h):
    vals = [int(v) for v in lines[2 + y].split(",")]
    for x in range(min(w, len(vals))):
        c = vals[x]
        px[x, y] = ((c >> 16) & 255, (c >> 8) & 255, c & 255)
img.save(dst)
print("OK " + str(w) + "x" + str(h))
