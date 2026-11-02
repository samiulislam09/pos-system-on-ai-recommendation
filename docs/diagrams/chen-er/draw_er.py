"""Hand-laid-out Chen ER diagram -> SVG (no Graphviz).

Entities sit on a grid, relationships are diamonds on straight (mostly
orthogonal) connectors, attributes fan out on a chosen side.  Attribute lists
(primary + foreign keys) are read from the Prisma schema so the picture stays
truthful; only the *placement* is hand-written in LAYOUTS below.

usage: python3 draw_er.py <schema.prisma> <layout-name> <out.svg>
"""
import math, re, sys

SCHEMA, LAYOUT_NAME, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

# ----------------------------------------------------------------------------- schema
src = open(SCHEMA).read()
models = {}
for m in re.finditer(r"model\s+(\w+)\s*\{(.*?)\n\}", src, re.S):
    name, body = m.group(1), m.group(2)
    fields = []
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("//") or line.startswith("@@"):
            continue
        parts = line.split()
        fields.append(dict(name=parts[0], type=parts[1], attrs=line[len(parts[0]) + len(parts[1]) + 2:]))
    models[name] = fields
model_names = set(models)

def keys_of(entity, drop_fk=()):
    """[(name, kind)] with kind in {pk, fk}; FK columns pointing at dropped relations are omitted."""
    fk_cols, fks = set(), []
    for f in models[entity]:
        base = f["type"].rstrip("?[]")
        if base in model_names and not f["type"].endswith("[]"):
            mm = re.search(r"fields:\s*\[([^\]]+)\]", f["attrs"])
            if mm:
                cols = [c.strip() for c in mm.group(1).split(",")]
                if base not in drop_fk:
                    fk_cols.update(cols)
    out = []
    for f in models[entity]:
        if "@id" in f["attrs"]:
            out.append((f["name"], "pk"))
    for f in models[entity]:
        if f["name"] in fk_cols and "@id" not in f["attrs"]:
            out.append((f["name"], "fk"))
    return out

# ----------------------------------------------------------------------------- layouts
# grid: col -> x, row -> y.  Routes: "auto" = straight line; list of (x, y) = polyline
# in grid units (floats allowed); 'd' = where the diamond sits (0..1 along the path) or
# an explicit (x, y) in grid units.
LAYOUTS = {
    "core15": dict(
        title="POS core data model  ·  Chen ER (15 tables, keys only)",
        col_w=420, row_h=230, origin=(300, 150),
        # entities drawn with Organization FK only on these (tenancy roots), as in gen_er.py lean mode
        org_roots={"User", "Location", "Category", "Product", "Supplier"},
        weak={"PurchaseOrderItem", "SaleItem", "Payment"},
        entities={
            #  name                   col  row  attribute side
            # side: left/right/top/bottom, or explicit [(dx, dy), ...] offsets from the box centre
            "User":                  (0,   0,   "left"),
            "Organization":          (1,   0,   "top"),
            "Category":              (2,   0,   "top"),
            "Supplier":              (0,   1,   "left"),
            "PurchaseOrderItem":     (1,   1,   "left"),
            "Product":               (2,   1,   [(205, -150), (205, -105), (205, -60)]),
            "SaleItem":              (3,   1,   "right"),
            "PurchaseOrder":         (0,   2,   "left"),
            "Inventory":             (1,   2,   "left"),
            "InventoryMovement":     (2,   2,   "left"),
            "Sale":                  (3,   2,   [(120, 100), (260, 100), (400, 100)]),
            "Payment":               (4,   2,   "right"),
            "GoodsReceipt":          (0,   3,   "left"),
            "Location":              (2,   3,   "bottom"),
            "PostTerminal":          (3,   3,   "bottom"),
        },
        relations=[
            # parent (1)        child (n)             label            route        diamond
            ("User",            "Organization",       "employs",        "auto",      0.5),   # drawn n at Org side? no: Org 1 -- n User
            ("Organization",    "Category",           "defines",        "auto",      0.5),
            ("Organization",    "Supplier",           "contracts",      "auto",      0.5),
            ("Organization",    "Product",            "catalogs",       "auto",      0.5),
            ("Category",        "Product",            "classified in",  "auto",      0.5),
            ("Product",         "PurchaseOrderItem",  "orders",         "auto",      0.5),
            ("PurchaseOrder",   "PurchaseOrderItem",  "contains",       "auto",      0.5),
            ("Supplier",        "PurchaseOrder",      "ordered from",   "auto",      0.5),
            ("PurchaseOrder",   "GoodsReceipt",       "fulfils",        "auto",      0.5),
            ("Product",         "SaleItem",           "sells",          "auto",      0.5),
            ("Product",         "Inventory",          "stock of",       "auto",      0.5),
            ("Product",         "InventoryMovement",  "moves",          "auto",      0.5),
            ("Location",        "InventoryMovement",  "occurs at",      "auto",      0.5),
            ("Location",        "Inventory",          "held at",        "auto",      0.3),
            ("Location",        "Sale",               "sold at",        "auto",      0.5),
            ("Sale",            "SaleItem",           "contains",       "auto",      0.5),
            ("Sale",            "Payment",            "pays for",       "auto",      0.5),
            ("PostTerminal",    "Sale",               "rung on",        "auto",      0.5),
            ("Location",        "PostTerminal",       "installed at",   "auto",      0.5),
            # routed: GoodsReceipt -> under the bottom row -> up into Location
            ("Location",        "GoodsReceipt",       "received at",    [(2, 3), (2, 3.55), (0, 3.55), (0, 3)], (1, 3.55)),
            # routed: PurchaseOrder -> right, down a lane, into Location's left side
            ("Location",        "PurchaseOrder",      "delivered to",   [(2, 3), (0.3, 3), (0.3, 2), (0, 2)], (1, 3)),
            ("Category",        "Category",           "parent of",      "self",      None),
        ],
        # fix the 1 / n sides where the parent is listed second above (Organization employs User)
        flip={"employs"},
    ),
}

