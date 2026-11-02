"""Generate a Chen-notation ER diagram (Graphviz DOT) from a Prisma schema.

Entities  -> green rectangles (weak entities double-bordered)
Attributes-> pink ellipses, primary key underlined, unique keys dashed border
Relations -> blue diamonds with 1 / n cardinalities (identifying ones double)
"""
import re, sys, json

SCHEMA = sys.argv[1]
MODE = sys.argv[2] if len(sys.argv) > 2 else "full"   # full | lean | keys
# keys: entities + primary keys + foreign keys only (Organization edges as in lean)
OUT = sys.argv[3] if len(sys.argv) > 3 else "/dev/stdout"
# optional: --only A,B,C  restricts the diagram to those entities (and relations between them)
ONLY = None
if "--only" in sys.argv:
    ONLY = set(sys.argv[sys.argv.index("--only") + 1].split(","))
# optional: --engine dot|neato   (dot = layered top-down, best for small diagrams)
ENGINE = sys.argv[sys.argv.index("--engine") + 1] if "--engine" in sys.argv else "neato"
# optional (dot only): --same A,B;C,D   force groups of entities onto the same rank
SAME = [g.split(",") for g in sys.argv[sys.argv.index("--same") + 1].split(";")] if "--same" in sys.argv else []
# optional: --title "text"   diagram caption (top-left)
TITLE = sys.argv[sys.argv.index("--title") + 1] if "--title" in sys.argv else ""

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
        fname, ftype = parts[0], parts[1]
        attrs = line[len(parts[0]) + len(parts[1]) + 2:]
        fields.append(dict(name=fname, type=ftype, attrs=attrs))
    models[name] = fields

model_names = set(models)
rel_labels = {
 ("User","organization"):"employs", ("RefreshToken","user"):"issued to",
 ("Location","organization"):"operates", ("PostTerminal","organization"):"owns",
 ("PostTerminal","store"):"installed at", ("Category","organization"):"defines",
 ("Category","parent"):"parent of", ("Brand","organization"):"defines",
 ("Product","organization"):"catalogs", ("Product","category"):"classified in",
 ("Product","brand"):"made by", ("ProductVariant","organization"):"owns",
 ("ProductVariant","product"):"variant of", ("Supplier","organization"):"contracts",
 ("PurchaseOrder","organization"):"owns", ("PurchaseOrder","supplier"):"ordered from",
 ("PurchaseOrder","location"):"delivered to", ("PurchaseOrderItem","purchaseOrder"):"contains",
 ("PurchaseOrderItem","product"):"orders", ("GoodsReceipt","organization"):"owns",
 ("GoodsReceipt","purchaseOrder"):"fulfils", ("GoodsReceipt","location"):"received at",
 ("GoodsReceiptItem","goodsReceipt"):"contains", ("GoodsReceiptItem","purchaseOrderItem"):"receives",
 ("GoodsReceiptItem","product"):"stocks", ("Sale","organization"):"owns",
 ("Sale","store"):"sold at", ("Sale","terminal"):"rung on", ("SaleItem","sale"):"contains",
 ("SaleItem","product"):"sells", ("Payment","sale"):"pays for",
 ("SaleReturn","organization"):"owns", ("SaleReturn","store"):"returned at",
 ("SaleReturn","sale"):"reverses", ("SaleReturnItem","return"):"contains",
 ("SaleReturnItem","saleItem"):"reverses", ("SaleReturnItem","product"):"returns",
 ("Inventory","organization"):"owns", ("Inventory","product"):"stock of",
 ("Inventory","location"):"held at", ("InventoryMovement","organization"):"owns",
 ("InventoryMovement","product"):"moves", ("InventoryMovement","location"):"occurs at",
 ("StockTransfer","organization"):"owns", ("StockTransfer","sourceLocation"):"ships from",
 ("StockTransfer","destinationLocation"):"ships to", ("StockTransferItem","transfer"):"contains",
 ("StockTransferItem","product"):"transfers", ("StockAdjustment","organization"):"owns",
 ("StockAdjustment","location"):"adjusts at", ("StockAdjustment","createdBy"):"created by",
 ("StockAdjustmentItem","adjustment"):"contains", ("StockAdjustmentItem","product"):"adjusts",
 ("TransactionEvent","organization"):"receives", ("AuditLog","organization"):"owns",
 ("AuditLog","user"):"performed by", ("SupplierUser","organization"):"registers",
 ("SupplierUser","supplier"):"works for", ("SupplierRefreshToken","supplierUser"):"issued to",
 ("SupplierUpload","organization"):"owns", ("SupplierUpload","supplierUser"):"uploaded by",
 ("SupplierUpload","location"):"accepted into", ("SupplierUploadItem","upload"):"contains",
 ("SupplierUploadItem","stockedLocation"):"stocked at", ("SupplierNotification","organization"):"owns",
 ("SupplierNotification","supplierUser"):"notifies", ("SupplierNotification","upload"):"about",
 ("VendorNotification","organization"):"owns", ("VendorNotification","user"):"notifies",
 ("VendorNotification","upload"):"about",
}
# Weak entity -> its identifying (owner) relation field
weak = {"PurchaseOrderItem":"purchaseOrder","GoodsReceiptItem":"goodsReceipt","SaleItem":"sale",
        "Payment":"sale","SaleReturnItem":"return","StockTransferItem":"transfer",
        "StockAdjustmentItem":"adjustment","SupplierUploadItem":"upload","RefreshToken":"user",
        "SupplierRefreshToken":"supplierUser","SupplierNotification":"supplierUser",
        "VendorNotification":"user"}
