import json
import shutil
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GLib, Gtk

URI_LIST = 2


def log(path, event):
    with open(path, "a", encoding="utf-8") as out:
        out.write(json.dumps(event) + "\n")


def target(title, log_path, folder):
    window = Gtk.Window(title=title)
    window.set_default_size(600, 500)
    area = Gtk.EventBox()
    label = Gtk.Label(label="Drop files here")
    area.add(label)
    window.add(area)
    area.drag_dest_set(Gtk.DestDefaults.ALL, [], Gdk.DragAction.COPY)
    area.drag_dest_add_uri_targets()
    area.drag_dest_add_text_targets()

    def motion(widget, context, x, y, time):
        log(log_path, {"event": "motion", "x": x, "y": y})
        return False

    def received(widget, context, x, y, data, info, time):
        uris = data.get_uris() or []
        text = data.get_text()
        copied = []
        for uri in uris:
            parsed = urlparse(uri)
            if parsed.scheme == "file":
                source = Path(unquote(parsed.path))
                destination = Path(folder) / source.name
                shutil.copyfile(source, destination)
                copied.append(str(destination))
        log(log_path, {"event": "drop", "uris": uris, "text": text, "copied": copied, "target": data.get_target().name()})
        label.set_text(f"Dropped {len(uris)}")

    area.connect("drag-motion", motion)
    area.connect("drag-data-received", received)
    return window


def source(title, log_path, files):
    window = Gtk.Window(title=title)
    window.set_default_size(600, 500)
    area = Gtk.EventBox()
    area.add(Gtk.Label(label=f"Drag {len(files)} file(s)"))
    window.add(area)
    area.drag_source_set(Gdk.ModifierType.BUTTON1_MASK, [], Gdk.DragAction.COPY | Gdk.DragAction.MOVE | Gdk.DragAction.LINK)
    area.drag_source_add_uri_targets()
    uris = [Path(f).resolve().as_uri() for f in files]

    def begin(widget, context):
        log(log_path, {"event": "begin"})

    def get(widget, context, data, info, time):
        data.set_uris(uris)
        log(log_path, {"event": "get", "uris": uris})

    def end(widget, context):
        log(log_path, {"event": "end"})

    def failed(widget, context, result):
        log(log_path, {"event": "failed", "result": int(result)})
        return False

    area.connect("drag-begin", begin)
    area.connect("drag-data-get", get)
    area.connect("drag-end", end)
    area.connect("drag-failed", failed)
    return window


def main():
    mode, title, log_path = sys.argv[1], sys.argv[2], sys.argv[3]
    window = target(title, log_path, sys.argv[4]) if mode == "target" else source(title, log_path, sys.argv[4:])
    window.connect("destroy", Gtk.main_quit)
    window.show_all()
    GLib.timeout_add(300, lambda: log(log_path, {"event": "ready"}) and False)
    Gtk.main()


main()