L = LAYOUTS[LAYOUT_NAME]
COL_W, ROW_H = L["col_w"], L["row_h"]
OX, OY = L["origin"]
def G(c, r):  # grid -> px
    return (OX + c * COL_W, OY + r * ROW_H)

EW, EH = 170, 54          # entity box
DW, DH = 136, 66          # diamond
AW, AH = 132, 40          # attribute ellipse (full width / height)
FONT = "Helvetica, Arial, sans-serif"

C = dict(ent_fill="#c8e6c9", ent_line="#5aa469", ent_text="#1b3a1f",
         rel_fill="#cfe3f7", rel_line="#6d9fd6", rel_text="#0f2d4f",
         att_fill="#fbd5df", att_line="#e08aa4", att_text="#3a1f2a",
         pk_line="#c0392b", line="#6b7280", card="#111827")

ent_px = {n: G(c, r) for n, (c, r, _) in L["entities"].items()}

# ----------------------------------------------------------------------------- geometry
def clip_rect(cx, cy, w, h, tx, ty):
    """point on the border of the rect centred at (cx,cy) in direction of (tx,ty)"""
    dx, dy = tx - cx, ty - cy
    if dx == 0 and dy == 0:
        return cx, cy
    sx = (w / 2) / abs(dx) if dx else math.inf
    sy = (h / 2) / abs(dy) if dy else math.inf
    s = min(sx, sy)
    return cx + dx * s, cy + dy * s

def polyline_len(pts):
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))

def point_at(pts, t):
    target = polyline_len(pts) * t
    for i in range(len(pts) - 1):
        seg = math.dist(pts[i], pts[i + 1])
        if target <= seg or i == len(pts) - 2:
            f = target / seg if seg else 0
            return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
                    pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f)
        target -= seg

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

# ----------------------------------------------------------------------------- build
lines, shapes, texts = [], [], []

def line(p, q, width=1.7, color=None):
    lines.append(f'<line x1="{p[0]:.1f}" y1="{p[1]:.1f}" x2="{q[0]:.1f}" y2="{q[1]:.1f}" '
                 f'stroke="{color or C["line"]}" stroke-width="{width}" stroke-linecap="round"/>')

