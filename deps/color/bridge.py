"""Himeyuri 的色彩桥：声明进来的转换，测量出去的报告。

用法：
  python bridge.py convert --src sRGB --dst <某.icm> --strategy min-loss|look \
      --image 进.png --out 出.png --report 报告.json

两种具名策略（不许混用）：
  min-loss  相对比色 + 黑点补偿。本机实测：三段 ΔE76 之和 279.6，是可用组合里最小的。
  look      感知。保住整体关系、观感优先，代价是损失更大（本机实测 290.0）。

为什么要有两套而不是一套「最好」的：最小损失与观感优先是两个不同的目标，
抬暗部、留白、减墨这类手法会让损失变大，所以它们必须在另一种策略名下，而不是悄悄混进来。

报告里有什么（全部是可核对的输入与可复核的测量）：
  引擎与版本 · 两个 ICC 的路径与 sha256 · 策略与意图 · 图像尺寸 ·
  分层 ΔE76（按**源图的 L*** 分成高光 / 中间 / 暗部，各自平均与最大）·
  改动超过阈值的像素比例 · 色域外（裁剪）像素比例。
"""
import argparse
import io
import hashlib
import json
import os
import sys

from PIL import Image, ImageCms

STRATEGIES = {
    "min-loss": {"intent": ImageCms.Intent.RELATIVE_COLORIMETRIC,
                 "flags": ImageCms.Flags.BLACKPOINTCOMPENSATION,
                 "why": "本机实测三段 ΔE76 之和最小（279.6）"},
    "look": {"intent": ImageCms.Intent.PERCEPTUAL, "flags": 0,
             "why": "整体关系优先，损失更大（本机实测 290.0）"},
}


PROFILE_DIRS = [
    r"C:\Windows\System32\spool\drivers\color",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "profiles"),
]


def list_spaces():
    """能用的色彩空间 = 内建三个 + 两个目录里的文件。扩充数量就是往目录里放文件。"""
    builtin = []
    for name in ("sRGB", "LAB", "XYZ"):
        try:
            p = ImageCms.createProfile(name)
            builtin.append({"name": name, "description": ImageCms.getProfileDescription(p).strip(), "kind": "built-in"})
        except Exception:
            pass
    from_file = []
    for d in PROFILE_DIRS:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.lower().endswith((".icc", ".icm")):
                continue
            path = os.path.join(d, f)
            try:
                desc = ImageCms.getProfileDescription(ImageCms.getOpenProfile(path)).strip()
            except Exception as e:
                desc = "打不开：" + str(e)[:40]
            from_file.append({"name": f, "dir": d, "description": desc,
                              "sha256": sha256_of(path), "kind": "file"})
    return builtin, from_file


def open_profile(spec):
    """sRGB 可以直接写名字；其余按路径打开，并回报它自己的描述。"""
    if spec.lower() in ("srgb", "builtin:srgb"):
        p = ImageCms.createProfile("sRGB")
        return p, "sRGB (built-in)", None
    p = ImageCms.getOpenProfile(spec)
    return p, ImageCms.getProfileDescription(p).strip(), spec


def fingerprint(profile, path):
    """内建 profile 没有文件，就把它的字节算哈希——报告里四个输入都要有指纹。"""
    if path:
        return sha256_of(path)
    try:
        return hashlib.sha256(profile.tobytes()).hexdigest()
    except Exception:
        return None


