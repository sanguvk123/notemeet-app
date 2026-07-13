from PIL import Image, ImageDraw

SIZES = {
    "icon.png": 1024,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "32x32.png": 32,
}

def make_app_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    r = int(size * 0.22)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=(0, 0, 0, 255))

    m = int(size * 0.28)
    sw = max(int(size * 0.12), 4)
    w = size - 2 * m
    h = size - 2 * m

    x1, y1 = m, m
    x2, y2 = m + w, m + h

    draw.line((x1, y1, x1, y2), fill=(255, 255, 255, 255), width=sw)
    draw.line((x1, y2, x2, y1), fill=(255, 255, 255, 255), width=sw)
    draw.line((x2, y1, x2, y2), fill=(255, 255, 255, 255), width=sw)

    return img

def make_tray(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    m = int(size * 0.2)
    sw = max(int(size * 0.18), 2)
    w = size - 2 * m
    h = size - 2 * m

    x1, y1 = m, m
    x2, y2 = m + w, m + h

    draw.line((x1, y1, x1, y2), fill=(255, 255, 255, 255), width=sw)
    draw.line((x1, y2, x2, y1), fill=(255, 255, 255, 255), width=sw)
    draw.line((x2, y1, x2, y2), fill=(255, 255, 255, 255), width=sw)

    return img

icons_dir = "/Users/sangameshk/notemeet-app/src-tauri/icons"

for name, sz in SIZES.items():
    img = make_app_icon(sz)
    path = f"{icons_dir}/{name}"
    img.save(path, "PNG")
    print(f"Saved {path} ({sz}x{sz})")

tray = make_tray(32)
tray.save(f"{icons_dir}/tray.png", "PNG")
print(f"Saved tray.png (32x32)")

tray2x = make_tray(64)
tray2x.save(f"{icons_dir}/tray@2x.png", "PNG")
print(f"Saved tray@2x.png (64x64)")

print("Done")
