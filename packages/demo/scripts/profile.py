import sys

import numpy as np
from PIL import Image

ref, demo = (np.asarray(Image.open(p).convert("RGB")).astype(int) for p in sys.argv[1:3])
mode, at = sys.argv[3], [int(v) for v in sys.argv[4].split(",")]
span = range(*[int(v) for v in sys.argv[5].split(",")])
for i in span:
    y, x = (at[1], i) if mode == "row" else (i, at[0])
    r, d = ref[y, x], demo[y, x]
    print(f"{mode} {i:5} ref {r} demo {d} diff {d - r}")
