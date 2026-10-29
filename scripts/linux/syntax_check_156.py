import concurrent.futures
import functools
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys

ROOT, SRC, OUT, WORK, JOBS, OVERLAY, FULL, *FILTERS = sys.argv[1:]
ROOT, SRC, OUT, WORK = (pathlib.Path(p).resolve() for p in (ROOT, SRC, OUT, WORK))
GEN = WORK / "gen"
PATCHED = WORK / "overlay"
LINUX = ROOT / "engine/ardiacore-linux/src"
ENGINE = ROOT / "engine/chromium/src"
ARDIA = ENGINE / "chrome/browser/ardia"
BASE = pathlib.Path(os.environ.get("AC_SERIES_BASE", SRC.parent.parent.parent / "series-base-linux-x64"))
LAYER_HEADERS = ["ac_hooks.h", "ac_content_hooks.h", "ac_launch_switches.h"]
GIT_HEADER = ("diff --git", "index ", "new file mode", "deleted file mode", "old mode", "new mode", "similarity", "rename ")


def run(cmd, cwd, check=True):
    result = subprocess.run([str(c) for c in cmd], cwd=cwd, capture_output=True, text=True)
    if check and result.returncode:
        sys.exit(f"{' '.join(map(str, cmd))} failed:\n{result.stdout}{result.stderr}")
    return result


def tree_python():
    bundled = SRC / "third_party/cpython3/host/bin/python3"
    return [bundled if bundled.exists() else sys.executable, "-B"]


def generate_mojom():
    mojo = WORK / "mojo"
    mojoms = sorted((LINUX / "ardia/linux/mojom").glob("*.mojom"))
    for sub in ("bytecode", "gen"):
        (mojo / sub).mkdir(parents=True, exist_ok=True)
    for mojom in mojoms:
        target = mojo / "src/ardia/linux/mojom" / mojom.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(mojom, target)
    (mojo / "files.rsp").write_text("".join(f"src/ardia/linux/mojom/{m.name}\n" for m in mojoms))
    (mojo / "typemap").write_text('{"c++": {}, "typescript": {}, "_metadata": {"module_typemaps": {}}}')
    py = tree_python()
    generator = SRC / "mojo/public/tools/bindings/mojom_bindings_generator.py"
    run(py + [generator, "-o", "bytecode", "--use_bundled_pylibs", "precompile", "-g", "c++"], mojo)
    run(py + [SRC / "mojo/public/tools/mojom/mojom_parser.py", "--input-root", "src", "--output-root", "gen",
              "--mojom-file-list=files.rsp", "--enable-feature", "is_posix", "--enable-feature", "is_linux"], mojo)
    generate = py + [generator, "--use_bundled_pylibs", "-o", "gen", "generate", "-d", "src", "-I", "src",
                     "--bytecode_path", "bytecode", "--filelist=files.rsp", "-g", "c++"]
    salt = ["--scrambled_message_id_salt_path", SRC / "chrome/VERSION"]
    run(generate + ["--typemap", "typemap"] + salt, mojo)
    run(generate + ["--generate_non_variant_code"], mojo)
    run(generate + ["--generate_non_variant_code", "--generate_message_ids"] + salt, mojo)
    for header in (mojo / "gen/ardia").rglob("*.h"):
        target = GEN / header.relative_to(mojo / "gen")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(header, target)


def generate_headers(ardia_sources):
    for name in LAYER_HEADERS:
        (GEN / "ardia/core").mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "engine/ardiacore/src/ardia/core" / name, GEN / "ardia/core" / name)
    py = [sys.executable, "-I", "-B"]
    run(py + [LINUX / "ardia/linux/generate_page_script.py", "--input", ROOT / "packages/ardiacore/ios/page_script.js",
              "--output", GEN / "ardia/linux/page_script.h"], WORK)
    run(py + [LINUX / "ardia/linux/generate_bootstrap.py", "--input", LINUX / "ardia/linux/bootstrap.js",
              "--output", GEN / "ardia/linux/host_bootstrap.h"], WORK)
    run(py + [ARDIA / "gen_engine_dispatch.py", "--output", GEN / "chrome/browser/ardia/ac_engine_dispatch.inc"]
        + ardia_sources, WORK)
    generate_mojom()


def linux_patches():
    for line in (ROOT / "engine/patches/series").read_text().splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] == "chromium" and (len(parts) == 2 or parts[2] == "linux"):
            yield parts[1]


def file_sections(text):
    lines = text.splitlines(keepends=True)
    starts = []
    for i in range(len(lines) - 1):
        if lines[i].startswith("--- ") and lines[i + 1].startswith("+++ "):
            start = i
            while start > 0 and lines[start - 1].startswith(GIT_HEADER):
                start -= 1
            starts.append(start)
    for n, start in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(lines)
        body = lines[start:end]
        header = next(i for i, l in enumerate(body) if l.startswith("--- "))
        new, old = body[header + 1][4:].split("\t")[0].strip(), body[header][4:].split("\t")[0].strip()
        path = new if new != "/dev/null" else old
        yield path.split("/", 1)[1], "".join(body)


def added_lines_present(section, path):
    if not path.exists():
        return False
    content = set(l.strip() for l in path.read_text(errors="surrogateescape").splitlines())
    added = [l[1:].strip() for l in section.splitlines() if l.startswith("+") and not l.startswith("+++")]
    return all(l in content for l in added if l)


