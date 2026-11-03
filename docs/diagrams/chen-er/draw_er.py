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
    "full33": dict(
        title="POS data model  ·  Chen ER (33 tables, keys only)",
        col_w=520, row_h=300, origin=(1400, 420),
        org_roots={"User", "Location", "Category", "Brand", "Product", "Supplier", "SupplierUser", "TransactionEvent", "AuditLog"},
        weak={"PurchaseOrderItem", "GoodsReceiptItem", "SaleItem", "Payment", "SaleReturnItem",
              "StockTransferItem", "StockAdjustmentItem", "SupplierUploadItem"},
        entities={
            # auth / tenancy
            "AuditLog":              (1, -1, "auto"),
            "TransactionEvent":      (2, -1, "auto"),
            "RefreshToken":          (0, 0, "auto"),
            "User":                  (1, 0, "auto"),
            "Organization":          (2, 0, "auto"),
            # catalog
            "Category":              (3, 0, "auto"),
            "ProductVariant":        (2, 1, "auto"),
            "Brand":                 (4, 1, "auto"),
            "Product":               (3, 2, "auto"),
            # procurement
            "Supplier":              (0, 2, "auto"),
            "PurchaseOrderItem":     (2, 2, "auto"),
            "PurchaseOrder":         (1, 3, "auto"),
            "GoodsReceiptItem":      (2, 3, "auto"),
            "GoodsReceipt":          (1, 4, "auto"),
            # inventory
            "InventoryMovement":     (3, 4, "auto"),
            "Inventory":             (4, 3, "auto"),
            "StockTransferItem":     (4, 5, "auto"),
            "StockTransfer":         (4, 6, "auto"),
            "Location":              (3, 5, "auto"),
            "StockAdjustment":       (0, 5, "auto"),
            "StockAdjustmentItem":   (1.9, 6, "auto"),
            # sales
            "SaleItem":              (5, 1, "auto"),
            "Payment":               (7, 1, "auto"),
            "Sale":                  (7, 2, "auto"),
            "SaleReturnItem":        (5, 3, "auto"),
            "SaleReturn":            (7, 3, "auto"),
            "PostTerminal":          (6, 4, "auto"),
            # supplier portal
            "VendorNotification":    (-2, 1, "auto"),
            "SupplierUser":          (0, 3, "auto"),
            "SupplierRefreshToken":  (-1, 3, "auto"),
            "SupplierNotification":  (-1, 4, "auto"),
            "SupplierUpload":        (0, 4, "auto"),
            "SupplierUploadItem":    (-1, 6, "auto"),
        },
        relations=[
            ("User",            "Organization",       "employs",        "auto",  "auto"),
            ("User",            "RefreshToken",       "issued to",      "auto",  "auto"),
            ("User",            "AuditLog",           "performed by",   "auto",  "auto"),
            ("Organization",    "AuditLog",           "owns",           "auto",  "auto"),
            ("Organization",    "TransactionEvent",   "receives",       "auto",  "auto"),
            ("Organization",    "Category",           "defines",        "auto",  "auto"),
            ("Organization",    "Brand",              "defines",        "auto",  "auto"),
            ("Organization",    "Product",            "catalogs",       "auto",  "auto"),
            ("Organization",    "Supplier",           "contracts",      "auto",  "auto"),
            ("Organization",    "SupplierUser",       "registers",      "auto",  "auto"),
            ("Category",        "Category",           "parent of",      "self",  None),
            ("Category",        "Product",            "classified in",  "auto",  "auto"),
            ("Brand",           "Product",            "made by",        "auto",  "auto"),
            ("Product",         "ProductVariant",     "variant of",     "auto",  "auto"),
            ("Supplier",        "PurchaseOrder",      "ordered from",   "auto",  "auto"),
            ("PurchaseOrder",   "PurchaseOrderItem",  "contains",       "auto",  "auto"),
            ("Product",         "PurchaseOrderItem",  "orders",         "auto",  "auto"),
            ("PurchaseOrder",   "GoodsReceipt",       "fulfils",        "auto",  "auto"),
            ("GoodsReceipt",    "GoodsReceiptItem",   "contains",       "auto",  "auto"),
            ("PurchaseOrderItem","GoodsReceiptItem",  "receives",       "auto",  "auto"),
            ("Product",         "GoodsReceiptItem",   "stocks",         "auto",  "auto"),
            ("Location",        "PurchaseOrder",      "delivered to",   "auto",  "auto"),
            ("Location",        "GoodsReceipt",       "received at",    "auto",  "auto"),
            ("Product",         "Inventory",          "stock of",       "auto",  "auto"),
            ("Product",         "InventoryMovement",  "moves",          "auto",  "auto"),
            ("Location",        "Inventory",          "held at",        "auto",  "auto"),
            ("Location",        "InventoryMovement",  "occurs at",      "auto",  "auto"),
            ("Product",         "StockTransferItem",  "transfers",      "auto",  "auto"),
            ("StockTransfer",   "StockTransferItem",  "contains",       "auto",  "auto"),
            ("Location",        "StockTransfer",      "ships from",     "auto",  "auto"),
            ("Location",        "StockTransfer",      "ships to",       [(3, 5), (3, 6), (4, 6)], (3.5, 6)),
            ("Product",         "StockAdjustmentItem","adjusts",        [(3, 2), (2.35, 3.1), (1.9, 6)],  "auto"),
            ("StockAdjustment", "StockAdjustmentItem","contains",       "auto",  "auto"),
            ("Location",        "StockAdjustment",    "adjusts at",     "auto",  "auto"),
            ("User",            "StockAdjustment",    "created by",     [(1, 0), (0.75, -0.5), (-1.8, -0.5), (-1.8, 5), (0, 5)], (-1.8, 2.5)),
            ("Product",         "SaleItem",           "sells",          "auto",  "auto"),
            ("Sale",            "SaleItem",           "contains",       "auto",  "auto"),
            ("Sale",            "Payment",            "pays for",       "auto",  "auto"),
            ("Sale",            "SaleReturn",         "reverses",       "auto",  "auto"),
            ("SaleReturn",      "SaleReturnItem",     "contains",       "auto",  "auto"),
            ("SaleItem",        "SaleReturnItem",     "reverses",       "auto",  "auto"),
            ("Product",         "SaleReturnItem",     "returns",        "auto",  "auto"),
            ("Location",        "Sale",               "sold at",        "auto",  "auto"),
            ("Location",        "SaleReturn",         "returned at",    "auto",  "auto"),
            ("PostTerminal",    "Sale",               "rung on",        "auto",  "auto"),
            ("Location",        "PostTerminal",       "installed at",   "auto",  "auto"),
            ("Supplier",        "SupplierUser",       "works for",      "auto",  "auto"),
            ("SupplierUser",    "SupplierRefreshToken","issued to",     "auto",  "auto"),
            ("SupplierUser",    "SupplierUpload",     "uploaded by",    "auto",  "auto"),
            ("Location",        "SupplierUpload",     "accepted into",  "auto",  "auto"),
            ("SupplierUpload",  "SupplierUploadItem", "contains",       "auto",  "auto"),
            ("Location",        "SupplierUploadItem", "stocked at",     "auto",  "auto"),
            ("SupplierUser",    "SupplierNotification","notifies",      "auto",  "auto"),
            ("SupplierUpload",  "SupplierNotification","about",         "auto",  "auto"),
            ("User",            "VendorNotification", "notifies",       "auto",  "auto"),
            ("SupplierUpload",  "VendorNotification", "about",          "auto",  "auto"),
        ],
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

OBST, SEGS = [], []   # (name, x0, y0, x1, y1, owners) / (tag, pts, owners)  for the collision check

# ----------------------------------------------------------------------------- placement
# 1. entity boxes  2. relation paths (depend on boxes only)  3. diamonds  4. attributes.
# Diamonds and attributes with side "auto" are placed by trying candidates and keeping the first
# that collides with nothing already placed (lines are sampled every 4px).
def bbox_hit(a, b, pad=6):
    return a[0] < b[2] + pad and b[0] < a[2] + pad and a[1] < b[3] + pad and b[1] < a[3] + pad

def seg_hits_box(p, q, box, pad=4):
    x0, y0, x1, y1 = box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad
    n = max(2, int(math.dist(p, q) / 4))
    for i in range(n + 1):
        t = i / n
        x, y = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t
        if x0 <= x <= x1 and y0 <= y <= y1:
            return True
    return False

OBST, SEGS = [], []   # (name, x0, y0, x1, y1, owners) / (tag, pts, owners)
def box_free(box, owners, pad=6):
    for name, x0, y0, x1, y1, own in OBST:
        if own & owners:
            continue
        if bbox_hit(box, (x0, y0, x1, y1), pad):
            return False
    for tag, pts, own in SEGS:
        if own & owners:
            continue
        for i in range(len(pts) - 1):
            if seg_hits_box(pts[i], pts[i + 1], box, pad):
                return False
    return True

for name, (c, r, side) in L["entities"].items():
    cx, cy = ent_px[name]
    entity(name, cx, cy, name in L["weak"])
    OBST.append(("entity:" + name, cx - EW/2, cy - EH/2, cx + EW/2, cy + EH/2, {name}))

# relation paths
rel_geom = []
for parent, child, label, route, dpos in L["relations"]:
    identifying = child in L["weak"] and label in L.get("identifying", {"contains", "pays for"})
    P, Ch = ent_px[parent], ent_px[child]
    tag = f"{parent}->{child} ({label})"
    if isinstance(route, str) and route.startswith("self"):
        side = route[5:] or "right"
        if side in ("right", "left"):
            sgn = 1 if side == "right" else -1
            cx, cy = P[0] + sgn * (EW / 2 + 110), P[1]
            a = (P[0] + sgn * EW / 2, P[1] - 12); b = (P[0] + sgn * EW / 2, P[1] + 12)
            segs = [(a, (cx - sgn * DW / 2, cy - 12)), (b, (cx - sgn * DW / 2, cy + 12))]
        else:
            sgn = 1 if side == "bottom" else -1
            cx, cy = P[0], P[1] + sgn * (EH / 2 + 80)
            a = (P[0] - 14, P[1] + sgn * EH / 2); b = (P[0] + 14, P[1] + sgn * EH / 2)
            segs = [(a, (cx - 14, cy - sgn * DH / 2)), (b, (cx + 14, cy - sgn * DH / 2))]
        for p_, q_ in segs:
            line(p_, q_); SEGS.append((tag, [p_, q_], {parent, tag}))
        card(segs[0][0], segs[0][1], "1"); card(segs[1][0], segs[1][1], "n")
        diamond(cx, cy, label)
        OBST.append(("diamond:" + tag, cx - DW/2, cy - DH/2, cx + DW/2, cy + DH/2, {tag}))
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
    SEGS.append((tag, pts, {parent, child, tag}))
    rel_geom.append((tag, parent, child, label, pts, dpos, identifying))

# diamonds
for tag, parent, child, label, pts, dpos, identifying in rel_geom:
    if isinstance(dpos, tuple):
        cands = [G(*dpos)]
    elif dpos == "auto":
        cands = [point_at(pts, t) for t in (0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.2, 0.8)]
    else:
        cands = [point_at(pts, dpos)]
    chosen = None
    for dx, dy in cands:
        box = (dx - DW/2, dy - DH/2, dx + DW/2, dy + DH/2)
        if box_free(box, {tag}):
            chosen = (dx, dy); break
    if chosen is None:
        chosen = cands[0]
        print(f"WARN diamond {tag}: no free spot", file=sys.stderr)
    dx, dy = chosen
    diamond(dx, dy, label, identifying)
    OBST.append(("diamond:" + tag, dx - DW/2, dy - DH/2, dx + DW/2, dy + DH/2, {tag}))

# attributes
def attr_candidates(side, n):
    """list of candidate offset lists (dx, dy from entity centre)"""
    def stack(x, step=AH + 10, shift=0):
        return [(x, (i - (n - 1) / 2) * step + shift) for i in range(n)]
    def row(y, step=AW + 8, shift=0):
        return [((i - (n - 1) / 2) * step + shift, y) for i in range(n)]
    def block(sx, sy):   # 2-column block in a corner
        cols = 2
        out = []
        for i in range(n):
            col, rw = i % cols, i // cols
            out.append((sx * (EW / 2 + 60 + AW / 2 + col * (AW + 8)), sy * (EH / 2 + 26 + AH / 2 + rw * (AH + 8))))
        return out
    L_ = EW / 2 + 70 + AW / 2
    T_ = EH / 2 + 56
    named = {
        "left": stack(-L_), "right": stack(L_), "top": row(-T_), "bottom": row(T_),
        "left-up": stack(-L_, shift=-30), "right-up": stack(L_, shift=-30),
        "left-down": stack(-L_, shift=30), "right-down": stack(L_, shift=30),
        "top-left": row(-T_, shift=-100), "top-right": row(-T_, shift=100),
        "bottom-left": row(T_, shift=-100), "bottom-right": row(T_, shift=100),
        "block-tr": block(1, -1), "block-tl": block(-1, -1), "block-br": block(1, 1), "block-bl": block(-1, 1),
    }
    if isinstance(side, list):
        return [side]
    if side == "auto":
        order = ["left", "right", "top", "bottom", "left-up", "left-down", "right-up", "right-down",
                 "top-left", "top-right", "bottom-left", "bottom-right", "block-tl", "block-tr", "block-bl", "block-br"]
        return [named[k] for k in order]
    return [named[side]]

for name, (c, r, side) in L["entities"].items():
    cx, cy = ent_px[name]
    drop = set(model_names) - set(L["entities"])
    if name not in L["org_roots"]:
        drop.add("Organization")
    keys = keys_of(name, drop_fk=drop)
    n = len(keys)
    if n == 0:
        continue
    chosen = None
    for offs in attr_candidates(side, n):
        ok = True
        for (dx, dy) in offs:
            ax, ay = cx + dx, cy + dy
            if not box_free((ax - AW/2, ay - AH/2, ax + AW/2, ay + AH/2), {name}):
                ok = False; break
            p = clip_rect(cx, cy, EW, EH, ax, ay); q = clip_rect(ax, ay, AW, AH, cx, cy)
            # connector must not run through other things either
            for oname, x0, y0, x1, y1, own in OBST:
                if own & {name}: continue
                if seg_hits_box(p, q, (x0, y0, x1, y1), 2): ok = False; break
            if not ok: break
        if ok:
            chosen = offs; break
    if chosen is None:
        chosen = attr_candidates(side, n)[0]
        print(f"WARN attrs {name}: no free side", file=sys.stderr)
    for (kname, kind), (dx, dy) in zip(keys, chosen):
        ax, ay = cx + dx, cy + dy
        p = clip_rect(cx, cy, EW, EH, ax, ay)
        q = clip_rect(ax, ay, AW, AH, cx, cy)
        line(p, q, width=1.3, color="#9aa3af")
        attribute(ax, ay, kname, kind)
        OBST.append((f"attr:{name}.{kname}", ax - AW/2, ay - AH/2, ax + AW/2, ay + AH/2, {name}))

# ----------------------------------------------------------------------------- collision report
warn = 0
for tag, pts, own in SEGS:
    for name, x0, y0, x1, y1, owners in OBST:
        if own & owners:
            continue
        for i in range(len(pts) - 1):
            if seg_hits_box(pts[i], pts[i + 1], (x0, y0, x1, y1)):
                print(f"WARN line {tag} crosses {name}", file=sys.stderr); warn += 1
                break
for i in range(len(OBST)):
    for j in range(i + 1, len(OBST)):
        a, b = OBST[i], OBST[j]
        if a[5] & b[5]:
            continue
        if bbox_hit(a[1:5], b[1:5], -6):
            print(f"WARN overlap {a[0]} / {b[0]}", file=sys.stderr); warn += 1
print(f"{warn} warnings", file=sys.stderr)

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
