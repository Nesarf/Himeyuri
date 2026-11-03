#!/usr/bin/env python3
# HMYR's native presentation backend, the POSIX side.
#
# Same job as deps/surface/win.ps1 and the same receipt, one line:
#
#   HMYR-SURFACE {"shown":false,"width":640,"height":400,"text_len":5,
#                 "image":false,"image_w":0,"image_h":0,"frames":2,"events":[...]}
#
# This one only does the -NoShow path: check the arguments, read the image size, work out how
# many frame changes would have happened, hand back the receipt. Opening a real window needs an
# X11 binding -- libX11 is on this machine (1.8.13-1) but writing that binding is its own piece
# of work, and mixing it into the cross-system round would have made neither reviewable. So a
# call that asks for a real window says so instead of pretending one opened.
#
# The frame count under -NoShow is "how many changes would have happened", which is the frame
# count minus one -- the same convention win.ps1 uses, and the same one the suite expects.
#
# ASCII ONLY, comments included: deps/surface carries that rule for the .ps1 files because
# powershell 5.1 decodes them in the current code page. This file does not have that problem,
# but it lives in the same directory under the same rule, and one rule is easier to check.
import json
import sys

DEFAULTS = {
    "Width": "640",
    "Height": "400",
    "Text": "",
    "Image": "",
    "ShowMs": "1200",
    "EventMs": "0",
    "Events": "",
    "Frames": "0",
    "NoShow": False,
}


def parse(argv):
    args = dict(DEFAULTS)
    i = 0
    while i < len(argv):
        a = argv[i]
        if not a.startswith("-"):
            i += 1
            continue
        key = a[1:]
        if key == "NoShow":
            args["NoShow"] = True
            i += 1
            continue
        if key not in args:
            sys.stderr.write("unknown argument: " + a + "\n")
            return None
        args[key] = argv[i + 1] if i + 1 < len(argv) else ""
        i += 2
    return args


def parse_events(text):
    # Semicolons between events, commas only inside a mouse pair -- win.ps1 learned that the
    # hard way (a comma split mouse:10,20 into three pieces and y came back as 0).
    events = []
    for piece in text.split(";"):
        if not piece:
            continue
        if piece.startswith("key:"):
            events.append({"kind": "key", "value": piece[4:]})
        elif piece.startswith("mouse:"):
            pair = piece[6:].split(",")
            x = int(pair[0]) if len(pair) > 0 and pair[0] else 0
            y = int(pair[1]) if len(pair) > 1 and pair[1] else 0
            events.append({"kind": "mouse", "x": x, "y": y})
    return events


def main():
    args = parse(sys.argv[1:])
    if args is None:
        return 2

    text = args["Text"]
    frames = text.split("|")
    interval = int(args["Frames"] or "0")
    # Under -NoShow there is no time to change frames in, so report how many changes would
    # have happened. Not a lie: it is the convention both this file and win.ps1 follow.
    planned = (len(frames) - 1) if (interval > 0 and len(frames) > 1) else 0

    image = args["Image"]
    image_w = 0
    image_h = 0
    if image:
        try:
            from PIL import Image  # noqa: PLC0415 - only needed when an image is passed
            with Image.open(image) as im:
                image_w, image_h = im.size
        except Exception as exc:  # noqa: BLE001 - the receipt says what went wrong
            sys.stderr.write("cannot read the image: " + str(exc) + "\n")
            return 1

    report = {
        "shown": False,
        "width": int(args["Width"] or "640"),
        "height": int(args["Height"] or "400"),
        "text_len": len(text),
        "image": bool(image),
        "image_w": image_w,
        "image_h": image_h,
        "frames": planned,
        "events": parse_events(args["Events"]),
    }
    print("HMYR-SURFACE " + json.dumps(report, separators=(",", ":"), ensure_ascii=False))

    if not args["NoShow"]:
        # A real window was asked for. This build does not open one, and saying so on stderr
        # keeps the exit code honest without making the receipt a lie.
        sys.stderr.write(
            "this machine has libX11 but no window binding in this file: "
            "the receipt was produced without opening a window\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
