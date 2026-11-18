/** Pulls plain text out of an uploaded CV. Scanned PDFs return little text; Claude then reads the PDF itself. */
export async function extractCvText(bytes: Uint8Array, fileName: string): Promise<string> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf') || isPdf(bytes)) {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return clean(Array.isArray(text) ? text.join('\n') : text);
  }
  if (lower.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const extract = (mammoth as unknown as { extractRawText: typeof import('mammoth').extractRawText }).extractRawText ?? (mammoth as unknown as { default: typeof import('mammoth') }).default.extractRawText;
    const result = await extract({ buffer: Buffer.from(bytes) });
    return clean(result.value);
  }
  if (lower.endsWith('.doc')) return clean(legacyDocText(bytes));
  return clean(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
}

/** Legacy Word (.doc) stores text as UTF-16LE runs; keep runs of readable characters. */
function legacyDocText(bytes: Uint8Array): string {
  const utf16 = new TextDecoder('utf-16le', { fatal: false }).decode(bytes);
  const runs = utf16.match(/[\p{L}\p{N}\p{P}\s]{4,}/gu) ?? [];
  return runs.filter(run => /[\p{L}]{3,}/u.test(run)).join('\n');
}

function clean(text: string): string {
  return text.split(String.fromCharCode(0)).join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
