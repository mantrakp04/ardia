import hashlib
import json
import os
import re
import sys
import zlib

SEPARATOR = "[^a-zA-Z0-9_.%-]"
HOST_ANCHOR = "^[^:]+://+([^:/]+\\.)?"
REGEX_SPECIALS = set(".*+?()[]\\$^|{}")
SIMPLE_TYPES = {
    "stylesheet": "style-sheet",
    "script": "script",
    "image": "image",
    "font": "font",
    "media": "media",
    "xmlhttprequest": "raw",
    "websocket": "raw",
    "webtransport": "raw",
    "webbundle": "raw",
    "object": "raw",
    "other": "raw",
    "ping": "ping",
    "csp_report": "ping",
}
ALL_SUBRESOURCES = ["stylesheet", "script", "image", "font", "media", "xmlhttprequest", "websocket", "object", "other", "ping", "sub_frame"]
BLOCKABLE_REDIRECTS = re.compile(r"^/web_accessible_resources/(noop[\w.-]*|1x1\.gif|2x2\.png|3x2\.png|32x32\.png|empty)$")
MAX_VARIANTS = 64
MAX_SELECTORS_PER_RULE = 48


def is_ascii(text):
    return all(ord(c) < 128 for c in text)


def url_filter_patterns(url_filter):
    if not is_ascii(url_filter):
        return []
    text = url_filter
    prefix = ""
    host_anchored = False
    if text.startswith("||"):
        prefix, text, host_anchored = HOST_ANCHOR, text[2:], True
    elif text.startswith("|"):
        prefix, text = "^", text[1:]
    suffix = ""
    if text.endswith("|") and not text.endswith("\\|"):
        suffix, text = "$", text[:-1]
    trailing_separator = text.endswith("^") and not suffix
    if trailing_separator:
        text = text[:-1]
    while text.startswith("*") and not prefix:
        text = text[1:]
    while text.endswith("*") and not suffix and not trailing_separator:
        text = text[:-1]
    body = []
    for ch in text:
        if ch == "*":
            body.append(".*")
        elif ch == "^":
            body.append(SEPARATOR)
        elif ch in REGEX_SPECIALS:
            body.append("\\" + ch)
        else:
            body.append(ch)
    core = prefix + "".join(body)
    if trailing_separator:
        host_only = host_anchored and re.fullmatch(r"[A-Za-z0-9.-]+", text) is not None
        if host_only:
            return [core + SEPARATOR]
        return [core + SEPARATOR, core + "$"]
    pattern = core + suffix
    return [pattern if pattern else ".*"]


class RegexUnsupported(Exception):
    pass


