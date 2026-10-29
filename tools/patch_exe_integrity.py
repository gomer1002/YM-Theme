#!/usr/bin/env python3
"""Подмена встроенного хеша asar-заголовка внутри exe.

Electron с включённой фьюзой EnableEmbeddedAsarIntegrityValidation сверяет
SHA-256 заголовка app.asar со строкой, вшитой в бинарник. Если мы
пересобираем архив, хеш нужно обновить и там.

    python tools/patch_exe_integrity.py --exe <exe> --old <app.asar.orig> --new <app.asar.new>
"""
import argparse
import hashlib
import os
import shutil
import struct
import sys


def header_hash(archive):
    with open(archive, "rb") as f:
        f.seek(4)
        header_len = struct.unpack("<I", f.read(4))[0]
        header_buf = f.read(header_len)
    json_len = struct.unpack("<I", header_buf[4:8])[0]
    payload = header_buf[8:8 + json_len]
    return hashlib.sha256(payload).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True)
    parser.add_argument("--old", help="текущий app.asar")
    parser.add_argument("--new", help="пересобранный app.asar")
    parser.add_argument("--verify", action="store_true", help="только проверить, что хеш exe совпадает с asar")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.verify:
        if not args.old:
            sys.exit("--verify требует --old <app.asar>")
        expected = header_hash(args.old)
        with open(args.exe, "rb") as f:
            data = f.read()
        found = data.find(expected.encode("ascii")) >= 0
        print(f"asar header sha256: {expected}")
        print("exe содержит этот хеш" if found else "exe НЕ содержит этот хеш — патч exe не применён")
        return 0 if found else 2

    if not (args.old and args.new):
        sys.exit("нужны --old и --new (или --verify)")

    old_hash = header_hash(args.old)
    new_hash = header_hash(args.new)
    print(f"old header sha256: {old_hash}")
    print(f"new header sha256: {new_hash}")

    if old_hash == new_hash:
        print("хеши совпадают — править exe не нужно")
        return 0

    with open(args.exe, "rb") as f:
        data = bytearray(f.read())

    old_bytes = old_hash.encode("ascii")
    hits = []
    start = 0
    while True:
        index = data.find(old_bytes, start)
        if index < 0:
            break
        hits.append(index)
        start = index + 1

    if not hits:
        sys.exit("в exe не найден встроенный хеш — сборка устроена иначе, exe не трогаю")
    print(f"вхождений в exe: {len(hits)} -> {hits}")

    for index in hits:
        data[index:index + len(old_bytes)] = new_hash.encode("ascii")

    if args.dry_run:
        print("dry-run: файл не изменён")
        return 0

    backup = args.exe + ".orig"
    if not os.path.exists(backup):
        shutil.copy2(args.exe, backup)
        print(f"бэкап: {backup}")

    with open(args.exe, "wb") as f:
        f.write(data)
    print(f"exe обновлён: {args.exe}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