def polyline(pts, width=1.7):
    d = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    lines.append(f'<polyline points="{d}" fill="none" stroke="{C["line"]}" stroke-width="{width}" '
                 f'stroke-linejoin="round" stroke-linecap="round"/>')

def card(p, q, label):
    """cardinality label next to endpoint p of segment p->q, offset to the side"""
    dx, dy = q[0] - p[0], q[1] - p[1]
    n = math.hypot(dx, dy) or 1
    ux, uy = dx / n, dy / n
    # 18px along the line from the box, 12px perpendicular (to the right of travel)
    x = p[0] + ux * 26 - uy * 13
    y = p[1] + uy * 26 + ux * 13
    texts.append(f'<text x="{x:.1f}" y="{y + 5:.1f}" text-anchor="middle" font-family="{FONT}" '
                 f'font-size="15" font-weight="700" fill="{C["card"]}">{label}</text>')

def entity(name, cx, cy, weak):
    r = f'<rect x="{cx - EW/2:.1f}" y="{cy - EH/2:.1f}" width="{EW}" height="{EH}" rx="4" ' \
        f'fill="{C["ent_fill"]}" stroke="{C["ent_line"]}" stroke-width="2"/>'
    shapes.append(r)
    if weak:
        shapes.append(f'<rect x="{cx - EW/2 + 5:.1f}" y="{cy - EH/2 + 5:.1f}" width="{EW - 10}" height="{EH - 10}" rx="2" '
                      f'fill="none" stroke="{C["ent_line"]}" stroke-width="1.5"/>')
    size = 17 if len(name) <= 14 else 15
    texts.append(f'<text x="{cx:.1f}" y="{cy + 6:.1f}" text-anchor="middle" font-family="{FONT}" '
                 f'font-size="{size}" font-weight="700" fill="{C["ent_text"]}">{esc(name)}</text>')

def diamond(cx, cy, label, identifying=False):
    pts = f"{cx:.1f},{cy - DH/2:.1f} {cx + DW/2:.1f},{cy:.1f} {cx:.1f},{cy + DH/2:.1f} {cx - DW/2:.1f},{cy:.1f}"
    shapes.append(f'<polygon points="{pts}" fill="{C["rel_fill"]}" stroke="{C["rel_line"]}" stroke-width="2"/>')
    if identifying:
        k = 0.78
        pts2 = f"{cx:.1f},{cy - DH/2*k:.1f} {cx + DW/2*k:.1f},{cy:.1f} {cx:.1f},{cy + DH/2*k:.1f} {cx - DW/2*k:.1f},{cy:.1f}"
        shapes.append(f'<polygon points="{pts2}" fill="none" stroke="{C["rel_line"]}" stroke-width="1.3"/>')
    texts.append(f'<text x="{cx:.1f}" y="{cy + 5:.1f}" text-anchor="middle" font-family="{FONT}" '
                 f'font-size="14" fill="{C["rel_text"]}">{esc(label)}</text>')

def attribute(cx, cy, name, kind):
    stroke = C["pk_line"] if kind == "pk" else C["att_line"]
    shapes.append(f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{AW/2}" ry="{AH/2}" fill="{C["att_fill"]}" '
                  f'stroke="{stroke}" stroke-width="{2 if kind == "pk" else 1.5}"/>')
    if kind == "pk":
        texts.append(f'<text x="{cx:.1f}" y="{cy + 5:.1f}" text-anchor="middle" font-family="{FONT}" font-size="14" '
                     f'font-weight="700" text-decoration="underline" fill="{C["att_text"]}">{esc(name)}</text>')
    else:
        texts.append(f'<text x="{cx:.1f}" y="{cy + 5:.1f}" text-anchor="middle" font-family="{FONT}" font-size="13" '
                     f'font-style="italic" fill="{C["att_text"]}">{esc(name)}'
                     f'<tspan font-size="9" font-style="normal" dy="-1"> (FK)</tspan></text>')