# In lean mode, Organization edges only to these root entities
lean_org = {"User","Location","Category","Brand","Product","Supplier","SupplierUser","TransactionEvent","AuditLog"}

entities, attributes, relations = [], [], []
for mname, fields in models.items():
    if ONLY and mname not in ONLY:
        continue
    fk_cols = set()
    rels = []
    for f in fields:
        base = f["type"].rstrip("?[]")
        if base in model_names:
            if f["type"].endswith("[]"):
                continue  # inverse side
            mm = re.search(r"fields:\s*\[([^\]]+)\]", f["attrs"])
            if not mm:
                continue
            cols = [c.strip() for c in mm.group(1).split(",")]
            fk_cols.update(cols)
            optional = f["type"].endswith("?")
            rels.append(dict(child=mname, field=f["name"], parent=base, optional=optional, cols=cols))
    skip_fk = set()
    for r in rels:
        if MODE in ("lean", "keys") and r["parent"] == "Organization" and mname not in lean_org:
            skip_fk.update(r["cols"])
        if ONLY and r["parent"] not in ONLY:
            skip_fk.update(r["cols"])
    attrs = []
    for f in fields:
        base = f["type"].rstrip("?[]")
        if base in model_names:
            continue
        is_pk = "@id" in f["attrs"]
        is_fk = f["name"] in fk_cols
        if MODE == "keys":
            if not (is_pk or is_fk):
                continue
            if is_fk and f["name"] in skip_fk:
                continue  # Organization FK dropped alongside its lean-mode edge
        elif is_fk:
            continue
        attrs.append(dict(name=f["name"], pk=is_pk, fk=is_fk, unique="@unique" in f["attrs"],
                          optional=f["type"].endswith("?"), type=base))
    entities.append(dict(name=mname, weak=mname in weak))
    attributes.append((mname, attrs))
    for r in rels:
        if MODE in ("lean", "keys") and r["parent"] == "Organization" and mname not in lean_org:
            continue
        if ONLY and r["parent"] not in ONLY:
            continue
        relations.append(r)

def esc(s): return s.replace('"', '\\"')

SPLINES = sys.argv[sys.argv.index("--splines") + 1] if "--splines" in sys.argv else "true"
out = []
out.append('graph ER {')
if ENGINE == "dot":
    out.append(f'  graph [layout=dot, rankdir=TB, splines={SPLINES}, nodesep=0.45, ranksep=0.9, newrank=true, bgcolor="white", pad=0.5, outputorder=edgesfirst, fontname="Helvetica"];')
else:
    SEP = '"+12"' if MODE == "keys" else '"+18"'
    out.append(f'  graph [layout=neato, overlap=vpsc, mode=major, splines=true, sep={SEP}, start=42, bgcolor="white", pad=0.5, outputorder=edgesfirst, fontname="Helvetica"];')
RLEN = 2.6 if MODE == "keys" else 3.4   # entity -- diamond edge length (neato only)
out.append('  node  [fontname="Helvetica", fontsize=12, penwidth=1.4];')
out.append('  edge  [color="#8b93a1", penwidth=1.2, fontname="Helvetica-Bold", fontsize=13, fontcolor="#1f2937", labeldistance=1.6, labelangle=30];')
# palette
ENT_FILL, ENT_LINE, ENT_TEXT = "#c8e6c9", "#5aa469", "#1b3a1f"
REL_FILL, REL_LINE, REL_TEXT = "#cfe3f7", "#6d9fd6", "#0f2d4f"
ATT_FILL, ATT_LINE, ATT_TEXT = "#fbd5df", "#e08aa4", "#3a1f2a"
PK_FILL, PK_LINE = "#fbd5df", "#c0392b"
FK_FILL, FK_LINE = "#fbd5df", "#e08aa4"
SPLINES = sys.argv[sys.argv.index("--splines") + 1] if "--splines" in sys.argv else "true"
for e in entities:
    per = 2 if e["weak"] else 1
    out.append(f'  "{e["name"]}" [shape=box, style="filled", fillcolor="{ENT_FILL}", color="{ENT_LINE}", fontcolor="{ENT_TEXT}", fontsize=16, fontname="Helvetica-Bold", peripheries={per}, width=1.7, height=0.55, margin="0.18,0.08"];')
