from PIL import Image, ImageDraw, ImageFont

W, H = 600, 400

img = Image.new("RGBA", (W, H), (0, 0, 0, 255))
draw = ImageDraw.Draw(img)

# N-logo
ls = 80
mx, my = (W // 2 - ls // 2, 60)
r = int(ls * 0.22)
draw.rounded_rectangle((mx, my, mx + ls, my + ls), radius=r, fill=(0, 0, 0, 255), outline=(42, 42, 42), width=2)
m2 = int(ls * 0.28)
sw = max(int(ls * 0.12), 6)
x1, y1 = mx + m2, my + m2
x2, y2 = mx + ls - m2, my + ls - m2
draw.line((x1, y1, x1, y2), fill=(245, 245, 245, 255), width=sw)
draw.line((x1, y2, x2, y1), fill=(245, 245, 245, 255), width=sw)
draw.line((x2, y1, x2, y2), fill=(245, 245, 245, 255), width=sw)

# Title
try:
    font_l = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 28)
    font_s = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
except:
    font_l = ImageFont.load_default()
    font_s = font_l

draw.text((W // 2, 170), "NoteMeet", fill=(245, 245, 245, 255), font=font_l, anchor="mt")
draw.text((W // 2, 200), "Drag to Applications folder", fill=(160, 160, 160, 255), font=font_s, anchor="mt")

# Arrow pointing right
ay = 290
ax1, ax2 = 160, 440
acy = ay
acx = (ax1 + ax2) // 2

draw.line((ax1, ay, ax2, ay), fill=(60, 60, 60, 255), width=2)
# Arrow head
draw.polygon([(ax2, ay), (ax2 - 14, ay - 7), (ax2 - 14, ay + 7)], fill=(60, 60, 60, 255))

# Left label
draw.text((ax1, ay + 20), "NoteMeet.app", fill=(245, 245, 245, 255), font=font_s, anchor="mt")
# Right label
draw.text((ax2, ay + 20), "Applications", fill=(245, 245, 245, 255), font=font_s, anchor="mt")

img.save("/tmp/dmg_bg.png", "PNG")
print("Saved /tmp/dmg_bg.png")
