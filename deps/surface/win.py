#!/usr/bin/env python3
# HMYR's native presentation backend, the POSIX side.
#
# Same job as deps/surface/win.ps1 and the same receipt, one line:
#
#   HMYR-SURFACE {"shown":false,"width":640,"height":400,"text_len":5,
#                 "image":false,"image_w":0,"image_h":0,"frames":2,"events":[...]}
#
# Two paths:
#
#   -NoShow   check the arguments, read the image size, work out how many frame changes would
#             have happened, hand back the receipt. No window. This is what the suite uses by
#             default, and it is what win.ps1's -NoShow does.
#   default   the same receipt, then open a real X11 window, print the receipt again with
#             "shown":true and "window":<id>, hold it for ShowMs, destroy it.
#
# Why the window id is in the receipt: it makes "a window really appeared" checkable by another
# process instead of by eye. test/surface.test.mjs reads that id while this process is holding
# the window and asks XGetWindowAttributes whether it is viewable; after this process exits the
# same call finds nothing. That is the criterion design/OPEN.txt was waiting for.
#
# Why the receipt is printed before the hold, and flushed: a caller that wants to check the
# window needs the id while the window exists. Printing only at the end would leave nothing to
# look at.
#
# Why ctypes instead of tkinter: this machine has libX11 (1.8.13-1) and no libtk, so tkinter
# cannot even import. Xlib is the layer below both and needs no installation.
#
# The frame count under -NoShow is "how many changes would have happened", which is the frame
# count minus one -- the same convention win.ps1 uses, and the same one the suite expects.
#
# ASCII ONLY, comments included: deps/surface carries that rule for the .ps1 files because
# powershell 5.1 decodes them in the current code page. This file does not have that problem,
# but it lives in the same directory under the same rule, and one rule is easier to check.
import ctypes
import json
import sys
import time

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

# From X.h: map_state values. Named here rather than imported -- there is no python-xlib on this
# machine, and these two numbers are stable ABI.
IS_UNMAPPED = 0
IS_VIEWABLE = 2


class XWindowAttributes(ctypes.Structure):
    """The Xlib struct, field for field. Only map_state is read, but the layout before it has
    to be right or the offset lands somewhere else -- so all of it is declared."""
    _fields_ = [
        ("x", ctypes.c_int),
        ("y", ctypes.c_int),
        ("width", ctypes.c_int),
        ("height", ctypes.c_int),
        ("border_width", ctypes.c_int),
        ("depth", ctypes.c_int),
        ("visual", ctypes.c_void_p),
        ("root", ctypes.c_ulong),
        ("c_class", ctypes.c_int),
        ("bit_gravity", ctypes.c_int),
        ("win_gravity", ctypes.c_int),
        ("backing_store", ctypes.c_int),
        ("backing_planes", ctypes.c_ulong),
        ("backing_pixel", ctypes.c_ulong),
        ("save_under", ctypes.c_int),
        ("colormap", ctypes.c_ulong),
        ("map_installed", ctypes.c_int),
        ("map_state", ctypes.c_int),
        ("all_event_masks", ctypes.c_long),
        ("your_event_mask", ctypes.c_long),
        ("do_not_propagate_mask", ctypes.c_long),
        ("override_redirect", ctypes.c_int),
        ("screen", ctypes.c_void_p),
    ]


def load_xlib():
    lib = ctypes.CDLL("libX11.so.6")
    lib.XOpenDisplay.restype = ctypes.c_void_p
    lib.XOpenDisplay.argtypes = [ctypes.c_char_p]
    lib.XDefaultRootWindow.restype = ctypes.c_ulong
    lib.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    lib.XCreateSimpleWindow.restype = ctypes.c_ulong
    lib.XCreateSimpleWindow.argtypes = [
        ctypes.c_void_p, ctypes.c_ulong,
        ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint,
        ctypes.c_ulong, ctypes.c_ulong,
    ]
    lib.XStoreName.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_char_p]
    lib.XMapWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    lib.XFlush.argtypes = [ctypes.c_void_p]
    lib.XDestroyWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    lib.XCloseDisplay.argtypes = [ctypes.c_void_p]
    lib.XGetWindowAttributes.argtypes = [
        ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(XWindowAttributes),
    ]
    return lib


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


def emit(report):
    """One line, flushed: a caller waiting for the window id cannot see it otherwise."""
    sys.stdout.write("HMYR-SURFACE " + json.dumps(report, separators=(",", ":"), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    args = parse(sys.argv[1:])
    if args is None:
        return 2

    text = args["Text"]
    frames = text.split("|")
    interval = int(args["Frames"] or "0")
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

    width = int(args["Width"] or "640")
    height = int(args["Height"] or "400")
    report = {
        "shown": False,
        "width": width,
        "height": height,
        "text_len": len(text),
        "image": bool(image),
        "image_w": image_w,
        "image_h": image_h,
        "frames": planned,
        "events": parse_events(args["Events"]),
    }

    if args["NoShow"]:
        emit(report)
        return 0

    # The real path: open a window, say where it is, hold it, close it.
    lib = load_xlib()
    display = lib.XOpenDisplay(None)
    if not display:
        sys.stderr.write("cannot open the X display: is DISPLAY set and the server running?\n")
        report["window"] = 0
        emit(report)
        return 1

    root = lib.XDefaultRootWindow(display)
    window = lib.XCreateSimpleWindow(display, root, 0, 0, width, height, 1, 0, 0)
    lib.XStoreName(display, window, b"HMYR surface")
    lib.XMapWindow(display, window)
    lib.XFlush(display)

    report["shown"] = True
    report["window"] = int(window)
    emit(report)

    # Hold it. sleep is enough: nothing here consumes X events, and X keeps the window mapped
    # until this process destroys it or exits. A caller checks it during this window of time.
    time.sleep(max(0.0, int(args["ShowMs"] or "1200") / 1000.0))

    lib.XDestroyWindow(display, window)
    lib.XCloseDisplay(display)
    return 0


if __name__ == "__main__":
    sys.exit(main())