for mname, attrs in attributes:
    for a in attrs:
        nid = f'{mname}.{a["name"]}'
        if a["pk"]:
            label = f'<U><B>{a["name"]}</B></U>'
        elif a.get("fk"):
            label = f'<I>{a["name"]}</I> <FONT POINT-SIZE="8">(FK)</FONT>'
        else:
            label = a["name"]
        style = "filled,dashed" if a["unique"] and not a["pk"] else "filled"
        color = PK_LINE if a["pk"] else (FK_LINE if a.get("fk") else ATT_LINE)
        fill = PK_FILL if a["pk"] else (FK_FILL if a.get("fk") else ATT_FILL)
        tip = esc(a["type"]) + ("?" if a["optional"] else "")
        out.append(f'  "{nid}" [shape=ellipse, label=<{label}>, style="{style}", fillcolor="{fill}", color="{color}", fontcolor="{ATT_TEXT}", margin="0.05,0.02", tooltip="{tip}"];')
        out.append(f'  "{mname}" -- "{nid}" [penwidth=0.9, color="#b4bac4", len=1.3, weight=1];')
for i, r in enumerate(relations):
    rid = f'rel{i}'
    label = rel_labels.get((r["child"], r["field"]), r["field"])
    identifying = weak.get(r["child"]) == r["field"]
    per = 2 if identifying else 1
    out.append(f'  "{rid}" [shape=diamond, label="{esc(label)}", style="filled", fillcolor="{REL_FILL}", color="{REL_LINE}", fontcolor="{REL_TEXT}", peripheries={per}, width=1.4, height=0.85, margin="0.02,0.02", fixedsize=false];')
    out.append(f'  "{r["parent"]}" -- "{rid}" [taillabel="1", len={RLEN}, weight=3];')
    out.append(f'  "{rid}" -- "{r["child"]}" [headlabel="n", len={RLEN}, weight=3, penwidth={2.4 if identifying else 1.2}];')
if ENGINE == "dot":
    for grp in SAME:
        out.append('  {rank=same; ' + "; ".join(f'"{n}"' for n in grp) + ';}')
    # legend, pinned to the bottom-right
    out.append(f'''  "legend" [shape=none, margin=0, label=<
    <TABLE BORDER="0" CELLBORDER="0" CELLSPACING="6" CELLPADDING="4" BGCOLOR="#f8fafc" STYLE="rounded">
      <TR><TD COLSPAN="2" ALIGN="LEFT"><FONT POINT-SIZE="13" COLOR="#1f2937"><B>Legend</B></FONT></TD></TR>
      <TR><TD BGCOLOR="{ENT_FILL}" BORDER="1" COLOR="{ENT_LINE}" WIDTH="34"></TD><TD ALIGN="LEFT"><FONT COLOR="{ATT_TEXT}">Entity (double border = weak entity)</FONT></TD></TR>
      <TR><TD BGCOLOR="{REL_FILL}" BORDER="1" COLOR="{REL_LINE}"></TD><TD ALIGN="LEFT"><FONT COLOR="{ATT_TEXT}">Relationship, 1 : n cardinality</FONT></TD></TR>
      <TR><TD BGCOLOR="{PK_FILL}" BORDER="1" COLOR="{PK_LINE}"></TD><TD ALIGN="LEFT"><FONT COLOR="{ATT_TEXT}"><U>Primary key</U></FONT></TD></TR>
      <TR><TD BGCOLOR="{FK_FILL}" BORDER="1" COLOR="{FK_LINE}"></TD><TD ALIGN="LEFT"><FONT COLOR="{ATT_TEXT}"><I>Foreign key</I></FONT></TD></TR>
    </TABLE>>];''')
if TITLE:
    out.append(f'  label=<<FONT POINT-SIZE="22" COLOR="#10315e"><B>{esc(TITLE)}</B></FONT>>; labelloc=t; labeljust=l;')
out.append('}')
open(OUT, "w").write("\n".join(out))
stats = dict(entities=len(entities), attributes=sum(len(a) for _, a in attributes), relations=len(relations))
print(json.dumps(stats), file=sys.stderr)