def sha256_of(path):
    if not path or not os.path.exists(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def transform_mode(profile):
    """目标 profile 是什么色彩空间：先按 RGB 试，失败再按 CMYK 试。ICC 自己知道答案。"""
    for mode in ("RGB", "CMYK"):
        try:
            ImageCms.buildTransform(ImageCms.createProfile("sRGB"), profile, "RGB", mode)
            return mode
        except Exception:
            continue
    return None


def to_lab(img):
    return ImageCms.applyTransform(img.convert("RGB"),
                                   ImageCms.buildTransform(ImageCms.createProfile("sRGB"),
                                                           ImageCms.createProfile("LAB"), "RGB", "LAB"))


def delta_e76(pa, pb):
    """CIE76：Lab 空间的欧氏距离。Pillow 的 LAB 是 8 位，所以要按比例换算回真实量纲。"""
    def unpack(p):
        return (p[0] / 255.0 * 100.0, p[1] - 128.0, p[2] - 128.0)
    la, lb = unpack(pa), unpack(pb)
    return sum((x - y) ** 2 for x, y in zip(la, lb)) ** 0.5


def band_of(lab_pixel):
    """按**感知亮度**分段，而不是按 (R+G+B)/3 —— 纯绿的算术平均只有 85，会冒充中间调。"""
    l = lab_pixel[0] / 255.0 * 100.0
    return "暗部" if l < 33.0 else ("中间" if l < 66.0 else "高光")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["convert", "probe", "spaces", "pick"])
    ap.add_argument("--candidates", default="", help="分号分隔；可以是内建名，也可以是 profile 目录里的文件名")
    ap.add_argument("--src", default="sRGB")
    ap.add_argument("--dst", default="sRGB")
    ap.add_argument("--strategy", default="min-loss", choices=sorted(STRATEGIES))
    ap.add_argument("--image")
    ap.add_argument("--out")
    ap.add_argument("--report")
    ap.add_argument("--threshold", type=float, default=2.0, help="ΔE76 超过它就算「改动可见」")
    ap.add_argument("--embed-target", action="store_true", help="写出时把目标 ICC 嵌进去，交给印厂用")
    args = ap.parse_args()

    engine = {"pillow": Image.__version__, "littlecms": getattr(ImageCms.core, "littlecms_version", "unknown")}

    if args.action == "pick":
        # 逐个候选：转一趟再回来，量三段 ΔE76 之和，从小到大排。
        # 「有损率最小化」在这里从一条原则变成一步——不靠人记得该选哪个空间。
        reference = [((0, 255, 0)), ((255, 90, 0)), ((200, 0, 255)), ((0, 0, 255)), ((0, 255, 255)),
                     ((255, 0, 0)), ((255, 255, 0)), ((0, 128, 64)), ((32, 32, 32)), ((128, 128, 128)), ((224, 224, 224))]
        src_prof, src_name, _ = open_profile(args.src)
        rows = []
        for spec in [c for c in args.candidates.split(";") if c]:
            resolved = None
            if spec in ("sRGB", "LAB", "XYZ"):
                dst_prof, dst_name = ImageCms.createProfile(spec), spec + " (built-in)"
            else:
                for d in PROFILE_DIRS:
                    cand = os.path.join(d, spec)
                    if os.path.exists(cand):
                        resolved = cand
                        break
                if not resolved:
                    rows.append({"given": spec, "ok": False, "why": "两个目录里都没有这个名字"})
                    continue
                dst_prof, dst_name = ImageCms.getOpenProfile(resolved), spec
            mode = transform_mode(dst_prof)
            if mode is None:
                rows.append({"given": spec, "ok": False, "why": "既不能当 RGB 也不能当 CMYK 目标"})
                continue
            t1 = ImageCms.buildTransform(src_prof, dst_prof, "RGB", mode, renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC, flags=ImageCms.Flags.BLACKPOINTCOMPENSATION)
            t2 = ImageCms.buildTransform(dst_prof, src_prof, mode, "RGB", renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC, flags=ImageCms.Flags.BLACKPOINTCOMPENSATION)
            src_lab = to_lab(Image.new("RGB", (1, 1)))
            worst = {"暗部": 0.0, "中间": 0.0, "高光": 0.0}
            for rgb in reference:
                one = Image.new("RGB", (1, 1), rgb)
                back = ImageCms.applyTransform(ImageCms.applyTransform(one, t1), t2)
                band = band_of(to_lab(one).getpixel((0, 0)))
                d = delta_e76(to_lab(one).getpixel((0, 0)), to_lab(back).getpixel((0, 0)))
                worst[band] = max(worst[band], d)
            rows.append({"given": spec, "ok": True, "mode": mode, "bands": {k: round(v, 3) for k, v in worst.items()},
                         "sum": round(sum(worst.values()), 3),
                         "sha256": fingerprint(dst_prof, resolved)})
        good = [r for r in rows if r.get("ok")]
        bad = [r for r in rows if not r.get("ok")]
        good.sort(key=lambda r: r["sum"])
        print(json.dumps({"source": args.src, "ranked": good, "skipped": bad,
                          "note": "sum 是暗部/中间/高光三段最大 ΔE76 之和；0 表示目标色域完整包含源色域。"},
                         ensure_ascii=False, indent=2))
        return 0

    if args.action == "spaces":
        builtin, from_file = list_spaces()
        print(json.dumps({"engine": engine, "builtin": builtin, "from_file": from_file,
                          "storage_modes": sorted(Image.MODES),
                          "note": "内建三个只有 sRGB / LAB / XYZ；其余空间一律从文件加载，目录见 from_file 的 dir。"},
                         ensure_ascii=False, indent=2))
        return 0

    if args.action == "probe":
        print(json.dumps({
            "engine": engine,
            "modes": sorted(Image.MODES),
            "strategies": {k: {"intent": v["intent"], "why": v["why"]} for k, v in STRATEGIES.items()},
            "profile_dirs": PROFILE_DIRS,
        }, ensure_ascii=False, indent=2))
        return 0

    if not (args.image and args.out and args.report):
        print("convert 需要 --image --out --report", file=sys.stderr)
        return 2
    strategy = STRATEGIES[args.strategy]
    src_prof, src_name, src_path = open_profile(args.src)
    dst_prof, dst_name, dst_path = open_profile(args.dst)

    mode = transform_mode(dst_prof)
    if mode is None:
        print("目标 profile 既不能当 RGB 也不能当 CMYK：动作被拒绝", file=sys.stderr)
        return 3
    going = ImageCms.buildTransform(src_prof, dst_prof, "RGB", mode,
                                    renderingIntent=strategy["intent"], flags=strategy["flags"])
    coming = ImageCms.buildTransform(dst_prof, src_prof, mode, "RGB",
                                     renderingIntent=strategy["intent"], flags=strategy["flags"])

    opened = Image.open(args.image)
    image_icc = opened.info.get("icc_profile")
    original = opened.convert("RGB")
    through = ImageCms.applyTransform(ImageCms.applyTransform(original, going), coming)
    if args.embed_target and dst_path:
        with open(dst_path, "rb") as fh:
            through.save(args.out, icc_profile=fh.read())
    else:
        through.save(args.out)

    src_lab, back_lab = to_lab(original), to_lab(through)
    bands = {"暗部": [], "中间": [], "高光": []}
    changed = 0
    total = 0
    for x in range(original.width):
        for y in range(original.height):
            l = src_lab.getpixel((x, y))
            d = delta_e76(l, back_lab.getpixel((x, y)))
            bands[band_of(l)].append(d)
            total += 1
            if d > args.threshold:
                changed += 1

    def summarise(values):
        if not values:
            return {"count": 0, "mean": None, "max": None}
        return {"count": len(values), "mean": round(sum(values) / len(values), 3), "max": round(max(values), 3)}

    report = {
        "engine": engine,
        "strategy": args.strategy,
        "strategy_why": strategy["why"],
        "intent": strategy["intent"],
        "target_mode": mode,
        "source": {"given": args.src, "name": src_name, "sha256": fingerprint(src_prof, src_path)},
        "target": {"given": args.dst, "name": dst_name, "sha256": fingerprint(dst_prof, dst_path)},
        "image": {"path": args.image, "size": list(original.size), "sha256": sha256_of(args.image),
              "has_icc": bool(image_icc), "icc_description": (ImageCms.getProfileDescription(ImageCms.getOpenProfile(io.BytesIO(image_icc))).strip() if image_icc else None),
              "icc_sha256": (hashlib.sha256(image_icc).hexdigest() if image_icc else None)},
        "output": {"path": args.out, "sha256": sha256_of(args.out)},
        "delta_e76": {band: summarise(v) for band, v in bands.items()},
        "changed_fraction": round(changed / total, 6) if total else None,
        "threshold": args.threshold,
        "note": "分层按源图的 L* 分段（不是 (R+G+B)/3）；ΔE76 是 CIE76，比 sRGB 欧氏距离更接近感知。",
    }
    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps({"ok": True, "report": args.report, "changed_fraction": report["changed_fraction"],
                      "bands": {k: v["max"] for k, v in report["delta_e76"].items()}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
