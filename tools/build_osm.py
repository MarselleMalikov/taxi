# Конвертер выгрузок OpenStreetMap (overpass-turbo) в компактный файл для игры.
# Запуск:  python3 tools/build_osm.py      (нужны пакеты shapely и numpy)
# Сырые выгрузки лежат не в main, а в отдельной ветке osm-data (чтобы сайт на GitHub Pages был лёгким).
# Достать их в папку osm/:  git fetch origin osm-data && git checkout origin/osm-data -- osm
# После сборки папку osm/ в main не коммитить.
# Читает:  osm/nature.json, osm/places.json, osm/buildings_*.json
# Пишет:   osmmap.js
#
# Что делает:
#   - переводит широту/долготу в метры карты (как в mapdata.js)
#   - собирает сложные контуры (реки, большие леса, дома с внутренним двором) из кусков
#   - обрезает всё по границе карты и упрощает контуры (мелочь, которой не видно на экране, убирает)
#   - координаты хранит целыми метрами, и каждую точку как сдвиг от предыдущей - так файл в разы меньше
import json, glob, os
from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString, box
from shapely.ops import polygonize, linemerge, unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSM = os.path.join(ROOT, "osm")
src = open(os.path.join(ROOT, "mapdata.js"), encoding="utf-8").read()
MD = json.loads(src[src.index("{"):src.rindex("}") + 1])
G, W, H = MD["geo"], MD["w"], MD["h"]
BOUND = box(0, 0, W, H)

def xy(p): return ((p["lon"] - G["lonMin"]) * G["kx"], (G["latMax"] - p["lat"]) * G["ky"])
def load(name): return json.load(open(os.path.join(OSM, name), encoding="utf-8"))["elements"]

def to_polys(el):
    """Контур объекта как список shapely-полигонов."""
    if el["type"] == "way":
        g = el.get("geometry") or []
        if len(g) < 4 or g[0] != g[-1]: return []
        p = Polygon([xy(q) for q in g])
    else:
        outer, inner = [], []
        for m in el.get("members", []):
            g = m.get("geometry")
            if m.get("type") != "way" or not g or len(g) < 2: continue
            (inner if m.get("role") == "inner" else outer).append(LineString([xy(q) for q in g]))
        if not outer: return []
        p = unary_union(list(polygonize(linemerge(outer))))
        if inner:
            holes = unary_union(list(polygonize(linemerge(inner))))
            if not holes.is_empty: p = p.difference(holes)
    if not p.is_valid: p = p.buffer(0)
    p = p.intersection(BOUND)
    if p.is_empty: return []
    return [q for q in (p.geoms if hasattr(p, "geoms") else [p]) if isinstance(q, Polygon)]

def enc_ring(coords):
    """Кольцо точек -> [x0, y0, dx1, dy1, ...] в целых метрах, без повтора последней точки."""
    pts = [(round(x), round(y)) for x, y in coords][:-1]
    out, px, py = [], 0, 0
    for x, y in pts:
        if (x, y) == (px, py) and out: continue
        out += [x - px, y - py]; px, py = x, y
    return out if len(out) >= 6 else None

def enc_poly(p, tol, min_area):
    p = p.simplify(tol, preserve_topology=True)
    if p.is_empty or p.area < min_area: return None
    rings = [enc_ring(p.exterior.coords)] + [enc_ring(r.coords) for r in p.interiors if Polygon(r).area >= min_area]
    rings = [r for r in rings if r]
    if not rings: return None
    return rings[0] if len(rings) == 1 else rings   # дом без двора - просто массив чисел

# ---------- природа ----------
nature = {"water": [], "wood": [], "park": [], "grass": [], "cemetery": []}
rivers = []
for el in load("nature.json"):
    t = el.get("tags", {})
    ww = t.get("waterway")
    if el["type"] == "way" and ww in ("river", "canal") and not (el["geometry"][0] == el["geometry"][-1]):
        ln = LineString([xy(q) for q in el["geometry"]]).intersection(BOUND)
        if ln.is_empty: continue
        for part in (ln.geoms if hasattr(ln, "geoms") else [ln]):
            if isinstance(part, LineString):
                s = part.simplify(4)
                if s.length > 30: rivers.append(enc_ring(list(s.coords) + [s.coords[0]]))
        continue
    if t.get("natural") == "water" or ww == "riverbank": kind = "water"
    elif t.get("natural") == "wood" or t.get("landuse") == "forest": kind = "wood"
    elif t.get("leisure") in ("park", "garden") or t.get("landuse") == "recreation_ground": kind = "park"
    elif t.get("landuse") in ("grass", "meadow"): kind = "grass"
    elif t.get("landuse") == "cemetery": kind = "cemetery"
    else: continue
    for p in to_polys(el):
        e = enc_poly(p, 3 if kind == "water" else 4, 150)
        if e: nature[kind].append(e)
