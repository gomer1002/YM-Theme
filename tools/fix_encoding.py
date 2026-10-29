#!/usr/bin/env python3
"""Чинит двойную перекодировку UTF-8 -> cp1251 -> UTF-8 в текстовых файлах
и убирает BOM. Нужно после правок, сделанных Windows PowerShell 5.1.
"""
import sys


def recover(path):
    raw = open(path, "rb").read()
    text = raw.decode("utf-8-sig")
    out = []
    bad = []
    for number, line in enumerate(text.splitlines(), 1):
        try:
            out.append(line.encode("cp1251").decode("utf-8"))
        except Exception:
            out.append(line)
            if any(ord(ch) > 127 for ch in line):
                bad.append((number, line.strip()[:60]))
    data = ("\n".join(out) + "\n").encode("utf-8")
    open(path, "wb").write(data)
    print(f"{path}: {len(out)} строк, не восстановлено {len(bad)}")
    for number, sample in bad:
        print(f"   {number}: {sample}")


if __name__ == "__main__":
    for path in sys.argv[1:]:
        recover(path)
