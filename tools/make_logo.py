# Rimuove lo sfondo dal logo e produce le versioni usate dall'app.
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi

src = Image.open('assets/logo-original.jpg').convert('RGB')
I = np.asarray(src).astype(np.float32)
R, G, B = I[..., 0], I[..., 1], I[..., 2]

# Lo sfondo è grigio neutro; il logo ha tinta ciano (blu > rosso).
chroma = B - R
chroma = cv2.GaussianBlur(chroma, (0, 0), 0.8)
alpha = np.clip((chroma - 7) / 55.0, 0, 1)

# Interno pallido delle lettere: riempie i buchi delle forme chiuse.
solid = alpha > 0.45
solid = ndi.binary_closing(solid, structure=np.ones((5, 5)))
filled = ndi.binary_fill_holes(solid)
interior = filled & ~solid
interior = ndi.binary_opening(interior, structure=np.ones((3, 3)))
alpha = np.maximum(alpha, ndi.gaussian_filter(interior.astype(np.float32), 0.9))

# Colore in primo piano: toglie il contributo dello sfondo (~grigio chiaro).
bg = np.array([243, 244, 243], np.float32)
a = np.clip(alpha, 1e-3, 1)[..., None]
F = np.clip((I - (1 - a) * bg) / a, 0, 255)
# dove l'alpha è pieno usa il pixel originale
F = np.where(a > 0.98, I, F)

rgba = np.dstack([F, alpha * 255]).astype(np.uint8)
alpha_full = alpha
full = Image.fromarray(rgba, 'RGBA')
bbox = full.getchannel('A').point(lambda v: 255 if v > 12 else 0).getbbox()
full = full.crop((bbox[0]-20, bbox[1]-20, bbox[2]+20, bbox[3]+20))
full.save('assets/logo-full.png')
print('full', full.size, bbox)

# --- solo simbolo (radar + battito), senza scritta e senza riempimenti ---
a0 = np.clip((chroma - 13) / 50.0, 0, 1) ** 1.1
fade = np.clip((472 - np.arange(a0.shape[0])) / 14.0, 0, 1)[:, None]
a0 = a0 * fade                         # taglia la scritta con dissolvenza
a0c = np.clip(a0, 1e-3, 1)[..., None]
F0 = np.clip((I - (1 - a0c) * bg) / a0c, 0, 255)
F0 = np.where(a0c > 0.98, I, F0)
# l'alone debole diventa ciano (non grigio) anche su sfondi scuri
cy_ = np.array([70, 195, 255], np.float32)
w = np.clip(1 - a0c / 0.7, 0, 1) * 0.75
F0 = F0 * (1 - w) + cy_ * w
mark = Image.fromarray(np.dstack([F0, a0 * 255]).astype(np.uint8), 'RGBA')
bb = mark.getchannel('A').point(lambda v: 255 if v > 10 else 0).getbbox()
mark = mark.crop((bb[0]-16, bb[1]-16, bb[2]+16, bb[3]+16))
mark.save('assets/logo-mark.png'); print('mark', mark.size)
rgba = np.dstack([F0, a0 * 255]).astype(np.uint8)
alpha = a0

# simbolo radar (senza scritta), maschera circolare morbida
cx, cy, r = 705, 318, 168
H, W = alpha.shape
yy, xx = np.mgrid[0:H, 0:W]
d = np.hypot(xx - cx, yy - cy)
m = np.clip((r - d) / 22.0, 0, 1)
sym = rgba.copy().astype(np.float32)
sym[..., 3] *= m
symim = Image.fromarray(sym.astype(np.uint8), 'RGBA').crop((cx-r, cy-r, cx+r, cy+r))
symim.save('assets/logo-symbol.png')
print('symbol', symim.size)

# anteprime su sfondo chiaro e scuro
for name, col in (('light', (255, 255, 255)), ('dark', (8, 22, 38))):
    for tag, im in (('full', full), ('mark', mark), ('symbol', symim)):
        bgim = Image.new('RGBA', im.size, col + (255,))
        bgim.alpha_composite(im)
        bgim.convert('RGB').save(f'/tmp/claude-0/prev-{tag}-{name}.png')
