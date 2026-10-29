#!/usr/bin/env python3
"""Пересборка app.asar с подменой отдельных файлов.

Читает оригинальный архив и пишет новый: все файлы копируются как есть,
для указанных путей подставляется новое содержимое. Заголовок собирается
заново: заново считаются offset'ы, размеры и поля integrity (Electron
проверяет их, если в exe включена фьюза EnableEmbeddedAsarIntegrityValidation;
так и есть в сборке Яндекс Музыки, поэтому хеш заголовка потом нужно
прописать в exe — см. tools/patch_exe_integrity.py).
"""
import hashlib
import json
import os
import struct
import sys

PAD = b"\x00"


def read_archive(path):
    with open(path, "rb") as f:
        f.seek(4)
        header_len = struct.unpack("<I", f.read(4))[0]
        header_buf = f.read(header_len)
    json_len = struct.unpack("<I", header_buf[4:8])[0]
    header = json.loads(header_buf[8:8 + json_len].decode("utf-8"))
    return header, 8 + header_len


def walk(node, prefix=""):
    for name, entry in node.get("files", {}).items():
        path = prefix + "/" + name
        if "files" in entry:
            yield from walk(entry, path)
        else:
            yield path, entry


def collect(header, base, asar_path, replacements):
    """Возвращает список (path, data) в исходном порядке архива."""
    files = []
    with open(asar_path, "rb") as f:
        for path, entry in walk(header):
            if path in replacements:
                data = replacements[path]
            else:
                f.seek(base + int(entry["offset"]))
                data = f.read(entry.get("size", 0))
            files.append((path, data))
    return files


def compute_integrity(data, template=None):
    """Пересчитывает поле integrity так же, как это делает asar.

    Electron проверяет его при чтении файла, если архив собран с integrity.
    """
    algorithm = (template or {}).get("algorithm", "SHA256")
    block_size = int((template or {}).get("blockSize", 4 * 1024 * 1024))
    digest = hashlib.sha256 if algorithm.upper() == "SHA256" else hashlib.sha1
    blocks = []
    for start in range(0, len(data), block_size):
        blocks.append(digest(data[start:start + block_size]).hexdigest())
    if not blocks:
        blocks = [digest(b"").hexdigest()]
    return {
        "algorithm": algorithm,
        "hash": blocks[0],
        "blockSize": block_size,
        "blocks": blocks,
    }


def build_tree(files, entries):
    """files: [(path, data)], entries: {path: исходная запись заголовка}."""
    tree = {"files": {}}
    for path, data in files:
        parts = [p for p in path.split("/") if p]
        node = tree
        for part in parts[:-1]:
            node = node["files"].setdefault(part, {"files": {}})
        source = dict(entries.get(path, {}))
        source.pop("offset", None)
        if "integrity" in source:
            source["integrity"] = compute_integrity(data, entries[path].get("integrity"))
        source["size"] = len(data)
        source["offset"] = "0"
        node["files"][parts[-1]] = source
    return tree


def assign_offsets(tree):
    counter = {"offset": 0}

    def put(node):
        for name in node["files"]:
            entry = node["files"][name]
            if "files" in entry:
                put(entry)
            else:
                entry["offset"] = str(counter["offset"])
                counter["offset"] += entry["size"]

    put(tree)


def write_archive(files, tree, out_path):
    # asar: uint32(4) | uint32(headerBufLen) | headerBuf
    # headerBuf = uint32(payloadLen) | payload, payload = uint32(jsonLen) | json | pad
    json_bytes = json.dumps(tree, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    payload = struct.pack("<I", len(json_bytes)) + json_bytes
    while len(payload) % 4:
        payload += PAD
    header_buf = struct.pack("<I", len(payload)) + payload
    size_buf = struct.pack("<II", 4, len(header_buf))
    with open(out_path, "wb") as out:
        out.write(size_buf)
        out.write(header_buf)
        for _, data in files:
            out.write(data)


def patch(src, dst, replacements):
    header, base = read_archive(src)
    files = collect(header, base, src, replacements)
    tree = build_tree(files, dict(walk(header)))
    assign_offsets(tree)
    write_archive(files, tree, dst)
    return header


def load_manifest(path):
    """Проверка: список путей/размеров нового архива против оригинала."""
    header, _ = read_archive(path)
    return {p: int(e.get("size", 0)) for p, e in walk(header)}


def main(argv):
    if len(argv) < 5:
        print(__doc__)
        print("usage: repack.py <src.asar> <dst.asar> <archive-path-in-asar> <new-content-file>")
        return 1
    src, dst, arc_path, content = argv[1:5]
    with open(content, "rb") as f:
        data = f.read()
    patch(src, dst, {arc_path: data})
    before = load_manifest(src)
    after = load_manifest(dst)
    assert before.keys() == after.keys(), "набор файлов изменился"
    changed = [p for p in before if before[p] != after[p]]
    print(f"ok: {len(after)} files, changed: {changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
