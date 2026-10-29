#!/usr/bin/env python3
"""Reads and edits Ardia's Sparkle appcast: the one parser the release scripts share.

  appcast.py item <feed> <version>                       print the version's item
  appcast.py channel <feed> <version>                    print its channel (stable when it has none)
  appcast.py enclosure <feed> <version>                  print its zip's EdDSA signature and length
  appcast.py newest-build <feed>                         print the highest sparkle:version, or nothing
  appcast.py check-above <feed> <version>                fail unless the version's build is above every other one
  appcast.py merge <published> <built> <version> <out>   put the built item onto the published feed
  appcast.py strip-phased <feed> <version> <out>         drop the version's phased rollout interval
  appcast.py retarget <feed> <version> <url> <length> <signature>   print a feed of that item alone, pointing at url
"""
import re
import sys

ITEM = re.compile(r"[ \t]*<item>.*?</item>\n?", re.S)


def fail(message):
    sys.exit(f"error: {message}")


def read(path):
    xml = open(path).read()
    if "xmlns:sparkle" not in xml or "<channel>" not in xml:
        fail(f"{path} isn't a Sparkle appcast")
    return xml


def items(xml):
    return ITEM.findall(xml)


def short_version(item):
    found = re.search(r"<sparkle:shortVersionString>([^<]+)<", item)
    return found.group(1) if found else None


def build(item):
    found = re.search(r"<sparkle:version>([0-9]+)</sparkle:version>", item)
    return int(found.group(1)) if found else None


def channel(item):
    found = re.search(r"<sparkle:channel>([^<]+)</sparkle:channel>", item)
    return found.group(1) if found else "stable"


def the_item(path, xml, version):
    mine = [i for i in items(xml) if short_version(i) == version]
    if len(mine) != 1:
        fail(f"{path} has {len(mine)} items for {version}, not one")
    return mine[0]


def attribute(item, name):
    found = re.search(rf'{name}="([^"]*)"', item)
    if not found:
        fail(f"the item has no {name}")
    return found.group(1)


def merge(published_path, built_path, version, out_path):
    published = read(published_path)
    item = the_item(built_path, read(built_path), version)
    number = build(item)
    live = items(published)
    if any(build(i) == number and short_version(i) != version for i in live):
        fail(f"the published feed already has build {number} as another version; bump CURRENT_PROJECT_VERSION and rebuild")
    kept = [i for i in live if build(i) != number]
    head = published[: published.index("<item>")] if live else published[: published.index("</channel>")]
    merged = re.sub(r"[ \t]*$", "", head) + "        " + item.strip() + "\n" + "".join(kept)
    merged += published[published.rindex("</item>") + len("</item>"):].lstrip("\n") if live else "    </channel>\n</rss>\n"
    open(out_path, "w").write(merged)
    counts = {}
    for i in [item] + kept:
        counts[channel(i)] = counts.get(channel(i), 0) + 1
    summary = ", ".join(f"{n} {c}" for c, n in sorted(counts.items()))
    print(f"PASS  appcast for {version} (build {number}, {channel(item)}) merged onto the published feed ({summary})")


def strip_phased(path, version, out_path):
    xml = read(path)
    removed = 0

    def strip(match):
        nonlocal removed
        item = match.group(0)
        if short_version(item) != version:
            return item
        stripped, count = re.subn(r"[ \t]*<sparkle:phasedRolloutInterval>[^<]*</sparkle:phasedRolloutInterval>\n?", "", item)
        removed += count
        return stripped

    result = ITEM.sub(strip, xml)
    name = path.rsplit("/", 1)[-1]
    if not any(short_version(i) == version for i in items(xml)):
        print(f"note: {name} has no item for {version}")
    elif removed == 0:
        print(f"note: {version}'s item in {name} has no phased rollout interval")
    open(out_path, "w").write(result)
    print(f"{name}: removed {removed} phasedRolloutInterval line(s) from {version}'s item")


def check_above(path, version):
    xml = read(path)
    mine = build(the_item(path, xml, version))
    if mine is None:
        fail(f"{version}'s item in {path} has no sparkle:version")
    others = [b for b in (build(i) for i in items(xml) if short_version(i) != version) if b is not None]
    if others and mine <= max(others):
        fail(f"{version} is build {mine}, but the published feed already has build {max(others)}: a stale build would sit below it "
             "(and a stable would move latest backward); bump CURRENT_PROJECT_VERSION and rebuild")
    print(f"PASS  {version} (build {mine}) is above every other build in {path.rsplit('/', 1)[-1]} ({max(others) if others else 'none'})")


def retarget(path, version, url, length, signature):
    xml = read(path)
    item = the_item(path, xml, version).strip()
    item = re.sub(r'url="[^"]*"', f'url="{url}"', item)
    item = re.sub(r'length="[^"]*"', f'length="{length}"', item)
    item = re.sub(r'sparkle:edSignature="[^"]*"', f'sparkle:edSignature="{signature}"', item)
    item = re.sub(r"\s*<sparkle:phasedRolloutInterval>.*?</sparkle:phasedRolloutInterval>", "", item)
    print(xml[: xml.index("<item>")] + item + "\n    </channel>\n</rss>")


def main(args):
    commands = {
        "item": (2, lambda feed, version: print(the_item(feed, read(feed), version).strip())),
        "channel": (2, lambda feed, version: print(channel(the_item(feed, read(feed), version)))),
        "enclosure": (2, lambda feed, version: print(*(attribute(the_item(feed, read(feed), version), n) for n in ("sparkle:edSignature", "length")))),
        "newest-build": (1, lambda feed: print(max((b for b in map(build, items(read(feed))) if b is not None), default=""))),
        "check-above": (2, check_above),
        "merge": (4, merge),
        "strip-phased": (3, strip_phased),
        "retarget": (5, retarget),
    }
    if not args or args[0] not in commands or len(args) - 1 != commands[args[0]][0]:
        sys.exit(__doc__.strip())
    commands[args[0]][1](*args[1:])


main(sys.argv[1:])
