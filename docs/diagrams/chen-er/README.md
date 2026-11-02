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
```

* `keys` is the simplified diagram: entities, primary keys (red, underlined) and foreign keys (blue, italic, `(FK)`) only.
* `lean` draws Organization's ownership only to the root entities; `full` draws every foreign key.
* Foreign-key columns are not drawn as attributes (Chen convention): they are the diamonds.
* Relationship verbs live in `rel_labels` inside `gen_er.py`; add an entry when a new relation appears.