def parse_regex(source):
    pos = 0

    def parse_alternatives():
        nonlocal pos
        branches = [[]]
        while pos < len(source):
            ch = source[pos]
            if ch == ")":
                break
            if ch == "|":
                pos += 1
                branches.append([])
                continue
            atom = parse_atom()
            atom = parse_quantifier(atom)
            branches[-1].append(atom)
        return branches

    def parse_atom():
        nonlocal pos
        ch = source[pos]
        if ch == "(":
            pos += 1
            if source.startswith("?:", pos):
                pos += 2
            elif source.startswith("?", pos):
                raise RegexUnsupported("lookaround or named group")
            branches = parse_alternatives()
            if pos >= len(source) or source[pos] != ")":
                raise RegexUnsupported("unbalanced group")
            pos += 1
            return ("group", branches)
        if ch == "[":
            end = pos + 1
            if end < len(source) and source[end] == "^":
                end += 1
            if end < len(source) and source[end] == "]":
                end += 1
            while end < len(source) and source[end] != "]":
                end += 2 if source[end] == "\\" else 1
            if end >= len(source):
                raise RegexUnsupported("unbalanced class")
            body = source[pos + 1:end]
            pos = end + 1
            return ("text", "[" + translate_class(body) + "]")
        if ch == "\\":
            if pos + 1 >= len(source):
                raise RegexUnsupported("dangling escape")
            nxt = source[pos + 1]
            pos += 2
            if nxt == "d":
                return ("text", "[0-9]")
            if nxt == "w":
                return ("text", "[a-zA-Z0-9_]")
            if nxt in "DWSsbBpPkQEAzZ0123456789xuc":
                raise RegexUnsupported("escape \\" + nxt)
            if nxt in REGEX_SPECIALS:
                return ("text", "\\" + nxt)
            return ("text", nxt)
        if ch == "^":
            pos += 1
            return ("start", None)
        if ch == "$":
            pos += 1
            return ("end", None)
        if ch in "*+?{":
            raise RegexUnsupported("quantifier without atom")
        pos += 1
        return ("text", ch)

    def parse_quantifier(atom):
        nonlocal pos
        if pos >= len(source):
            return atom
        ch = source[pos]
        if ch in "*+?":
            pos += 1
            if pos < len(source) and source[pos] in "?+":
                pos += 1
            return ("quant", atom, ch)
        if ch == "{":
            match = re.match(r"\{(\d+)(,(\d*))?\}", source[pos:])
            if not match:
                raise RegexUnsupported("bad brace")
            pos += len(match.group(0))
            low = int(match.group(1))
            high = low if match.group(2) is None else (None if match.group(3) == "" else int(match.group(3)))
            return ("repeat", atom, low, high)
        return atom

    def translate_class(body):
        out = []
        i = 0
        while i < len(body):
            c = body[i]
            if c == "\\" and i + 1 < len(body):
                n = body[i + 1]
                if n == "d":
                    out.append("0-9")
                elif n == "w":
                    out.append("a-zA-Z0-9_")
                elif n in "DWSsbBpP":
                    raise RegexUnsupported("class escape \\" + n)
                elif n in "]\\-^":
                    out.append("\\" + n)
                else:
                    out.append(n)
                i += 2
                continue
            out.append(c)
            i += 1
        return "".join(out)

    branches = parse_alternatives()
    if pos != len(source):
        raise RegexUnsupported("trailing input")
    return ("group", branches)


def render(node):
    kind = node[0]
    if kind == "text":
        return [node[1]]
    if kind == "start":
        return ["\x00"]
    if kind == "end":
        return ["\x01"]
    if kind == "group":
        out = []
        for branch in node[1]:
            variants = [""]
            for atom in branch:
                pieces = render(atom)
                variants = [v + p for v in variants for p in pieces]
                if len(variants) > MAX_VARIANTS:
                    raise RegexUnsupported("too many variants")
            out.extend(variants)
        if len(out) > MAX_VARIANTS:
            raise RegexUnsupported("too many variants")
        return out
    if kind == "quant":
        inner = render(node[1])
        if len(inner) != 1 or "\x00" in inner[0] or "\x01" in inner[0]:
            raise RegexUnsupported("quantified alternation")
        return [wrap(inner[0]) + node[2]]
    if kind == "repeat":
        inner = render(node[1])
        if len(inner) != 1 or "\x00" in inner[0] or "\x01" in inner[0]:
            raise RegexUnsupported("repeated alternation")
        unit = wrap(inner[0])
        low, high = node[2], node[3]
        if low > 40:
            raise RegexUnsupported("long repeat")
        text = unit * low
        if high is None:
            text += unit + "*"
        elif high - low > 32:
            raise RegexUnsupported("long bounded repeat")
        else:
            text += (unit + "?") * (high - low)
        return [text]
    raise RegexUnsupported(kind)


def wrap(text):
    if len(text) == 1 or (text.startswith("\\") and len(text) == 2):
        return text
    if text.startswith("[") and text.endswith("]") and text.count("[") == 1:
        return text
    return "(" + text + ")"


def regex_patterns(regex):
    if not is_ascii(regex):
        return []
    try:
        variants = render(parse_regex(regex))
    except RegexUnsupported:
        return []
    out = []
    for v in variants:
        starts = v.startswith("\x00")
        ends = v.endswith("\x01")
        core = v[1:] if starts else v
        core = core[:-1] if ends else core
        if "\x00" in core or "\x01" in core:
            continue
        if "|" in core.replace("\\|", ""):
            continue
        out.append(("^" if starts else "") + core + ("$" if ends else ""))
    return out


