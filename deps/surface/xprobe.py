#!/usr/bin/env python3
# Ask the X server about one window id, and say what it answers.
#
#   python3 deps/surface/xprobe.py <window-id>
#
# Prints one line:
#
#   viewable    the window exists and is mapped (map_state == IsViewable)
#   unmapped    the window exists and is not viewable
#   gone        no such window (the id is not in the server's tables)
#
# Why this file exists: "a window really appeared" used to be something only eyes could check.
# With the id in the receipt and this probe, it becomes a string a test can compare -- start the
# backend, read the id it printed, ask this probe, expect "viewable"; wait for the backend to
# exit, ask again, expect "gone".
#
# Same ctypes-as-Xlib approach as win.py, and the same reason: libX11 is on this machine and
# libtk is not.
#
# ASCII ONLY, comments included -- the rule for everything under deps/surface.
import ctypes
import sys

IS_VIEWABLE = 2


class XWindowAttributes(ctypes.Structure):
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


# Xlib's default error handler prints and calls exit(). For this probe a BadWindow is not an
# error -- it is the answer: the window is gone. So an error handler is installed that only
# records the fact, and XGetWindowAttributes is then allowed to return 0.
X_ERROR_HANDLER = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
_SAW_ERROR = {"flag": False}


def _on_x_error(display, event):
    _SAW_ERROR["flag"] = True
    return 0


# Kept at module level so the callback is not collected while Xlib still holds it.
_HANDLER = X_ERROR_HANDLER(_on_x_error)


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("usage: xprobe.py <window-id>\n")
        return 2
    try:
        target = int(sys.argv[1], 0)
    except ValueError:
        sys.stderr.write("not a window id: " + sys.argv[1] + "\n")
        return 2

    lib = ctypes.CDLL("libX11.so.6")
    lib.XOpenDisplay.restype = ctypes.c_void_p
    lib.XOpenDisplay.argtypes = [ctypes.c_char_p]
    lib.XSetErrorHandler.argtypes = [X_ERROR_HANDLER]
    lib.XGetWindowAttributes.argtypes = [
        ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(XWindowAttributes),
    ]
    lib.XCloseDisplay.argtypes = [ctypes.c_void_p]
    lib.XSetErrorHandler(_HANDLER)

    display = lib.XOpenDisplay(None)
    if not display:
        sys.stderr.write("cannot open the X display\n")
        return 1

    attrs = XWindowAttributes()
    ok = lib.XGetWindowAttributes(display, ctypes.c_ulong(target), ctypes.byref(attrs))
    lib.XCloseDisplay(display)

    if not ok:
        # Xlib returns 0 for a window id the server does not know. That is the "gone" answer,
        # and it is a real answer -- not an error.
        print("gone")
        return 0
    print("viewable" if attrs.map_state == IS_VIEWABLE else "unmapped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
