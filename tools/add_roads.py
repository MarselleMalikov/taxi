# Добавляет недостающие дороги из выгрузки OpenStreetMap в дорожную сеть игры (mapdata.js).
# Запуск:  python3 tools/add_roads.py osm/roads_detail_7.json [ещё файлы...]
# Дороги, которые в игре уже есть, пропускаются; новые сшиваются с существующими перекрёстками.
import json, math, os, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "mapdata.js")
src = open(PATH, encoding="utf-8").read()
head, tail = src[:src.index("{")], src[src.rindex("}") + 1:]
D = json.loads(src[src.index("{"):src.rindex("}") + 1])
G, N, E, NAMES = D["geo"], D["nodes"], D["edges"], D["names"]
xy = lambda p: (round((p["lon"] - G["lonMin"]) * G["kx"]), round((G["latMax"] - p["lat"]) * G["ky"]))

# класс дороги: 0 магистраль, 1 главная, 2 средняя, 3 обычная, 4 жилая, 5 двор/проезд
CLS = {"motorway": 0, "trunk": 0, "primary": 1, "secondary": 2, "tertiary": 3, "unclassified": 4, "residential": 4, "living_street": 4, "service": 5}
def cls_of(h): return CLS.get(h.replace("_link", ""), None)

# ---- сетки для быстрого поиска ближайших узлов и участков ----
C = 50
ngrid = defaultdict(list)
for i, (x, y) in enumerate(N): ngrid[(x // C, y // C)].append(i)
sgrid = defaultdict(list)
def add_seg(ei):
    a, b = N[E[ei][0]], N[E[ei][1]]
    for gx in range(min(a[0], b[0]) // C, max(a[0], b[0]) // C + 1):
        for gy in range(min(a[1], b[1]) // C, max(a[1], b[1]) // C + 1): sgrid[(gx, gy)].append(ei)
for ei in range(len(E)): add_seg(ei)

def near_node(x, y, r):
    best, bd = None, r * r
    for gx in range(int(x - r) // C, int(x + r) // C + 1):
        for gy in range(int(y - r) // C, int(y + r) // C + 1):
            for i in ngrid[(gx, gy)]:
                d = (N[i][0] - x) ** 2 + (N[i][1] - y) ** 2
                if d <= bd: best, bd = i, d
    return best
def seg_dist(x, y, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L))
    return math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
def near_road(x, y, r):
    for ei in sgrid[(int(x) // C, int(y) // C)]:
        if seg_dist(x, y, N[E[ei][0]], N[E[ei][1]]) <= r: return True
    return False

def new_node(x, y):
    N.append([x, y]); i = len(N) - 1; ngrid[(x // C, y // C)].append(i); return i
deg = defaultdict(int)
for e in E: deg[e[0]] += 1; deg[e[1]] += 1
def add_edge(a, b, c, ow, nm):
    if a == b: return
    E.append([a, b, c, ow, nm, c]); add_seg(len(E) - 1); deg[a] += 1; deg[b] += 1

def split_near(x, y, r):
    """Если точка лежит на участке дороги (ближе r м), разрезаем участок в этом месте и возвращаем новый узел."""
    best, bd = None, r
    for ei in sgrid[(int(x) // C, int(y) // C)]:
        if E[ei] is None: continue
        d = seg_dist(x, y, N[E[ei][0]], N[E[ei][1]])
        if d <= bd: best, bd = ei, d
    if best is None: return None
    a, b, c, ow, nm, dc = E[best]
    ax, ay = N[a]; bx, by = N[b]; dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
    t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L)) if L else 0
    m = new_node(round(ax + t * dx), round(ay + t * dy))
    E[best] = [a, m, c, ow, nm, dc]; add_seg(best)          # первая половина - на месте старого участка
    E.append([m, b, c, ow, nm, dc]); add_seg(len(E) - 1)     # вторая половина - новым участком
    deg[m] += 2
    return m

name_idx = {n: i for i, n in enumerate(NAMES)}
def nid(name):
    if not name: return -1
    if name not in name_idx: NAMES.append(name); name_idx[name] = len(NAMES) - 1
    return name_idx[name]

added_ways = skipped = connectors = 0
ends = []
edges0, nodes0 = len(E), len(N)
for f in sys.argv[1:]:
    for el in json.load(open(f, encoding="utf-8"))["elements"]:
        t = el.get("tags", {}); c = cls_of(t.get("highway", ""))
        g = el.get("geometry") or []
        if c is None or len(g) < 2: continue
        pts = [xy(p) for p in g]
        # уже есть в игре? (большая часть точек лежит на существующих дорогах)
        on = sum(1 for (x, y) in pts if near_road(x, y, 7))
        if on >= 0.7 * len(pts): skipped += 1; continue
        ow = t.get("oneway"); rev = ow == "-1"
        one = 1 if ow in ("yes", "1", "-1", "true") or t.get("highway") == "motorway" or t.get("junction") == "roundabout" else 0
        if rev: pts = pts[::-1]
        nm = nid(t.get("name"))
        ids = []
        for k, (x, y) in enumerate(pts):
            j = near_node(x, y, 4)   # совпадает с существующим перекрёстком или точкой
            if j is None and True: j = split_near(x, y, 5)   # упирается в дорогу посередине участка - режем участок
            ids.append(j if j is not None else new_node(x, y))
        for a, b in zip(ids, ids[1:]):
            if a != b: add_edge(a, b, c, one, nm)
        ends.extend([ids[0], ids[-1]])
        added_ways += 1

# Висящие концы новых дорог (ни с чем не соединены) - подключаем к ближайшей дороге в пределах 25 м
for end in set(ends):
    if end < nodes0 or deg[end] != 1: continue
    x, y = N[end]; nb = {e[1] if e[0] == end else e[0] for e in E[edges0:] if e[0] == end or e[1] == end}
    best, bd = None, 25 * 25
    for gx in range(int(x - 25) // C, int(x + 25) // C + 1):
        for gy in range(int(y - 25) // C, int(y + 25) // C + 1):
            for i in ngrid[(gx, gy)]:
                if i == end or i in nb: continue
                d = (N[i][0] - x) ** 2 + (N[i][1] - y) ** 2
                if d < bd: best, bd = i, d
    if best is not None: add_edge(end, best, 5, 0, -1); connectors += 1

open(PATH, "w", encoding="utf-8").write(head + json.dumps(D, ensure_ascii=False, separators=(",", ":")) + tail)
print("добавлено дорог:", added_ways, "| уже были:", skipped, "| новых участков:", len(E) - edges0, "| новых узлов:", len(N) - nodes0, "| соединений:", connectors)
