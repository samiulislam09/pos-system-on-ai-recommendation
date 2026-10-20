/**
 * Dependency-free .xlsx → CSV conversion for the supplier upload pages.
 *
 * An .xlsx file is a ZIP of XML parts. We unzip with the browser's native
 * DecompressionStream, read the first worksheet, and emit RFC-4180 CSV so the
 * existing CSV pipeline (preview, edit, backend parser) is reused unchanged.
 * Legacy binary .xls is not supported.
 */

const textDecoder = new TextDecoder();

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads the ZIP central directory and returns a lazy loader per entry name. */
function readZip(buf: ArrayBuffer): Map<string, () => Promise<Uint8Array>> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("File is not a valid .xlsx workbook");

  const entryCount = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map<string, () => Promise<Uint8Array>>();

  for (let n = 0; n < entryCount; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt .xlsx workbook");
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = textDecoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    entries.set(name, async () => {
      const dataStart =
        localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      const data = bytes.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error("Unsupported compression in .xlsx workbook");
    });
  }
  return entries;
}

function parseXml(data: Uint8Array): Document {
  return new DOMParser().parseFromString(textDecoder.decode(data), "application/xml");
}

/** Namespace-agnostic element lookup (files may use prefixed tags like `x:c`). */
function els(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS("*", localName));
}

function attr(el: Element, localName: string): string | null {
  for (const a of Array.from(el.attributes)) {
    if (a.localName === localName) return a.value;
  }
  return null;
}

/** Concatenated text of all <t> runs, skipping phonetic (<rPh>) hints. */
function richText(el: Element): string {
  return els(el, "t")
    .filter((t) => t.parentElement?.localName !== "rPh")
    .map((t) => t.textContent ?? "")
    .join("");
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormatCode(code: string): boolean {
  const stripped = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[ymdhs]/i.test(stripped) && !/^general$/i.test(stripped.trim());
}

/** Style index → whether cells with that style hold dates. */
function readDateStyles(styles: Document | null): boolean[] {
  if (!styles) return [];
  const custom = new Map<number, string>();
  for (const nf of els(styles, "numFmt")) {
    custom.set(Number(attr(nf, "numFmtId")), attr(nf, "formatCode") ?? "");
  }
  const cellXfs = els(styles, "cellXfs")[0];
  if (!cellXfs) return [];
  return els(cellXfs, "xf").map((xf) => {
    const id = Number(attr(xf, "numFmtId") ?? 0);
    const code = custom.get(id);
    return code !== undefined ? isDateFormatCode(code) : BUILTIN_DATE_FORMATS.has(id);
  });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function serialToDate(serial: number, date1904: boolean): string {
  const days = serial + (date1904 ? 1462 : 0);
  const ms = Math.round((days - 25569) * 86400 * 1000); // 25569 = 1970-01-01 in the 1900 system
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hasTime = d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds();
  return hasTime ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : date;
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return `xl/${target}`.replace(/\/\.\//g, "/");
}

export function isExcelFile(file: File): boolean {
  return /\.xlsx$/i.test(file.name);
}

export function isLegacyExcelFile(file: File): boolean {
  return /\.xls$/i.test(file.name);
}

/** Converts the first worksheet of an .xlsx file to CSV text. */
export async function xlsxToCsv(file: File): Promise<string> {
  const zip = readZip(await file.arrayBuffer());
  const load = async (name: string) => {
    const entry = zip.get(name);
    return entry ? parseXml(await entry()) : null;
  };

  const workbook = await load("xl/workbook.xml");
  if (!workbook) throw new Error("File is not a valid .xlsx workbook");
  const date1904 = els(workbook, "workbookPr").some((el) => /^(1|true)$/i.test(attr(el, "date1904") ?? ""));

  let sheetPath = "xl/worksheets/sheet1.xml";
  const firstSheet = els(workbook, "sheet")[0];
  const rels = await load("xl/_rels/workbook.xml.rels");
  const relId = firstSheet ? attr(firstSheet, "id") : null;
  if (rels && relId) {
    const rel = els(rels, "Relationship").find((r) => attr(r, "Id") === relId);
    const target = rel ? attr(rel, "Target") : null;
    if (target) sheetPath = resolveTarget(target);
  }

  const sheet = await load(sheetPath);
  if (!sheet) throw new Error("Could not find a worksheet in this workbook");

  const sharedDoc = await load("xl/sharedStrings.xml");
  const shared = sharedDoc ? els(sharedDoc, "si").map(richText) : [];
  const dateStyles = readDateStyles(await load("xl/styles.xml"));

  const table: string[][] = [];
  for (const row of els(sheet, "row")) {
    const cells: string[] = [];
    let next = 0;
    for (const c of els(row, "c")) {
      const ref = attr(c, "r");
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;

      const type = attr(c, "t") ?? "n";
      const raw = els(c, "v")[0]?.textContent ?? "";
      let value: string;
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = richText(c);
      else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
      else if (type === "n" && raw !== "") {
        const num = Number(raw);
        value = dateStyles[Number(attr(c, "s") ?? 0)]
          ? serialToDate(num, date1904)
          : String(Number(num.toPrecision(15)));
      } else value = raw;

      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    if (cells.some((v) => v.trim() !== "")) table.push(cells);
  }

  if (table.length === 0) throw new Error("The first worksheet is empty");
  return table.map((r) => r.map(csvEscape).join(",")).join("\n");
}
