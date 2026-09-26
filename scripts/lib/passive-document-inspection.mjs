import { inflateRawSync } from 'node:zlib';

const MAX_UNCOMPRESSED = 50 * 1024 * 1024;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const hasControlCharacters = (text, allowWhitespace = false) => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 32 && !(allowWhitespace && [9, 10, 13].includes(code))) return true;
  }
  return false;
};
const utf8 = (bytes) => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('invalid_document_text', 'Le document contient un encodage texte invalide.'); }
};
const xmlText = (bytes) => utf8(bytes).replace(/&#(?:x([0-9a-f]+)|(\d+));|&(quot|apos|amp|lt|gt);/gi, (_match, hex, decimal, named) => {
  if (named) return ({ quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' })[named.toLowerCase()];
  const code = parseInt(hex || decimal, hex ? 16 : 10);
  if (code > 0x10ffff) fail('invalid_document_text', 'Référence XML invalide.');
  return String.fromCodePoint(code);
});
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** Bounded ZIP32 reader. No extraction to disk, executable content or external document relationships. */
const docxParts = (bytes) => {
  const invalid = () => fail('invalid_docx', 'Le conteneur Word est invalide, chiffré ou dépasse les limites de lecture.');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) invalid();
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || count === 0 || count > 256 || start + centralSize !== end) invalid();
  let position = start, expanded = 0;
  const parts = new Map(), ranges = [];
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50) invalid();
    const flags = bytes.readUInt16LE(position + 8), method = bytes.readUInt16LE(position + 10);
    const crc = bytes.readUInt32LE(position + 16), compressed = bytes.readUInt32LE(position + 20), size = bytes.readUInt32LE(position + 24);
    const nameLength = bytes.readUInt16LE(position + 28), extraLength = bytes.readUInt16LE(position + 30), commentLength = bytes.readUInt16LE(position + 32), local = bytes.readUInt32LE(position + 42);
    if (position + 46 + nameLength + extraLength + commentLength > end || flags & ~0x808 || ![0, 8].includes(method) || bytes.readUInt16LE(position + 34) || local + 30 > start) invalid();
    const nameBytes = bytes.subarray(position + 46, position + 46 + nameLength), name = utf8(nameBytes);
    if (!name || name.includes('\\') || hasControlCharacters(name) || name.startsWith('/') || name.includes(':') || name.split('/').some(part => part === '..' || part === '.') || parts.has(name)) invalid();
    expanded += size;
    if (expanded > MAX_UNCOMPRESSED || size > 20 * 1024 * 1024 || size > Math.max(1, compressed) * 1000) invalid();
    if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) invalid();
    const localNameLength = bytes.readUInt16LE(local + 26), localExtraLength = bytes.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
    if (dataEnd > start || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes) || ranges.some(([from, to]) => local < to && dataEnd > from)) invalid();
    if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== size)) invalid();
    let content;
    try { content = method === 0 ? bytes.subarray(dataStart, dataEnd) : inflateRawSync(bytes.subarray(dataStart, dataEnd), { maxOutputLength: Math.max(1, size) }); }
    catch { invalid(); }
    if (content.length !== size || crc32(content) !== crc) invalid();
    ranges.push([local, dataEnd]);
    parts.set(name, content);
    position += 46 + nameLength + extraLength + commentLength;
  }
  if (position !== end) invalid();
  return parts;
};

/** These originals remain private and downloadable; this is not antivirus certification. */
export function assertPassiveDocument(bytes, format) {
  if (format === 'markdown') {
    const text = utf8(bytes);
    if (!text.trim() || hasControlCharacters(text, true)) fail('invalid_document_text', 'Le Markdown doit être un texte UTF-8 sans données binaires.');
    if (/<\s*(?:script|iframe|object|embed|link|meta)\b|\bon\w+\s*=|javascript\s*:|data\s*:\s*text\/html/i.test(text)) fail('active_document_content', 'Le Markdown contient du contenu actif interdit.');
    return;
  }
  const parts = docxParts(bytes);
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) if (!parts.has(required)) fail('invalid_docx', 'Le fichier ne contient pas les parties Word requises.');
  for (const [name, content] of parts) {
    if (/vba|activex|embeddings|\.bin$|\.exe$|\.js$/i.test(name)) fail('active_document_content', 'Les macros, objets embarqués et contenus exécutables ne sont pas acceptés.');
    if (/\.(?:xml|rels)$/i.test(name)) {
      const text = xmlText(content);
      if (/<!\s*(?:DOCTYPE|ENTITY)|TargetMode\s*=\s*["']External["']|macroEnabled|vbaProject|\bDDE(?:AUTO)?\b|relationships\/(?:oleObject|attachedTemplate|aFChunk|control)\b|<(?:\w+:)?altChunk\b/i.test(text)) fail('active_document_content', 'Le document Word contient une relation externe ou un contenu actif interdit.');
    }
  }
  if (!utf8(parts.get('[Content_Types].xml')).includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') || !/<(?:\w+:)?document\b/.test(utf8(parts.get('word/document.xml')))) fail('invalid_docx', 'Le document Word principal est absent ou incompatible.');
}
