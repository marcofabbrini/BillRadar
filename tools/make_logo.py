# Rimuove lo sfondo blu dal logo piatto e produce simbolo trasparente (alpha da proiezione colore).
import numpy as np, cv2
from PIL import Image

src = Image.open('assets/logo-original.jpg').convert('RGB')
I = np.asarray(src).astype(np.float32)
bg = np.array([9, 33, 73], np.float32)      # sfondo navy
fg = np.array([40, 214, 251], np.float32)   # ciano del logo
d = fg - bg
alpha = np.clip(((I - bg) @ d) / float(d @ d), 0, 1)
alpha = np.clip((alpha - 0.06) / 0.90, 0, 1)          # toglie il rumore JPEG sul fondo
alpha = cv2.GaussianBlur(alpha, (0, 0), 0.6)

rgba = np.zeros(I.shape[:2] + (4,), np.uint8)
rgba[..., :3] = fg.astype(np.uint8)
rgba[..., 3] = (alpha * 255).astype(np.uint8)
im = Image.fromarray(rgba, 'RGBA')

bb = im.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
pad = 14
sym = im.crop((bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad))
side = max(sym.size)
sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
sq.alpha_composite(sym, ((side - sym.width) // 2, (side - sym.height) // 2))
sq.save('assets/logo-symbol.png', optimize=True)
sq.save('assets/logo-mark.png', optimize=True)
print('simbolo', sq.size, 'bbox', bb)

for name, col in (('light', (255, 255, 255)), ('dark', (6, 18, 31))):
    b = Image.new('RGBA', sq.size, col + (255,)); b.alpha_composite(sq); b.convert('RGB').save(f'/tmp/claude-0/new-{name}.png')
