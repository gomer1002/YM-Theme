#!/usr/bin/env python3
"""Minimal ASAR reader/writer (no external deps).

Usage:
  python asar.py list  <archive.asar>
  python asar.py extract <archive.asar> <outdir> [--only /app,/index.js]
  python asar.py pack <sourcedir> <out.asar>

The archive layout (Electron "asar"):
  uint32 = 4                      (pickle payload length of the size field)
  uint32 = headerBufLen           (length of the header pickle)
  headerBuf: uint32 payloadLen, uint32 jsonLen, json, padding to 4
  file data, offsets relative to header end
"""
import json
import os
import struct
import sys

PAD = b"\x00"


def read_header(path):
    with open(path, "rb") as f:
        f.seek(4)
        hlen = struct.unpack("<I", f.read(6 - 2))[0]
        header_buf = f.read(hlen)
    strlen = struct.unpack("<I", header_buf[4:8])[0]
    header = json.loads(header_buf[8:8 + strlen].decode("utf-8"))
    base = 8 + hlen
    return header, base


def walk(node, prefix=""):
    for name, entry in node.get("files", {}).items():
        path = prefix + "/" + name
        if "files" in entry:
            yield from walk(entry, path)
        else:
            yield path, entry


def cmd_list(archive):
    header, base = read_header(archive)
    total = 0
    for path, entry in walk(header):
        size = entry.get("size", 0)
        total += size
        print(f"{size:>12}  {path}")
    print(f"{total:>12}  TOTAL")


def cmd_extract(archive, outdir, only=None):
    header, base = read_header(archive)
    prefixes = [p.strip() for p in only.split(",")] if only else None
    with open(archive, "rb") as f:
        for path, entry in walk(header):
            if prefixes and not any(path == p or path.startswith(p.rstrip("/") + "/") for p in prefixes):
                continue
            rel = path.lstrip("/")
            dest = os.path.join(outdir, rel.replace("/", os.sep))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            f.seek(base + int(entry["offset"]))
            data = f.read(entry.get("size", 0))
            with open(dest, "wb") as out:
                out.write(data)
            print(f"extracted {path} ({len(data)} bytes)")


def _collect(root):
    """Build the asar header tree for a directory, mirroring asar's ordering."""
    tree = {"files": {}}
    for name in sorted(os.listdir(root)):
        full = os.path.join(root, name)
        if os.path.isdir(full):
            tree["files"][name] = _collect(full)
        elif os.path.isfile(full):
            tree["files"][name] = {"size": os.path.getsize(full), "offset": "0"}
    return tree


def _assign_offsets(tree, state):
    for name in sorted(tree["files"]):
        entry = tree["files"][name]
        if "files" in entry:
            _assign_offsets(entry, state)
        else:
            entry["offset"] = str(state["offset"])
            state["offset"] += entry["size"]


def _write_files(tree, root, out):
    for name in sorted(tree["files"]):
        entry = tree["files"][name]
        full = os.path.join(root, name)
        if "files" in entry:
            _write_files(entry, full, out)
        else:
            with open(full, "rb") as f:
                data = f.read()
            if len(data) != entry["size"]:
                raise SystemExit(f"size changed while packing: {full}")
            out.write(data)


def cmd_pack(srcdir, archive):
    tree = {"files": {}}
    root_entries = sorted(os.listdir(srcdir))
    for name in root_entries:
        full = os.path.join(srcdir, name)
        if os.path.isdir(full):
            tree["files"][name] = _collect(full)
        elif os.path.isfile(full):
            tree["files"][name] = {"size": os.path.getsize(full), "offset": "0"}

    _assign_offsets(tree, {"offset": 0})

    payload = json.dumps(tree, separators=(",", ":")).encode("utf-8")
    while len(payload) % 4:
        payload += PAD
    header_buf = struct.pack("<I", len(payload)) + payload
    size_buf = struct.pack("<II", 4, len(header_buf))

    with open(archive, "wb") as out:
        out.write(size_buf)
        out.write(header_buf)
        _write_files(tree, srcdir, out)
    print(f"packed {archive}: {os.path.getsize(archive)} bytes")


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    cmd = argv[1]
    if cmd == "list":
        cmd_list(argv[2])
    elif cmd == "extract":
        only = None
        if "--only" in argv:
            only = argv[argv.index("--only") + 1]
        cmd_extract(argv[2], argv[3], only)
    elif cmd == "pack":
        cmd_pack(argv[2], argv[3])
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