def domains(names):
    return sorted({"*" + n.lower() for n in names if is_ascii(n) and n and not n.endswith(".*")})


def host_patterns(names):
    out = []
    for n in names:
        if not is_ascii(n) or not n:
            continue
        escaped = "".join("\\" + c if c in REGEX_SPECIALS else c for c in n.lower())
        out.append(HOST_ANCHOR + escaped + "[:/]")
    return out


def type_groups(condition):
    if "resourceTypes" in condition:
        types = [t for t in condition["resourceTypes"]]
    elif "excludedResourceTypes" in condition:
        excluded = set(condition["excludedResourceTypes"])
        raw_excluded = any(SIMPLE_TYPES.get(t) == "raw" for t in excluded)
        types = [t for t in ALL_SUBRESOURCES if t not in excluded and not (raw_excluded and SIMPLE_TYPES.get(t) == "raw")]
        if not types:
            return []
    else:
        return [None]
    groups = []
    simple = sorted({SIMPLE_TYPES[t] for t in types if t in SIMPLE_TYPES})
    if simple:
        groups.append({"resource-type": simple})
    if "sub_frame" in types:
        groups.append({"resource-type": ["document"], "load-context": ["child-frame"]})
    return groups


def triggers(rule):
    condition = rule["condition"]
    if condition.get("requestMethods") or condition.get("excludedRequestMethods") or condition.get("responseHeaders"):
        return []
    if condition.get("topDomains") or condition.get("excludedTopDomains") or condition.get("tabIds"):
        return []
    patterns = []
    if "urlFilter" in condition:
        patterns = url_filter_patterns(condition["urlFilter"])
    elif "regexFilter" in condition:
        patterns = regex_patterns(condition["regexFilter"])
    else:
        patterns = [".*"]
    if "requestDomains" in condition:
        if "urlFilter" in condition or "regexFilter" in condition:
            return []
        patterns = host_patterns(condition["requestDomains"])
    if not patterns:
        return []
    base = {}
    if condition.get("isUrlFilterCaseSensitive"):
        base["url-filter-is-case-sensitive"] = True
    if condition.get("domainType") == "firstParty":
        base["load-type"] = ["first-party"]
    elif condition.get("domainType") == "thirdParty":
        base["load-type"] = ["third-party"]
    if "initiatorDomains" in condition:
        names = domains(condition["initiatorDomains"])
        if not names:
            return []
        base["if-domain"] = names
    elif "excludedInitiatorDomains" in condition:
        names = domains(condition["excludedInitiatorDomains"])
        if names:
            base["unless-domain"] = names
    groups = type_groups(condition)
    if not groups:
        return []
    out = []
    for pattern in patterns:
        for group in groups:
            trigger = {"url-filter": pattern}
            trigger.update(base)
            if group:
                trigger.update(group)
            out.append(trigger)
    return out


def exclusion_triggers(rule, made):
    condition = rule["condition"]
    extra = []
    if "excludedRequestDomains" in condition:
        for trigger in made:
            for host in host_patterns(condition["excludedRequestDomains"]):
                t = {k: v for k, v in trigger.items() if k != "url-filter"}
                t["url-filter"] = host
                extra.append(t)
    if "initiatorDomains" in condition and "excludedInitiatorDomains" in condition:
        names = domains(condition["excludedInitiatorDomains"])
        for trigger in made:
            if names:
                t = dict(trigger)
                t["if-domain"] = names
                extra.append(t)
    return extra


