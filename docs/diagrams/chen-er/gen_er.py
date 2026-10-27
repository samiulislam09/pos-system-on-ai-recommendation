"""Generate a Chen-notation ER diagram (Graphviz DOT) from a Prisma schema.

Entities  -> green rectangles (weak entities double-bordered)
Attributes-> pink ellipses, primary key underlined, unique keys dashed border
Relations -> blue diamonds with 1 / n cardinalities (identifying ones double)
"""
import re, sys, json

SCHEMA = sys.argv[1]
MODE = sys.argv[2] if len(sys.argv) > 2 else "full"   # full | lean
OUT = sys.argv[3] if len(sys.argv) > 3 else "/dev/stdout"

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
            rels.append(dict(child=mname, field=f["name"], parent=base, optional=optional))
    attrs = []
    for f in fields:
        base = f["type"].rstrip("?[]")
        if base in model_names or f["name"] in fk_cols:
            continue
        attrs.append(dict(name=f["name"], pk="@id" in f["attrs"], unique="@unique" in f["attrs"],
                          optional=f["type"].endswith("?"), type=base))
    entities.append(dict(name=mname, weak=mname in weak))
    attributes.append((mname, attrs))
    for r in rels:
        if MODE == "lean" and r["parent"] == "Organization" and mname not in lean_org:
            continue
        relations.append(r)

def esc(s): return s.replace('"', '\\"')

out = []
out.append('graph ER {')
out.append('  graph [layout=neato, overlap=vpsc, mode=major, splines=true, sep="+18", start=42, bgcolor="transparent", pad=0.4, outputorder=edgesfirst, fontname="Helvetica"];')
out.append('  node  [fontname="Helvetica", fontsize=11, penwidth=1.3];')
out.append('  edge  [color="#6b6f7a", penwidth=1.1, fontname="Helvetica-Bold", fontsize=12, fontcolor="#1d2433"];')
for e in entities:
    per = 2 if e["weak"] else 1
    out.append(f'  "{e["name"]}" [shape=box, style="filled", fillcolor="#bfe3a8", color="#2f7a2a", fontcolor="#163d13", fontsize=15, fontname="Helvetica-Bold", peripheries={per}, width=1.6, height=0.5, margin="0.14,0.06"];')
for mname, attrs in attributes:
    for a in attrs:
        nid = f'{mname}.{a["name"]}'
        label = f'<U><B>{a["name"]}</B></U>' if a["pk"] else a["name"]
        style = "filled,dashed" if a["unique"] and not a["pk"] else "filled"
        color = "#c62828" if a["pk"] else ("#b03a6b" if a["unique"] else "#c86b8a")
        out.append(f'  "{nid}" [shape=ellipse, label=<{label}>, style="{style}", fillcolor="#fbd9e2", color="{color}", fontcolor="#3a1f2a", margin="0.04,0.01", tooltip="{esc(a["type"]) + ("?" if a["optional"] else "")}"];')
        out.append(f'  "{mname}" -- "{nid}" [penwidth=0.9, color="#8a8f9a", len=1.3];')
for i, r in enumerate(relations):
    rid = f'rel{i}'
    label = rel_labels.get((r["child"], r["field"]), r["field"])
    identifying = weak.get(r["child"]) == r["field"]
    per = 2 if identifying else 1
    out.append(f'  "{rid}" [shape=diamond, label="{esc(label)}", style="filled", fillcolor="#aebdf5", color="#2d3fb0", fontcolor="#0f1a5c", peripheries={per}, width=1.3, height=0.8, margin="0.02,0.02", fixedsize=false];')
    out.append(f'  "{r["parent"]}" -- "{rid}" [taillabel="1", len=3.4];')
    out.append(f'  "{rid}" -- "{r["child"]}" [headlabel="n", len=3.4, penwidth={2.2 if identifying else 1.1}];')
out.append('}')
open(OUT, "w").write("\n".join(out))
stats = dict(entities=len(entities), attributes=sum(len(a) for _, a in attributes), relations=len(relations))
print(json.dumps(stats), file=sys.stderr)
