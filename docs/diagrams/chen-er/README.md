# Chen-notation ER diagram generator

Generates `../er-chen-keys.svg`, `../er-chen-core.svg` and `../er-chen-full.svg` from the Prisma schema.

```sh
cd docs/diagrams/chen-er
npm install @viz-js/viz@3.11.0            # Graphviz compiled to WebAssembly, no system install
python3 gen_er.py ../../../backend/packages/database/prisma/schema.prisma keys keys.dot
python3 gen_er.py ../../../backend/packages/database/prisma/schema.prisma lean core.dot
python3 gen_er.py ../../../backend/packages/database/prisma/schema.prisma full full.dot
node render.js keys.dot neato ../er-chen-keys.svg
node render.js core.dot neato ../er-chen-core.svg
node render.js full.dot neato ../er-chen-full.svg
./topng.sh ../er-chen-keys.svg ../er-chen-keys.png   # PNG via headless Chrome, 2x

# 15 core tables, hand laid out on a grid (draw_er.py, no Graphviz)
python3 draw_er.py ../../../backend/packages/database/prisma/schema.prisma core15 ../er-chen-core15.svg
./topng.sh ../er-chen-core15.svg ../er-chen-core15.png

# all 33 tables, same style (draw_er.py, LAYOUTS["full33"])
python3 draw_er.py ../../../backend/packages/database/prisma/schema.prisma full33 ../er-chen-full33.svg
./topng.sh ../er-chen-full33.svg ../er-chen-full33.png
```

`draw_er.py` renders SVG directly from a layout written by hand (`LAYOUTS["core15"]`): which grid cell each
entity sits in, which side its attributes fan out to, and the route of each relationship (straight line or a
polyline through free lanes). Keys are still read from the Prisma schema, so adding a column to a table
updates the picture; moving a table is a one-line edit of its grid position.

An attribute side or diamond position of `"auto"` is chosen by the script: it tries left/right/top/bottom and a
few corner blocks (or points along the connector for a diamond) and keeps the first spot that touches nothing
already drawn. After drawing it prints a `WARN` line for every line that still crosses a box, ellipse or
diamond, and for every pair of shapes that overlap, so a layout can be tuned until it reports `0 warnings`.
Self relations take `"self"`, `"self-left"`, `"self-top"` or `"self-bottom"`.

`full33` draws every foreign key except `Organization -> Location`, which would have to cross the whole
catalogue column; Location still shows its `organizationId` key.

Flags for the Graphviz generator (`gen_er.py`):

* `--only A,B,C` keeps just those entities; relations and FK columns pointing at excluded tables are dropped.
* `--engine dot` gives a layered top-down layout with a legend (best for small diagrams); the default `neato` is a
  spring layout for the big ones. Pass the engine name to `render.js` as well.
* `--same "A,B;C,D"` (dot only) pins groups of entities to the same row, useful to keep hubs level.
* `--title "..."` adds a caption at the top-left.
* `keys` is the simplified diagram: entities, primary keys (red, underlined) and foreign keys (blue, italic, `(FK)`) only.
* `lean` draws Organization's ownership only to the root entities; `full` draws every foreign key.
* Foreign-key columns are not drawn as attributes (Chen convention): they are the diamonds.
* Relationship verbs live in `rel_labels` inside `gen_er.py`; add an entry when a new relation appears.
