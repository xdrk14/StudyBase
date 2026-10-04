"""StudyBase build step. Run after adding, removing or renaming anything in files/:

    python tools/build.py

Every folder in files/ is a subject. Every .pdf or .html inside it is a note.

- New folder        -> new subject in the sidebar (name from the folder: "further-maths" -> "Further Maths")
- New file          -> added to its subject (title from the file name, or the <title> of an HTML note)
- Messy file names  -> renamed to safe lower-case-kebab names ("Pure Maths 5.pdf" -> "pure-maths-5.pdf")
- Deleted file      -> removed from the sidebar
- HTML notes        -> patched (idempotent): polyfill.io and unpinned MathJax removed, pinned MathJax 3.2.2
                       with Subresource Integrity loaded after the page's MathJax config, theme hook added

library.json keeps your edits (titles, topics, subject names, summaries and order); this script only
adds, removes and fills in sizes. library.js is generated from it so index.html also works from disk.
"""
import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ROOT / "files"
LIB = ROOT / "library.json"
LIB_JS = ROOT / "library.js"
EXTS = {".pdf", ".html"}

MATHJAX = (
    '<script id="MathJax-script" defer '
    'src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml.js" '
    'integrity="sha384-AHAnt9ZhGeHIrydA1Kp1L7FN+2UosbF7RQg6C+9Is/a7kDpQ1684C2iH2VWil6r4" '
    'crossorigin="anonymous"></script>'
)
START, END = "<!-- sb:start -->", "<!-- sb:end -->"
BLOCK = f'{START}\n{MATHJAX}\n<script src="../../app/note.js"></script>\n{END}\n'

SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("&", " and ")).strip("-") or "untitled"


def nice(s: str) -> str:
    words = re.sub(r"[-_]+", " ", s).split()
    return " ".join(w if w.isupper() or any(c.isdigit() for c in w) else w.capitalize() for w in words)


def html_title(path: pathlib.Path) -> str | None:
    m = re.search(r"<title>(.*?)</title>", path.read_text(encoding="utf-8", errors="ignore"), re.S | re.I)
    return html.unescape(m.group(1)).strip() if m else None


def patch_note(path: pathlib.Path) -> bool:
    src = path.read_text(encoding="utf-8")
    out = re.sub(re.escape(START) + r".*?" + re.escape(END) + r"\n?", "", src, flags=re.S)
    out = re.sub(r"[ \t]*<script[^>]*polyfill\.io[^>]*>\s*</script>[ \t]*\n?", "", out, flags=re.I)
    out = re.sub(r"[ \t]*<script[^>]*src=\"[^\"]*mathjax[^\"]*\"[^>]*>\s*</script>[ \t]*\n?", "", out, flags=re.I)
    if "</head>" not in out:
        print(f"  ! {path.relative_to(ROOT).as_posix()}: no </head> tag, not patched")
        return False
    out = out.replace("</head>", BLOCK + "</head>", 1)
    if out != src:
        path.write_text(out, encoding="utf-8", newline="\n")
        return True
    return False


def tidy_names() -> None:
    """Rename folders and files to safe names, remembering the original name as a title hint."""
    for d in sorted(p for p in FILES.iterdir() if p.is_dir()):
        if not SAFE_NAME.match(d.name):
            new = FILES / slug(d.name)
            if new.exists():
                sys.exit(f"cannot rename folder {d.name!r}: {new.name!r} already exists")
            TITLE_HINTS[new.name] = d.name
            d.rename(new)
            print(f"  ~ renamed folder {d.name!r} -> {new.name}")
    for f in sorted(FILES.glob("*/*")):
        if not f.is_file() or f.suffix.lower() not in EXTS:
            continue
        if SAFE_NAME.match(f.stem) and f.suffix == f.suffix.lower():
            continue
        new = f.with_name(slug(f.stem) + f.suffix.lower())
        if new.exists() and not new.samefile(f):  # samefile: case-only renames on Windows
            sys.exit(f"cannot rename {f.name!r}: {new.name!r} already exists in {f.parent.name}/")
        TITLE_HINTS[new.relative_to(ROOT).as_posix()] = f.stem
        f.rename(new)
        print(f"  ~ renamed {f.parent.name}/{f.name!r} -> {new.name}")


TITLE_HINTS: dict[str, str] = {}


def main() -> None:
    FILES.mkdir(exist_ok=True)
    for stray in sorted(FILES.glob("*")):
        if stray.is_file():
            print(f"  ! {stray.name} is not inside a subject folder: move it into files/<subject>/")
    tidy_names()

    lib = json.loads(LIB.read_text(encoding="utf-8")) if LIB.exists() else {"groups": []}
    groups = {g["folder"]: g for g in lib["groups"]}
    ordered = [g for g in lib["groups"]]

    # New subject folders
    for d in sorted(p for p in FILES.iterdir() if p.is_dir()):
        if d.name not in groups:
            g = {"name": nice(TITLE_HINTS.get(d.name, d.name)), "folder": d.name, "summary": "", "items": []}
            groups[d.name] = g
            ordered.append(g)
            print(f"  + new subject: {g['name']} (files/{d.name}/)")

    used_ids = set()
    for g in ordered:
        folder = FILES / g["folder"]
        on_disk = sorted(p for p in folder.glob("*") if p.is_file() and p.suffix in EXTS) if folder.is_dir() else []
        disk_paths = {p.relative_to(ROOT).as_posix(): p for p in on_disk}

        kept = []
        for it in g["items"]:
            if it["file"] in disk_paths:
                kept.append(it)
            else:
                print(f"  - removed {it['file']} (file no longer exists)")
        listed = {it["file"] for it in kept}
        for rel, p in disk_paths.items():
            if rel in listed:
                continue
            page_title = html_title(p) if p.suffix == ".html" else None
            title = page_title or nice(TITLE_HINTS.get(rel, p.stem))
            kept.append({"id": p.stem, "title": title, "file": rel})
            print(f"  + added {rel}")
        g["items"] = kept

        for it in g["items"]:
            base, n = it["id"], 2
            while it["id"] in used_ids:  # same file name in two subjects
                it["id"] = f"{base}-{n}"
                n += 1
            used_ids.add(it["id"])
            it["size"] = (ROOT / it["file"]).stat().st_size

    lib["groups"] = [g for g in ordered if g["items"] or (FILES / g["folder"]).is_dir()]
    for g in lib["groups"]:
        if not g["items"]:
            print(f"  ! subject {g['name']!r} is empty (files/{g['folder']}/ has no .pdf or .html)")

    patched = [p.relative_to(FILES).as_posix() for p in sorted(FILES.glob("*/*.html")) if patch_note(p)]

    LIB.write_text(json.dumps(lib, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    LIB_JS.write_text("window.SB_LIBRARY = " + json.dumps(lib, ensure_ascii=False) + ";\n", encoding="utf-8", newline="\n")
    total = sum(len(g["items"]) for g in lib["groups"])
    print(f"done: {len(lib['groups'])} subjects, {total} notes")
    if patched:
        print(f"patched notes: {', '.join(patched)}")


if __name__ == "__main__":
    main()
