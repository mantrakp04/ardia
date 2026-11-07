import argparse
import pathlib
import re


CALL = re.compile(r"^AC_(?:ENGINE|PROFILE|ARGS)_CALL\((ac_[a-z0-9_]+)\b[^;{]*\{", re.MULTILINE)


def service_names(paths):
    names = {}
    for path in paths:
        for name in CALL.findall(pathlib.Path(path).read_text()):
            if name in names:
                raise ValueError(f"duplicate service {name}: {names[name]} and {path}")
            names[name] = path
    if not names:
        raise ValueError("no engine services found")
    return sorted(names)


def registry(names):
    declarations = [
        f'extern "C" AC_ENGINE_EXPORT void {name}(const char*, const char*, '
        "ac_engine_reply_t, void*);"
        for name in names
    ]
    entries = [f'  {{"{name}", &{name}}},' for name in names]
    return "\n".join(
        declarations + ["", "namespace {", "constexpr Entry kCalls[] = {"]
        + entries + ["};", "}", ""]
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("sources", nargs="+")
    args = parser.parse_args()
    output = registry(service_names(args.sources))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(output)


if __name__ == "__main__":
    main()
