"""UBX Mobile logo and Android icon set from one geometry (design units 0..100).

Run: python scripts/generate-logo.py  (needs Pillow; the preview sheet uses Segoe UI from
C:/Windows/Fonts). Writes assets/logo/* and the icon and splash images in assets/images.
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'logo')
os.makedirs(OUT, exist_ok=True)

ACCENT = '#8AB4F8'      # app dark-theme primary
INK = '#111418'         # app light-theme text / near black
PAPER = '#FFFFFF'
LIGHT = '#E8EAED'       # app dark-theme text
GREY = '#8A919D'

# Geometry (design units, 100 x 100)
C = 50.0
R_OUT = 33.0
R_IN = 16.5
SAT_EL = 32.0           # elevation of the satellite (deg)
SAT_AZ = 48.0           # azimuth (deg, clockwise from north)
R_SAT = R_OUT * (90 - SAT_EL) / 90
SAT_R = 4.8
CENTER_R = 2.4
TRAIL = []  # no trail: just the satellite
TICK = 4.5              # cardinal tick length inside the outer ring
TICK_W = 2.2


def polar(r, az):
    a = math.radians(az)
    return C + r * math.sin(a), C - r * math.cos(a)


def palette(theme):
    if theme == 'dark':   # on a dark background
        return dict(ring=LIGHT, ring2=GREY, center=LIGHT)
    if theme == 'light':  # on a white background
        return dict(ring=INK, ring2=GREY, center=INK)
    if theme == 'mono':   # single colour (Android themed icon)
        return dict(ring=PAPER, ring2=PAPER, center=PAPER)
    raise ValueError(theme)


def tick_segments():
    for az in (0, 90, 180, 270):
        yield polar(R_OUT - 1.6, az), polar(R_OUT - 1.6 - TICK, az)


# ---------------------------------------------------------------- SVG

def svg_mark(theme, accent=ACCENT):
    p = palette(theme)
    sx, sy = polar(R_SAT, SAT_AZ)
    lines = []
    lines.append('<g fill="none">')
    lines.append(f'  <circle cx="{C:g}" cy="{C:g}" r="{R_IN:g}" stroke="{p["ring2"]}" stroke-width="1.8"/>')
    lines.append(f'  <circle cx="{C:g}" cy="{C:g}" r="{R_OUT:g}" stroke="{p["ring"]}" stroke-width="3.2"/>')
    lines.append('</g>')
    lines.append(f'<g stroke="{p["ring"]}" stroke-width="{TICK_W:g}" stroke-linecap="round">')
    for (x0, y0), (x1, y1) in tick_segments():
        lines.append(f'  <line x1="{x0:.3f}" y1="{y0:.3f}" x2="{x1:.3f}" y2="{y1:.3f}"/>')
    lines.append('</g>')
    for az, r, op in TRAIL:
        x, y = polar(R_SAT, az)
        lines.append(f'<circle cx="{x:.3f}" cy="{y:.3f}" r="{r:g}" fill="{accent}" opacity="{op:g}"/>')
    lines.append(f'<circle cx="{C:g}" cy="{C:g}" r="{CENTER_R:g}" fill="{p["center"]}"/>')
    lines.append(f'<circle cx="{sx:.3f}" cy="{sy:.3f}" r="{SAT_R:g}" fill="{accent}"/>')
    return '\n  '.join(lines)


def write_svg(name, body, size=100, view=(0, 0, 100, 100)):
    v = ' '.join(f'{x:g}' for x in view)
    h = size * view[3] / view[2]
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{v}" width="{size:g}" height="{h:g}">\n'
        f'  <title>UBX Mobile</title>\n  {body}\n</svg>\n'
    )
    open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n').write(svg)


ICON_BG = f'<rect x="0" y="0" width="100" height="100" rx="22" fill="{INK}"/>'
write_svg('logo-icon.svg', ICON_BG + '\n  ' + svg_mark('dark'), 1024)
write_svg('logo-mark-light.svg', svg_mark('light'), 512)
write_svg('logo-mark-dark.svg', svg_mark('dark'), 512)

FONT = 'font-family="\'Segoe UI\', Roboto, Inter, Arial, sans-serif"'
for theme, fg, sub in (('light', INK, '#5F6673'), ('dark', LIGHT, GREY)):
    word = (
        svg_mark(theme)
        + f'\n  <text x="100" y="62" {FONT} font-size="34" font-weight="600" fill="{fg}">UBX</text>'
        + f'\n  <text x="176" y="62" {FONT} font-size="34" font-weight="300" fill="{sub}">Mobile</text>'
    )
    write_svg(f'logo-wordmark-{theme}.svg', word, 640, (0, 0, 290, 100))


# ---------------------------------------------------------------- PNG (4x supersampled)

def hexrgba(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def render_mark(size, theme, bg=None, rounded=False, scale=1.0, accent=ACCENT):
    """Mark on a size x size canvas; `scale` shrinks it around the centre (adaptive icon safe zone)."""
    ss = 4
    S = size * ss
    k = S / 100 * scale
    off = S * (1 - scale) / 2

    def P(x, y):
        return (off + x * k, off + y * k)

    p = palette(theme)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    if bg:
        base = ImageDraw.Draw(img)
        if rounded:
            base.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=hexrgba(bg))
        else:
            base.rectangle([0, 0, S, S], fill=hexrgba(bg))

    def layer(draw_fn, opacity=1.0):
        lay = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        draw_fn(ImageDraw.Draw(lay))
        if opacity < 1:
            alpha = lay.getchannel('A').point(lambda a: int(a * opacity))
            lay.putalpha(alpha)
        img.alpha_composite(lay)

    def ring(d, r, color, w):
        x0, y0 = P(C - r, C - r)
        x1, y1 = P(C + r, C + r)
        d.ellipse([x0, y0, x1, y1], outline=hexrgba(color), width=max(1, round(w * k)))

    def disc(d, x, y, r, color):
        cx, cy = P(x, y)
        d.ellipse([cx - r * k, cy - r * k, cx + r * k, cy + r * k], fill=hexrgba(color))

    def ticks(d):
        for (x0, y0), (x1, y1) in tick_segments():
            d.line([P(x0, y0), P(x1, y1)], fill=hexrgba(p['ring']), width=round(TICK_W * k))
            disc(d, x1, y1, TICK_W / 2, p['ring'])

    layer(lambda d: ring(d, R_IN, p['ring2'], 1.8))
    layer(lambda d: ring(d, R_OUT, p['ring'], 3.2))
    layer(ticks)
    for az, r, op in TRAIL:
        x, y = polar(R_SAT, az)
        layer(lambda d, x=x, y=y, r=r: disc(d, x, y, r, accent), op)
    layer(lambda d: disc(d, C, C, CENTER_R, p['center']))
    sx, sy = polar(R_SAT, SAT_AZ)
    layer(lambda d: disc(d, sx, sy, SAT_R, accent))
    return img.resize((size, size), Image.LANCZOS)


render_mark(1024, 'dark', bg=INK, rounded=True).save(os.path.join(OUT, 'logo-icon-1024.png'))

# Preview sheet: icon sizes, marks on light and dark, themed (mono) icon, wordmarks.
sheet = Image.new('RGBA', (1600, 900), hexrgba('#F3F4F6'))
sheet.alpha_composite(Image.new('RGBA', (800, 900), hexrgba('#0B0D10')), (800, 0))
sheet.alpha_composite(render_mark(360, 'dark', bg=INK, rounded=True), (60, 60))
x = 470
for s in (192, 96, 48):
    sheet.alpha_composite(render_mark(s, 'dark', bg=INK, rounded=True), (x, 60 + (192 - s)))
    x += s + 24
sheet.alpha_composite(render_mark(300, 'light'), (60, 470))
sheet.alpha_composite(render_mark(300, 'dark'), (860, 470))
sheet.alpha_composite(render_mark(360, 'dark', bg=INK, rounded=True), (860, 60))
sheet.alpha_composite(render_mark(160, 'mono', accent=PAPER), (1300, 160))
font_b = ImageFont.truetype(r'C:\Windows\Fonts\seguisb.ttf', 72)
font_l = ImageFont.truetype(r'C:\Windows\Fonts\segoeuisl.ttf', 72)
d = ImageDraw.Draw(sheet)
d.text((380, 570), 'UBX', font=font_b, fill=hexrgba(INK))
d.text((530, 570), 'Mobile', font=font_l, fill=hexrgba('#5F6673'))
d.text((1180, 570), 'UBX', font=font_b, fill=hexrgba(LIGHT))
d.text((1330, 570), 'Mobile', font=font_l, fill=hexrgba(GREY))
sheet.convert('RGB').save(os.path.join(OUT, 'logo-preview.png'))
print('written to', OUT)


# ---------------------------------------------------------------- app icon set (assets/images)
IMAGES = os.path.join(ROOT, 'assets', 'images')
# Legacy/launcher icon (also used by Expo tooling): the full rounded-square icon.
render_mark(1024, 'dark', bg=INK, rounded=True).save(os.path.join(IMAGES, 'icon.png'))
# Adaptive icon (Android 8+): 108 dp canvas, launcher masks keep the central 66 dp. The outer
# ring spans ~69% of the mark; scale 0.70 puts it at ~48% of the canvas (~73% of what launchers show).
ADAPTIVE_SCALE = 0.70
render_mark(512, 'dark', scale=ADAPTIVE_SCALE).save(os.path.join(IMAGES, 'android-icon-foreground.png'))
Image.new('RGBA', (512, 512), hexrgba(INK)).save(os.path.join(IMAGES, 'android-icon-background.png'))
# Themed icon (Android 13+): only the alpha channel is used.
render_mark(432, 'mono', scale=ADAPTIVE_SCALE, accent=PAPER).save(
    os.path.join(IMAGES, 'android-icon-monochrome.png')
)
# Splash: the mark on the near-black splash background.
render_mark(512, 'dark').save(os.path.join(IMAGES, 'splash-icon.png'))
print('app icons written to', IMAGES)
