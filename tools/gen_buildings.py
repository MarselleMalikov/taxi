# Генератор домов для карты (дома придуманы, а не взяты из OpenStreetMap).
# Запуск:  python3 tools/gen_buildings.py   (нужны пакеты shapely и numpy)
# Читает mapdata.js, пишет buildings.js.
#
# Идея: смотрим, какие дороги вокруг, и решаем, что за район:
#   много внутриквартальных проездов  -> многоэтажки (длинные панельки и башни)
#   густая сетка жилых улиц           -> частный сектор (маленькие домики)
#   вдоль крупных улиц                -> торговые и офисные здания
# Дома ставим вдоль дорог с отступом и проверяем, что они не залезают
# ни на дороги, ни друг на друга.
import json, math, random, os
from shapely.geometry import LineString, Polygon
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "mapdata.js"), encoding="utf-8").read()
D = json.loads(src[src.index("{"):src.rindex("}") + 1])
N, E = D["nodes"], D["edges"]
rnd = random.Random(42)   # одинаковое зерно -> каждый раз одинаковые дома

HALF = [11, 9, 7, 5.5, 4.5, 3]   # полуширина дороги (м) по классу отрисовки e[5]

# ---- плотность дорог по сетке 200 м, чтобы понять тип района ----
CELL = 200
dens = {}
for e in E:
    a, b = N[e[0]], N[e[1]]
    L = math.hypot(a[0] - b[0], a[1] - b[1])
    k = (int((a[0] + b[0]) / 2 // CELL), int((a[1] + b[1]) / 2 // CELL))
    d = dens.setdefault(k, [0.0] * 6); d[e[5]] += L

def area(x, y):
    cx, cy = int(x // CELL), int(y // CELL)
    s = [0.0] * 6
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            d = dens.get((cx + i, cy + j))
            if d:
                for c in range(6): s[c] += d[c]
    return s   # длина дорог каждого класса на участке 600x600 м

# ---- дороги для проверки пересечений ----
segs, segw = [], []
for e in E:
    a, b = N[e[0]], N[e[1]]
    if a == b: continue
    segs.append(LineString([a, b])); segw.append(HALF[e[5]])
tree = STRtree(segs)

# ---- уже поставленные дома, своя сетка 100 м ----
BC = 100
bgrid = {}
def near_buildings(poly, gap):
    x0, y0, x1, y1 = poly.bounds
    for i in range(int((x0 - gap) // BC), int((x1 + gap) // BC) + 1):
        for j in range(int((y0 - gap) // BC), int((y1 + gap) // BC) + 1):
            for q in bgrid.get((i, j), ()):
                if poly.distance(q) < gap: return True
    return False
def add_building(poly):
    x0, y0, x1, y1 = poly.bounds
    for i in range(int(x0 // BC), int(x1 // BC) + 1):
        for j in range(int(y0 // BC), int(y1 // BC) + 1):
            bgrid.setdefault((i, j), []).append(poly)

def hits_road(poly, clear):
    for idx in tree.query(poly.buffer(14)):
        if poly.distance(segs[idx]) < segw[idx] + clear: return True
    return False

def rect(cx, cy, ux, uy, hl, hd):
    vx, vy = -uy, ux
    return Polygon([(cx + ux * hl + vx * hd, cy + uy * hl + vy * hd), (cx - ux * hl + vx * hd, cy - uy * hl + vy * hd),
                    (cx - ux * hl - vx * hd, cy - uy * hl - vy * hd), (cx + ux * hl - vx * hd, cy + uy * hl - vy * hd)])

out = []
def place(cx, cy, ux, uy, hl, hd, kind, clear, gap):
    if not (0 < cx < D["w"] and 0 < cy < D["h"]): return False
    p = rect(cx, cy, ux, uy, hl, hd)
    if hits_road(p, clear) or near_buildings(p, gap): return False
    add_building(p)
    ang = math.degrees(math.atan2(uy, ux)) % 180
    out.append([round(cx), round(cy), round(hl, 1), round(hd, 1), round(ang), kind])
    return True

def kind_at(x, y, cls):
    s = area(x, y)
    tot = sum(s)
    if tot < 1500: return None                       # пустырь, лес, поле - не строим
    if cls <= 2 and rnd.random() < 0.5: return 2      # у крупных улиц - торговые/офисные
    if s[5] > 1.3 * s[4] and s[5] > 800: return 0     # много проездов -> многоэтажки
    if s[4] > 1400: return 1                          # густая сетка жилых улиц -> частный сектор
    return 0 if s[5] > 500 else (1 if s[4] > 600 else None)

# Порядок: сначала проезды (там стоят многоэтажки), потом жилые улицы, потом крупные.
order = sorted(range(len(E)), key=lambda i: [5, 4, 3, 2, 1, 0].index(E[i][5]))
for n, ei in enumerate(order):
    e = E[ei]; a, b = N[e[0]], N[e[1]]; cls = e[5]
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    if L < 25 or cls == 0: continue
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    nx, ny = -uy, ux
    kind = kind_at((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, cls)
    if kind is None: continue
    for side in (1, -1):
        t = rnd.uniform(6, 20)
        while t < L - 10:
            if kind == 0:   # многоэтажки
                if rnd.random() < 0.22: hl = hd = rnd.uniform(9, 13)                     # башня
                else: hl, hd = rnd.uniform(28, 70), rnd.uniform(6, 7.5)                 # панелька
                sb, clear, gap, step = rnd.uniform(9, 18), 6, 14, rnd.uniform(14, 30)
            elif kind == 1:  # частный сектор
                hl, hd = rnd.uniform(4, 7), rnd.uniform(4, 6)
                sb, clear, gap, step = rnd.uniform(3, 7), 3, 5, rnd.uniform(6, 14)
            else:            # торговые и офисные
                hl, hd = rnd.uniform(15, 35), rnd.uniform(10, 20)
                sb, clear, gap, step = rnd.uniform(10, 22), 6, 10, rnd.uniform(15, 35)
            if t + 2 * hl > L + 15 and hl > 12: hl = max(10, (L + 15 - t) / 2)
            off = HALF[cls] + sb + hd
            cx = a[0] + ux * (t + hl) + nx * off * side
            cy = a[1] + uy * (t + hl) + ny * off * side
            ok = place(cx, cy, ux, uy, hl, hd, kind, clear, gap)
            if not ok and kind == 0 and hl > 20:   # не влезла длинная - пробуем покороче
                hl = hl / 2; cx = a[0] + ux * (t + hl) + nx * off * side; cy = a[1] + uy * (t + hl) + ny * off * side
                ok = place(cx, cy, ux, uy, hl, hd, kind, clear, gap)
            t += (2 * hl + step) if ok else 8
            if kind == 0 and ok and rnd.random() < 0.35:   # второй ряд во дворе
                off2 = off + hd + rnd.uniform(25, 45) + hd
                place(a[0] + ux * (t - step - hl) + nx * off2 * side, a[1] + uy * (t - step - hl) + ny * off2 * side,
                      ux, uy, hl * rnd.uniform(0.6, 1), hd, 0, clear, gap)
    if n % 5000 == 0: print(f"{n}/{len(E)} дорог, домов: {len(out)}", flush=True)

# ---- второй проход: досыпаем дома во дворы многоэтажек ----
def nearest_seg(x, y):
    from shapely.geometry import Point
    pt = Point(x, y); idx = tree.query_nearest(pt)[0]
    return idx, pt.distance(segs[idx]) - segw[idx]
for (cx_, cy_), d in list(dens.items()):
    s = area((cx_ + .5) * CELL, (cy_ + .5) * CELL)
    if sum(s) < 1500 or s[5] < 400 or (s[4] > 1400 and s[4] > s[5]): continue   # не пустырь и не частный сектор
    for _ in range(90):
        x, y = (cx_ + rnd.random()) * CELL, (cy_ + rnd.random()) * CELL
        idx, dist = nearest_seg(x, y)
        if dist < 12 or dist > 110: continue
        (ax, ay), (bx, by) = segs[idx].coords
        L = math.hypot(bx - ax, by - ay); ux, uy = (bx - ax) / L, (by - ay) / L
        if rnd.random() < 0.3: ux, uy = -uy, ux                      # иногда дом стоит поперёк
        if rnd.random() < 0.2: hl = hd = rnd.uniform(9, 13)
        else: hl, hd = rnd.uniform(22, 60), rnd.uniform(6, 7.5)
        if not place(x, y, ux, uy, hl, hd, 0, 6, 13):
            place(x, y, ux, uy, hl / 2, hd, 0, 6, 13)
print("после заполнения дворов:", len(out))

js = ("// Дома на карте. Сгенерированы скриптом tools/gen_buildings.py (придуманы, не из OpenStreetMap).\n"
      "// Каждый дом: [центр x, центр y, полудлина, полуширина, угол в градусах, тип 0-многоэтажка 1-частный 2-торговый]\n"
      "const BUILDINGS = " + json.dumps(out, separators=(",", ":")) + ";\n")
open(os.path.join(ROOT, "buildings.js"), "w", encoding="utf-8").write(js)
print("готово, домов:", len(out), "размер файла:", round(len(js) / 1e6, 2), "МБ")
