const PDF_PAGE_WIDTH = 595;
const PDF_PAGE_HEIGHT = 842;
const PDF_MARGIN = 50;
const PDF_LINE_HEIGHT = 14;
const PDF_LINES_PER_PAGE = 49;
const PDF_LINE_LENGTH = 88;

const WINDOWS_1252: Record<number, number> = {
  0x0152: 0x8c,
  0x0153: 0x9c,
  0x0160: 0x8a,
  0x0161: 0x9a,
  0x0178: 0x9f,
  0x017d: 0x8e,
  0x017e: 0x9e,
  0x0192: 0x83,
  0x02c6: 0x88,
  0x02dc: 0x98,
  0x2013: 0x96,
  0x2014: 0x97,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201a: 0x82,
  0x201c: 0x93,
  0x201d: 0x94,
  0x201e: 0x84,
  0x2020: 0x86,
  0x2021: 0x87,
  0x2022: 0x95,
  0x2026: 0x85,
  0x2030: 0x89,
  0x2039: 0x8b,
  0x203a: 0x9b,
  0x20ac: 0x80,
  0x2122: 0x99,
};

const encodeWindows1252 = (value: string) => [...value].map((character) => {
  const codePoint = character.codePointAt(0) ?? 0x3f;
  if (codePoint <= 0xff && !(codePoint >= 0x80 && codePoint <= 0x9f)) return codePoint;
  return WINDOWS_1252[codePoint] ?? 0x3f;
});

const pdfHexString = (value: string) => encodeWindows1252(value)
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('')
  .toUpperCase();

const wrapLine = (value: string, maximum = PDF_LINE_LENGTH) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return [''];
  const lines: string[] = [];
  let current = '';
  normalized.split(' ').forEach((word) => {
    if (!current) {
      current = word;
      return;
    }
    if (`${current} ${word}`.length <= maximum) {
      current = `${current} ${word}`;
      return;
    }
    lines.push(current);
    current = word;
  });
  if (current) lines.push(current);
  return lines;
};

export const normalizePdfLines = (lines: readonly string[]) => lines
  .flatMap((line) => wrapLine(line))
  .filter((line, index, all) => line.length > 0 || all[index - 1]?.length !== 0);

export const createTextPdf = (sourceLines: readonly string[]): Uint8Array => {
  const normalizedLines = normalizePdfLines(sourceLines);
  const pages = Array.from(
    { length: Math.max(1, Math.ceil(normalizedLines.length / PDF_LINES_PER_PAGE)) },
    (_, index) => normalizedLines.slice(index * PDF_LINES_PER_PAGE, (index + 1) * PDF_LINES_PER_PAGE),
  );
  const pageObjectStart = 3;
  const contentObjectStart = pageObjectStart + pages.length;
  const fontObjectNumber = contentObjectStart + pages.length;
  const objectCount = fontObjectNumber;
  const objects = new Map<number, string>();

  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${pages.map((_, index) => `${pageObjectStart + index} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((pageLines, index) => {
    const pageObjectNumber = pageObjectStart + index;
    const contentObjectNumber = contentObjectStart + index;
    objects.set(pageObjectNumber, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
    const stream = [
      'BT',
      '/F1 10 Tf',
      `${PDF_MARGIN} ${PDF_PAGE_HEIGHT - PDF_MARGIN} Td`,
      `${PDF_LINE_HEIGHT} TL`,
      ...pageLines.flatMap((line) => [`<${pdfHexString(line)}> Tj`, 'T*']),
      'ET',
    ].join('\n');
    objects.set(contentObjectNumber, `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`);
  });
  objects.set(fontObjectNumber, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  let output = '%PDF-1.4\n%Cartularia\n';
  const offsets = [0];
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    offsets[objectNumber] = new TextEncoder().encode(output).length;
    output += `${objectNumber} 0 obj\n${objects.get(objectNumber)}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(output).length;
  output += `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(output);
};

export const downloadTextPdf = (fileName: string, lines: readonly string[]) => {
  if (typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print();
    return;
  }
  const bytes = createTextPdf(lines);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};
