from PIL import Image, ImageDraw, ImageFilter
import os
BG = (7, 26, 44)
sym = Image.open('assets/logo-symbol.png').convert('RGBA')
mark = Image.open('assets/logo-mark.png').convert('RGBA')

os.makedirs('public', exist_ok=True)
m = mark.copy(); m.thumbnail((560, 560)); m.save('public/logo-mark.png', optimize=True)
s = sym.copy(); s.thumbnail((256, 256)); s.save('public/logo-symbol.png', optimize=True)
fav = Image.new('RGBA', (64, 64), BG + (255,)) 
f2 = sym.resize((56, 56), Image.LANCZOS); fav.alpha_composite(f2, (4, 4)); fav.save('public/favicon.png')

res = 'android/app/src/main/res'
def bgcanvas(size, round_=False, radius=0.22):
    base = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    grad = Image.new('RGBA', (size, size))
    d = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / size
        d.line([(0, y), (size, y)], fill=(int(8 + 6*t), int(30 + 20*t), int(52 + 28*t), 255))
    mask = Image.new('L', (size, size), 0)
    md = ImageDraw.Draw(mask)
    if round_: md.ellipse((0, 0, size-1, size-1), fill=255)
    else: md.rounded_rectangle((0, 0, size-1, size-1), radius=int(size*radius), fill=255)
    base.paste(grad, (0, 0), mask)
    return base

def place(canvas, scale):
    n = int(canvas.width * scale)
    sy = sym.resize((n, n), Image.LANCZOS)
    canvas.alpha_composite(sy, ((canvas.width-n)//2, (canvas.height-n)//2))
    return canvas

dens = {'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216), 'xxhdpi': (144, 324), 'xxxhdpi': (192, 432)}
for d, (legacy, fg) in dens.items():
    p = f'{res}/mipmap-{d}'
    os.makedirs(p, exist_ok=True)
    place(bgcanvas(legacy), 0.84).save(f'{p}/ic_launcher.png')
    place(bgcanvas(legacy, True), 0.80).save(f'{p}/ic_launcher_round.png')
    fgc = Image.new('RGBA', (fg, fg), (0, 0, 0, 0))
    place(fgc, 0.64).save(f'{p}/ic_launcher_foreground.png')

open(f'{res}/values/ic_launcher_background.xml', 'w').write(
'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#071A2C</color>\n</resources>\n')
print('icone ok')
