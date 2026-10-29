#!/usr/bin/env python3
"""Собирает пропатченный app.asar: оригинальный main-процесс + загрузчик темы.

Использование:
    python tools/make_patched_asar.py \
        --src  path\\to\\app.asar.orig \
        --dst  path\\to\\app.asar.patched \
        --live-dir  C:\\...\\YaMusicCustom\\theme_live \
        --theme-copy C:\\...\\YandexMusic\\theme
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import repack  # noqa: E402

MARKER = "YaMusicCustom:loader"
PLACEHOLDER = "__THEME_DIRS__"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True, help="оригинальный app.asar")
    parser.add_argument("--dst", required=True, help="куда положить результат")
    parser.add_argument(
        "--live-dir",
        default=None,
        help="папка для живой отладки (обычно <проект>\\theme_live)",
    )
    parser.add_argument(
        "--theme-copy",
        required=True,
        help="папка с копией темы рядом с приложением",
    )
    parser.add_argument("--loader", default=None, help="путь к loader.js")
    parser.add_argument(
        "--app-name",
        default=None,
        help="тестовая переименовка приложения (отдельный профиль и single-instance lock)",
    )
    args = parser.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    loader_path = args.loader or os.path.join(root, "src", "loader.js")

    header, base = repack.read_archive(args.src)
    files = dict(repack.collect(header, base, args.src, {}))

    if "/index.js" not in files:
        sys.exit("в архиве нет /index.js")

    with open(loader_path, "r", encoding="utf-8") as f:
        loader = f.read()
    if PLACEHOLDER not in loader:
        sys.exit("в loader.js нет плейсхолдера " + PLACEHOLDER)

    # порядок важен: сначала папка живой отладки, если её нет — копия у приложения
    theme_dirs = []
    if args.live_dir:
        theme_dirs.append(os.path.abspath(args.live_dir))
    theme_dirs.append(os.path.abspath(args.theme_copy))
    loader = loader.replace(PLACEHOLDER, json.dumps(theme_dirs))

    index_js = files["/index.js"].decode("utf-8")
    if MARKER in index_js:
        sys.exit("index.js уже пропатчен — используйте оригинальный app.asar")

    patched = (index_js + "\n\n" + loader + "\n").encode("utf-8")

    replacements = {"/index.js": patched}
    if args.app_name:
        package = json.loads(files["/package.json"].decode("utf-8"))
        package["name"] = args.app_name
        package["productName"] = args.app_name
        replacements["/package.json"] = json.dumps(package, indent=2, ensure_ascii=False).encode("utf-8")
        print(f"app name: {args.app_name}")

    print(f"index.js: {len(index_js)} -> {len(patched)} байт")
    print("папки темы (по приоритету): " + ", ".join(theme_dirs))

    repack.patch(args.src, args.dst, replacements)

    before = repack.load_manifest(args.src)
    after = repack.load_manifest(args.dst)
    assert before.keys() == after.keys(), "набор файлов изменился"
    changed = [p for p in before if before[p] != after[p]]
    print(f"файлов в архиве: {len(after)}, изменено: {changed}")
    print(f"готово: {args.dst} ({os.path.getsize(args.dst)} байт)")


if __name__ == "__main__":
    main()
