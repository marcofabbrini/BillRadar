# Schermata di avvio nativa Android (mostrata prima che parta l'app): sfondo scuro + simbolo.
from PIL import Image
import glob
mark = Image.open('assets/logo-mark.png').convert('RGBA')
for f in glob.glob('android/app/src/main/res/drawable*/splash.png'):
    w, h = Image.open(f).size
    img = Image.new('RGBA', (w, h), (6, 18, 31, 255))
    mw = int(min(w, h) * 0.34)
    m = mark.resize((mw, mw), Image.LANCZOS)
    img.alpha_composite(m, ((w - mw) // 2, (int(h * 0.42) - mw // 2)))
    img.convert('RGB').save(f, optimize=True)
print('splash ok')