rivers = [r for r in rivers if r]

# ---------- дома ----------
seen, buildings = set(), []
for f in sorted(glob.glob(os.path.join(OSM, "buildings_*.json"))):
    for el in json.load(open(f, encoding="utf-8"))["elements"]:
        key = (el["type"], el["id"])
        if key in seen: continue   # на стыке частей один дом приходит дважды
        seen.add(key)
        for p in to_polys(el):
            e = enc_poly(p, 0.8, 12)
            if e: buildings.append(e)

# ---------- места ----------
CAT = [   # (тег, значения, наша категория)
    ("amenity", {"hospital", "clinic"}, "hospital"), ("amenity", {"pharmacy"}, "pharmacy"),
    ("amenity", {"cafe"}, "cafe"), ("amenity", {"restaurant", "fast_food"}, "food"),
    ("shop", {"supermarket", "convenience", "department_store"}, "shop"), ("shop", {"mall"}, "mall"),
    ("amenity", {"bank"}, "bank"), ("amenity", {"fuel"}, "fuel"),
    ("amenity", {"school", "kindergarten"}, "school"), ("amenity", {"university", "college"}, "university"),
    ("amenity", {"cinema", "theatre"}, "culture"), ("tourism", {"museum", "attraction"}, "museum"),
    ("tourism", {"hotel"}, "hotel"), ("leisure", {"stadium", "sports_centre"}, "sport"), ("leisure", {"park"}, "park"),
]
pois, pseen = [], set()
for el in load("places.json"):
    t = el.get("tags", {}); name = t.get("name")
    if not name: continue
    c = el if el["type"] == "node" else el.get("center")
    if not c: continue
    cat = next((k for tag, vals, k in CAT if t.get(tag) in vals), None)
    if not cat: continue
    x, y = xy(c)
    if not (0 <= x <= W and 0 <= y <= H): continue
    k = (name, round(x / 50), round(y / 50))
    if k in pseen: continue
    pseen.add(k); pois.append([round(x), round(y), cat, name])

# ---------- адреса (настоящие номера домов) ----------
# Вес - насколько часто отсюда (и сюда) вызывают такси: в многоэтажке живёт больше людей, чем в частном доме
SKIP = {"garage", "garages", "shed", "industrial", "warehouse", "construction", "roof", "service", "hut", "greenhouse",
        "transformer_tower", "barn", "farm_auxiliary", "kiosk", "toilets", "bunker", "ruins", "container", "carport"}
WEIGHT = {"apartments": 4, "residential": 3, "dormitory": 3, "yes": 1.5, "house": 0.7, "detached": 0.7, "semidetached_house": 0.7,
          "terrace": 1, "retail": 1.5, "commercial": 1.5, "office": 1.5, "school": 0.6, "university": 2, "hospital": 2, "hotel": 1.5}
streets, sidx, addrs, aseen = [], {}, [], set()
for f in sorted(glob.glob(os.path.join(OSM, "addresses*.json"))):
    for el in json.load(open(f, encoding="utf-8"))["elements"]:
        t = el.get("tags", {}); st, num = t.get("addr:street"), t.get("addr:housenumber")
        b = t.get("building")
        if not st or not num or b in SKIP: continue
        c = el if el["type"] == "node" else el.get("center")
        if not c: continue
        x, y = xy(c)
        if not (0 <= x <= W and 0 <= y <= H) or (st, num) in aseen: continue
        aseen.add((st, num))
        if st not in sidx: sidx[st] = len(streets); streets.append(st)
        addrs.append([round(x), round(y), sidx[st], num, WEIGHT.get(b, 1)])

out = {"water": nature["water"], "wood": nature["wood"], "park": nature["park"], "grass": nature["grass"],
       "cemetery": nature["cemetery"], "rivers": rivers, "buildings": buildings, "pois": pois,
       "streets": streets, "addrs": addrs}   # адрес: [x, y, номер улицы в streets, номер дома, вес]
js = ("// Реальная карта Уфы из OpenStreetMap (© участники OpenStreetMap, лицензия ODbL).\n"
      "// Сгенерировано скриптом tools/build_osm.py из файлов в папке osm/. Вручную не править.\n"
      "// Контур: [x0, y0, dx1, dy1, ...] в метрах; контур с дырами (двор, остров) - массив таких контуров.\n"
      "const OSM = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
open(os.path.join(ROOT, "osmmap.js"), "w", encoding="utf-8").write(js)
print({k: len(v) for k, v in out.items()}, "размер:", round(len(js.encode()) / 1e6, 2), "МБ")
