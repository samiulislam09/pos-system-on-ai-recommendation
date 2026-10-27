const { instance } = require('@viz-js/viz');
const fs = require('fs');
const [,, dotPath, engine, outPath] = process.argv;
instance().then(viz => {
  const svg = viz.renderString(fs.readFileSync(dotPath, 'utf8'), { engine, format: 'svg' });
  fs.writeFileSync(outPath, svg);
  const m = svg.match(/viewBox="([^"]+)"/);
  console.log(outPath, 'viewBox', m && m[1], 'bytes', svg.length);
});