def convert_network(rules, stats):
    prefix, block, allow = [], [], []
    for rule in rules:
        action = rule["action"]["type"]
        condition = rule["condition"]
        types = condition.get("resourceTypes")
        if types and set(types) <= {"main_frame"}:
            stats["skipped"] += 1
            continue
        if types and "main_frame" in types:
            condition = dict(condition, resourceTypes=[t for t in types if t != "main_frame"])
            rule = dict(rule, condition=condition)
        if action == "redirect":
            path = rule["action"].get("redirect", {}).get("extensionPath", "")
            if not BLOCKABLE_REDIRECTS.match(path):
                stats["skipped"] += 1
                continue
            action = "block"
        priority = int(rule.get("priority", 1))
        if action == "upgradeScheme":
            made = triggers(rule)
            block.extend((priority, {"trigger": t, "action": {"type": "make-https"}}) for t in made)
            continue
        if action not in ("block", "allow"):
            stats["skipped"] += 1
            continue
        made = triggers(rule)
        if not made:
            stats["skipped"] += 1
            continue
        stats["converted"] += 1
        wk = "block" if action == "block" else "ignore-previous-rules"
        exclusions = exclusion_triggers(rule, made)
        if exclusions and action == "allow":
            stats["converted"] -= 1
            stats["skipped"] += 1
            continue
        if exclusions:
            group = [{"trigger": t, "action": {"type": wk}} for t in made]
            group += [{"trigger": t, "action": {"type": "ignore-previous-rules"}} for t in exclusions]
            prefix.append((priority, group))
            continue
        target = block if action == "block" else allow
        target.extend((priority, {"trigger": t, "action": {"type": wk}}) for t in made)
    return prefix, block, allow


PROCEDURAL = re.compile(r":(-abp-|has-text|xpath|matches-|upward|remove|style|watch-attr|min-text-length|others|spath|if|if-not)\b")


def css_ok(selector):
    return bool(selector) and not selector.startswith("{") and is_ascii(selector) and not PROCEDURAL.search(selector)


def chunks(items, size):
    return [items[i:i + size] for i in range(0, len(items), size)]


def hide_rules(selectors, trigger):
    out = []
    for group in chunks(sorted(selectors), MAX_SELECTORS_PER_RULE):
        out.append({"trigger": dict(trigger), "action": {"type": "css-display-none", "selector": ", ".join(group)}})
    return out


def under(host, parent):
    return host == parent or host.endswith("." + parent)


def read_specific(data):
    selectors = data["selectors"]
    positive = {}
    negative = {}
    for host, ref in zip(data["hostnames"], data["selectorListRefs"]):
        if host.endswith(".*") or not is_ascii(host):
            continue
        for index in json.loads("[" + data["selectorLists"][ref] + "]"):
            if index >= 0:
                positive.setdefault(selectors[index], set()).add(host.lower())
            else:
                negative.setdefault(selectors[~index], set()).add(host.lower())
    return positive, negative


def convert_specific(positive, unhide):
    by_domains = {}
    for selector, hosts in positive.items():
        if not css_ok(selector):
            continue
        excluded = unhide.get(selector, set())
        names = []
        for host in sorted(hosts):
            if any(under(host, e) for e in excluded):
                continue
            exact = any(under(e, host) for e in excluded)
            names.append(host if exact else "*" + host)
        if names:
            by_domains.setdefault(tuple(names), []).append(selector)
    rules = []
    for names, group in sorted(by_domains.items()):
        rules.extend(hide_rules(group, {"url-filter": ".*", "if-domain": list(names)}))
    return rules


def js_value(source, name):
    match = re.search(r"const " + name + r" = (?:/\* \d+ \*/)?", source)
    if not match:
        return None
    decoder = json.JSONDecoder()
    start = match.end()
    if source.startswith("new Map(", start):
        start += len("new Map(")
        rest = source[start:]
        rest = re.sub(r"^/\* \d+ \*/", "", rest)
        if rest.startswith("undefined") or rest.startswith(")"):
            return None
        value, _ = decoder.raw_decode(rest)
        return value
    value, _ = decoder.raw_decode(source[start:])
    return value


