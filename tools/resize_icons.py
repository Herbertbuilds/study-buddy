import os
import sys
from PIL import Image

src = sys.argv[1]  # e.g. my_icon.png
img = Image.open(src).convert("RGBA")

if img.width != img.height:
    sys.exit("Icon must be square (same width and height).")

os.makedirs("icons", exist_ok=True)
for size in (16, 32, 48, 128):
    out = img.resize((size, size), Image.LANCZOS)
    out.save(os.path.join("icons", f"icon{size}.png"))
    print(f"wrote icons/icon{size}.png")