@functools.lru_cache(maxsize=None)
def series_reproduces_tree(rel):
    if not (BASE / rel).is_file() or not (SRC / rel).is_file():
        return False
    root = WORK / "series-check"
    shutil.rmtree(root, ignore_errors=True)
    target = root / rel
    target.parent.mkdir(parents=True)
    shutil.copy2(BASE / rel, target)
    for name in linux_patches():
        patch = ROOT / "engine/patches" / name
        if not any(path == rel for path, _ in file_sections(patch.read_text(errors="surrogateescape"))):
            continue
        applied = subprocess.run(["git", "apply", "--whitespace=nowarn", f"--include={rel}", str(patch)], cwd=root,
                                 env=dict(os.environ, GIT_CEILING_DIRECTORIES=str(root.parent)), capture_output=True)
        if applied.returncode:
            return False
    same = target.read_bytes() == (SRC / rel).read_bytes()
    shutil.rmtree(root, ignore_errors=True)
    return same


def build_overlay():
    gaps, conflicts = {}, {}
    scratch = WORK / "section.patch"
    for name in linux_patches():
        text = (ROOT / "engine/patches" / name).read_text(errors="surrogateescape")
        for rel, section in file_sections(text):
            copy = PATCHED / rel
            if not copy.exists() and (SRC / rel).is_file():
                copy.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(SRC / rel, copy)
            scratch.write_text(section, errors="surrogateescape")
            base = ["patch", "-p1", "-s", "-f", "--no-backup-if-mismatch", "-r", "-", "-i", scratch]
            if run(base + ["-R", "--dry-run"], PATCHED, check=False).returncode == 0:
                continue
            if run(base + ["--forward", "--dry-run"], PATCHED, check=False).returncode == 0:
                run(base + ["--forward"], PATCHED)
                gaps.setdefault(name, []).append(rel)
            elif not added_lines_present(section, copy) and not series_reproduces_tree(rel):
                conflicts.setdefault(name, []).append(rel)
    scratch.unlink(missing_ok=True)
    return gaps, conflicts


def ninja_flags(ninja):
    text = (OUT / ninja).read_text()
    value = lambda name: shlex.split(re.search(r"^%s = (.*)$" % name, text, re.M).group(1))
    ours = [f"-I{LINUX}", f"-I{GEN}", f"-I{ENGINE}"] + ([f"-I{PATCHED}"] if OVERLAY == "1" else [])
    flags = value("defines") + ours + value("include_dirs") + value("cflags") + value("cflags_cc")
    return [f for f in flags if not f.startswith(("-fprofile-use", "-fcrash-diagnostics-dir"))]


def sources():
    linux_flags = ninja_flags("obj/ardia/linux/linux.ninja")
    core_ninja = "obj/ardia/core/launch_switches.ninja"
    core_flags = ninja_flags(core_ninja) if (OUT / core_ninja).exists() else linux_flags
    ardia_flags = ninja_flags("obj/chrome/browser/ardia/ardia.ninja")
    files = [(p, linux_flags) for p in sorted((LINUX / "ardia/linux").rglob("*.cc"))]
    files += [(p, core_flags) for p in sorted((LINUX / "ardia/core").rglob("*.cc"))]
    gn = (ARDIA / "BUILD.gn").read_text()
    common = re.search(r"ardia_sources = \[(.*?)\]", gn, re.S).group(1)
    linux = re.search(r"if \(is_linux\) \{\s*ardia_sources \+= \[(.*?)\]", gn, re.S).group(1)
    ardia = [ARDIA / f for f in re.findall(r'"([^"]+\.cc)"', common + linux)]
    files += [(p, ardia_flags) for p in sorted(ardia)]
    return files, [str(p) for p in ardia]


def check(item):
    path, flags = item
    clang = SRC / "third_party/llvm-build/Release+Asserts/bin/clang++"
    cmd = [clang, "-fsyntax-only", "-ferror-limit=0", "-Wno-unknown-warning-option"] + flags + [
        f"-fcrash-diagnostics-dir={WORK}", "-fno-color-diagnostics", path]
    return path, run(cmd, OUT, check=False)


def main():
    if WORK == SRC or SRC in WORK.parents:
        sys.exit("--work must be outside the Chromium tree")
    shutil.rmtree(WORK, ignore_errors=True)
    PATCHED.mkdir(parents=True)
    files, ardia_sources = sources()
    generate_headers(ardia_sources)
    gaps, conflicts = build_overlay()
    print("Series hunks the tree lacks, applied to copies under", PATCHED)
    for name, paths in gaps.items():
        print(f"  {name}: {', '.join(paths)}")
    for name, paths in conflicts.items():
        print(f"  CONFLICT {name}: {', '.join(paths)}")
    if FILTERS:
        files = [f for f in files if any(s in str(f[0]) for s in FILTERS)]
    failed = 0
    with concurrent.futures.ThreadPoolExecutor(int(JOBS)) as pool:
        for path, result in pool.map(check, files):
            rel = path.relative_to(ROOT)
            print(f"{'ok  ' if result.returncode == 0 else 'FAIL'} {rel}", flush=True)
            if result.returncode:
                failed += 1
                lines = result.stderr.splitlines()
                print(result.stderr if FULL == "1" else "\n".join(l for l in lines if "error:" in l))
    print(f"{len(files) - failed} of {len(files)} files pass")
    sys.exit(1 if failed else 0)


main()