def read_generic(source):
    lowly = js_value(source, "lowlyGeneric") or []
    highly = js_value(source, "highlyGeneric") or ""
    exceptions = js_value(source, "exceptions") or []
    hostnames = js_value(source, "hostnames") or []
    unhide = {}
    for text, host in zip(exceptions, hostnames):
        if host.endswith(".*") or not is_ascii(host):
            continue
        for selector in text.split("\n"):
            unhide.setdefault(selector.strip().rstrip(","), set()).add(host.lower())
    every = []
    for _, text in lowly:
        every.extend(s.strip().rstrip(",") for s in text.split("\n"))
    every.extend(s.strip().rstrip(",") for s in highly.split("\n"))
    return list(dict.fromkeys(every)), unhide


def convert_generic(selectors, unhide):
    plain, scoped = [], {}
    for selector in selectors:
        if not css_ok(selector):
            continue
        hosts = unhide.get(selector)
        if hosts:
            scoped.setdefault(tuple(sorted("*" + h for h in hosts)), []).append(selector)
        else:
            plain.append(selector)
    rules = hide_rules(plain, {"url-filter": ".*"})
    for names, group in sorted(scoped.items()):
        rules.extend(hide_rules(group, {"url-filter": ".*", "unless-domain": list(names)}))
    return rules


def write_rules(path, sections):
    lines = []
    for tag, rules in sections:
        for priority, rule in rules:
            group = rule if isinstance(rule, list) else [rule]
            text = ",".join(json.dumps(r, separators=(",", ":"), sort_keys=True) for r in group)
            lines.append(tag + str(priority) + "\t" + text)
    raw = ("\n".join(lines) + "\n").encode()
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
    open(path, "wb").write(compressor.compress(raw) + compressor.flush())
    return raw


def main():
    ext, out, version = sys.argv[1], sys.argv[2], sys.argv[3]
    rulesets_dir = os.path.join(ext, "rulesets")
    details = json.load(open(os.path.join(rulesets_dir, "ruleset-details.json")))
    os.makedirs(out, exist_ok=True)
    manifest = {"version": version, "rulesets": []}
    digest = hashlib.sha256()
    details = [d for d in details if d["id"] not in ("ubol-tests", "ublock-experimental")]
    cosmetics = {}
    unhide = {}
    for detail in details:
        rid = detail["id"]
        positive, generic = {}, []
        specific_path = os.path.join(rulesets_dir, "scripting", "specific", rid + ".json")
        if os.path.exists(specific_path):
            positive, negative = read_specific(json.load(open(specific_path)))
            for selector, hosts in negative.items():
                unhide.setdefault(selector, set()).update(hosts)
        generic_path = os.path.join(rulesets_dir, "scripting", "generic", rid + ".js")
        if os.path.exists(generic_path):
            generic, exceptions = read_generic(open(generic_path).read())
            for selector, hosts in exceptions.items():
                unhide.setdefault(selector, set()).update(hosts)
        cosmetics[rid] = (positive, generic)
    for detail in details:
        rid = detail["id"]
        stats = {"converted": 0, "skipped": 0}
        network = []
        for sub in ("main", "regex"):
            path = os.path.join(rulesets_dir, sub, rid + ".json")
            if os.path.exists(path):
                network.extend(json.load(open(path)))
        prefix, block, allow = convert_network(network, stats)
        positive, generic = cosmetics[rid]
        specific_rules = convert_specific(positive, unhide)
        generic_rules = convert_generic(generic, unhide)
        raw = write_rules(os.path.join(out, rid + ".rules"), [
            ("p", prefix), ("b", block), ("a", allow), ("c", [(0, r) for r in specific_rules + generic_rules]),
        ])
        digest.update(rid.encode() + b"\0" + raw)
        manifest["rulesets"].append({
            "id": rid,
            "enabled": bool(detail.get("enabled")),
            "group": detail.get("group") or "",
            "lang": detail.get("lang") or "",
            "name": detail.get("name") or rid,
            "network": sum(len(g) for _, g in prefix) + len(block) + len(allow),
            "cosmetic": len(specific_rules) + len(generic_rules),
            "converted": stats["converted"],
            "skipped": stats["skipped"],
            "bytes": len(raw),
        })
    manifest["digest"] = digest.hexdigest()[:16]
    json.dump(manifest, open(os.path.join(out, "rulesets.json"), "w"), indent=1, sort_keys=True)


main()
