"""Photos for the stand-in sites, from Wikimedia Commons, CC0 or public domain only (each file's licence is checked
through the Commons API before it's used). → sites/<host>/img/<n>.jpg (gitignored); SOURCES.md lists every file.
usage: python3 fetch-images.py"""
import json, os, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "ardia-film-capture/1.0 (https://github.com/mantrakp04/ardia)"}
FILES = {
    "moodwall.example": [
        "Blue white kitchen interior (Unsplash).jpg", "Lavender field in bloom.jpg", "Moraine Lake 17092005.jpg",
        "Charming outdoor display of succulent plants in vintage pots.jpg", "Coffee steaming in a mug.jpg",
        "Bear Mountain Trail No. 54 (35132080921).jpg", "Orange tabby persian cat sleeping on a couch.png",
        "Sunflower field at sunset.jpg", "Bakery bread in Boston.jpg", "Waterfall in forest.jpg",
        "Olsztyn succulent (Unsplash).jpg", "Sunset Beach Geraldton.jpg", "Blue coffee cup (Unsplash).jpg",
        "Autumn Forest Wet Bark.jpg", "Terracotta Pots (Unsplash).jpg", "Hiking up the Sepulcher Mountain Trail (48080272393).jpg",
    ],
    "crumbs.example": ["Chocolate chip cookies on cutting board.jpg", "Choc-Chip-Cookie.jpg", "Bakery bread in Boston.jpg",
                       "Coffee steaming in a mug.jpg", "Blue white kitchen interior (Unsplash).jpg"],
    "canopy.example": ["Tree-lined street in Westgate.jpg"],
    "course.example": ["University of Illinois at Urbana-Champaign, Champaign, United States (Unsplash lguU6sOKwZA).jpg"],
    "library.example": ["Tree archway in a park (Unsplash).jpg", "Branches obscuring the sun (Unsplash).jpg",
                        "Forsyth Park, Savannah (Unsplash).jpg", "Helsinki Rooftops (Unsplash).jpg"],
    "lecture.example": ["Helsinki Rooftops (Unsplash).jpg", "Rooftops (Unsplash).jpg",
                        "Suburb view on a foggy morning (Unsplash).jpg", "Rooftop street view (Unsplash).jpg"],
    "survey.example": ["Forsyth Park, Savannah (Unsplash).jpg"],
    "pressroom.example": ["Coffee steaming in a mug.jpg"],
    "mockups.example": ["Sunflower field at sunset.jpg"],
    "preprints.example": ["Arbuscular mycorrhiza microscope.jpg", "White mushrooms on tree bark (Unsplash).jpg"],
    "protocols.example": ["Cdc-wDxFn dBEC0-unsplash.jpg", "PCR tubes.jpg"],
    "labwiki.example": ["Fume hood.jpg"],
    "journalclub.example": ["White mushrooms on tree bark (Unsplash).jpg"],
    "hostel.example": ["Parco Nazionale delle Cinque Terre, Riomaggiore, Italy (Unsplash).jpg", "Vacation in Greece (Unsplash).jpg",
                       "Kitchen (Unsplash).jpg", "Burano, Venice, Italy (Unsplash).jpg", "Boats of Cavtat, Cavtat, Croatia (Unsplash).jpg",
                       "Bunk bed.jpg", "Hotel bedroom windows (Unsplash).jpg", "NY loft bedroom (Unsplash).jpg"],
    "ferry.example": ["Ferry deck (Unsplash).jpg"],
    "trails.example": ["Sharp green mountain ridge (Unsplash).jpg", "Manarola, Italy (Unsplash hpUDtMgq72A).jpg",
                       "Coastline drone view (Unsplash uUS0DWy6lvA).jpg"],
    "eats.example": ["BBQ Skewers (Unsplash).jpg", "Eating Asian Noodles (Unsplash).jpg", "Noodle Dish (Unsplash).jpg",
                     "Dumplings (Unsplash).jpg", "Dim Sum Dinner (Unsplash).jpg", "Noodle Bowl for Lunch (Unsplash).jpg",
                     "Vegetable Satay - Bali 2025-11-19.jpg", "Seafood Market in Japan (Unsplash).jpg",
                     "Foto sate sedang dibakar.jpg", "Green shop (Unsplash).jpg", "Ladle of Ramen (Unsplash).jpg",
                     "Sate Ayam Khas Madura.jpg"],
    "syllabus.example": ["Plants in beakers (Unsplash).jpg"],
    "labmanual.example": ["Giving water bath to a solution in test tube.jpg"],
    "quiz.example": ["Petri Dish containing Calcium Chloride.jpg"],
}
WIDE = {"hostel.example", "ferry.example", "trails.example", "eats.example", "syllabus.example", "canopy.example", "course.example", "library.example", "lecture.example", "survey.example"}
WIDE |= {"pressroom.example", "mockups.example", "preprints.example", "protocols.example", "labwiki.example", "journalclub.example"}
OK = {"CC0", "Public domain", "Public Domain"}


def info(title, width=720):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "titles": "File:" + title, "prop": "imageinfo", "iiprop": "url|extmetadata|sha1",
        "iiurlwidth": width, "format": "json"})
    page = next(iter(json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))["query"]["pages"].values()))
    ii = page["imageinfo"][0]
    md = ii.get("extmetadata", {})
    return ii, md.get("LicenseShortName", {}).get("value", "")


lines = ["# Stand-in site photos", "", "Fetched by `fetch-images.py` from Wikimedia Commons. Only CC0 or public-domain files are used.", "",
         "| Site | File | Licence | Commons page |", "| --- | --- | --- | --- |"]
for host, titles in FILES.items():
    d = os.path.join(HERE, host, "img")
    os.makedirs(d, exist_ok=True)
    for n, title in enumerate(titles):
        ii, lic = info(title, 1600 if host in WIDE else 720)
        if lic not in OK:
            raise SystemExit(f"{title}: licence {lic!r} is not CC0 or public domain")
        out = os.path.join(d, f"{n}.jpg")
        if not os.path.exists(out):
            data = urllib.request.urlopen(urllib.request.Request(ii["thumburl"], headers=UA), timeout=60).read()
            open(out, "wb").write(data)
        lines.append(f"| {host} | {title} | {lic} | {ii['descriptionurl']} |")
open(os.path.join(HERE, "SOURCES.md"), "w").write("\n".join(lines) + "\n")
print("images fetched")