# entities + attributes
for name, (c, r, side) in L["entities"].items():
    cx, cy = ent_px[name]
    entity(name, cx, cy, name in L["weak"])
    drop = set(model_names) - set(L["entities"])
    if name not in L["org_roots"]:
        drop.add("Organization")
    keys = keys_of(name, drop_fk=drop)
    n = len(keys)
    for i, (kname, kind) in enumerate(keys):
        off = i - (n - 1) / 2
        if isinstance(side, list):
            ax, ay = cx + side[i][0], cy + side[i][1]
        elif side.startswith("left"):
            ax, ay = cx - EW / 2 - 70 - AW / 2, cy + off * (AH + 10)
        elif side.startswith("right"):
            ax, ay = cx + EW / 2 + 70 + AW / 2, cy + off * (AH + 10)
            if side == "right-up":
                ay -= 30
        elif side.startswith("top"):
            ax, ay = cx + off * (AW + 8), cy - EH / 2 - 56
        else:  # bottom
            ax, ay = cx + off * (AW + 8), cy + EH / 2 + 56
        p = clip_rect(cx, cy, EW, EH, ax, ay)
        q = clip_rect(ax, ay, AW, AH, cx, cy)
        line(p, q, width=1.3, color="#9aa3af")
        attribute(ax, ay, kname, kind)

# relations
for parent, child, label, route, dpos in L["relations"]:
    identifying = child in L["weak"] and label == "contains" or (child == "Payment")
    P, Ch = ent_px[parent], ent_px[child]
    if route == "self":
        # loop to the right of the entity: two short stubs into a diamond
        cx, cy = P[0] + EW / 2 + 110, P[1]
        a = (P[0] + EW / 2, P[1] - 12); b = (P[0] + EW / 2, P[1] + 12)
        line(a, (cx, cy - 12)); line(b, (cx, cy + 12))
        card(a, (cx, cy - 12), "1"); card(b, (cx, cy + 12), "n")
        diamond(cx, cy, label)
        continue
    if route == "auto":
        pts = [clip_rect(*P, EW, EH, *Ch), clip_rect(*Ch, EW, EH, *P)]
    else:
        gpts = [G(x, y) for x, y in route]
        inner = [g for g in gpts if g not in (P, Ch)]
        start = clip_rect(*P, EW, EH, *inner[0])
        end = clip_rect(*Ch, EW, EH, *inner[-1])
        pts = [start] + inner + [end]
    polyline(pts, width=2.3 if identifying else 1.7)
    one, many = ("n", "1") if label in L["flip"] else ("1", "n")
    card(pts[0], pts[1], one)
    card(pts[-1], pts[-2], many)
    if isinstance(dpos, tuple):
        dx, dy = G(*dpos)
    else:
        dx, dy = point_at(pts, dpos)
    diamond(dx, dy, label, identifying)

# canvas size
xs = [float(v) for s in lines + shapes for v in re.findall(r'(?:x\d?|cx|x1|x2)="(-?[\d.]+)"', s)]
ys = [float(v) for s in lines + shapes for v in re.findall(r'(?:y\d?|cy|y1|y2)="(-?[\d.]+)"', s)]
for s in shapes:  # polygons / polylines
    for x, y in re.findall(r'(-?[\d.]+),(-?[\d.]+)', s):
        xs.append(float(x)); ys.append(float(y))
W = int(max(xs) + 120); H = int(max(ys) + 90)

svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
       f'<rect width="100%" height="100%" fill="white"/>']
if L.get("title"):
    svg.append(f'<text x="40" y="52" font-family="{FONT}" font-size="24" font-weight="700" fill="#1b3a1f">{esc(L["title"])}</text>')
svg += lines + shapes + texts
svg.append(f'<text x="40" y="{H - 28}" font-family="{FONT}" font-size="14" fill="#4b5563">'
           f'<tspan font-weight="700" text-decoration="underline">id</tspan> primary key'
           f'   ·   <tspan font-style="italic">name</tspan> <tspan font-size="10">(FK)</tspan> foreign key'
           f'   ·   double border = weak entity / identifying relationship   ·   1 : n cardinality</text>')
svg.append("</svg>")
open(OUT, "w").write("\n".join(svg))
print(f"{OUT} {W}x{H}", file=sys.stderr)
