import { inflateRawSync } from "node:zlib";

/**
 * Minimal ZIP reader for the DWD station archives (a handful of small text
 * files, stored or deflated). Reads the central directory, so it does not
 * depend on local-header sizes, and caps the inflated size so a malformed
 * or hostile archive cannot exhaust memory.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** End-of-central-directory record plus the longest possible comment. */
const EOCD_SEARCH_BYTES = 22 + 0xffff;
export const ZIP_MAX_ENTRY_BYTES = 32 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  read: () => Buffer;
}

export function readZipEntries(zip: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(zip);
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > zip.length ||
      zip.readUInt32LE(offset) !== CENTRAL_SIGNATURE
    )
      throw new Error("Invalid ZIP central directory");
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    entries.push({
      name,
      read: () => readEntry(zip, localOffset, method, compressedSize, size),
    });
  }
  return entries;
}

function findEndOfCentralDirectory(zip: Buffer): number {
  const stop = Math.max(0, zip.length - EOCD_SEARCH_BYTES);
  for (let i = zip.length - 22; i >= stop; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error("Not a ZIP archive");
}

function readEntry(
  zip: Buffer,
  localOffset: number,
  method: number,
  compressedSize: number,
  size: number,
): Buffer {
  if (size > ZIP_MAX_ENTRY_BYTES) throw new Error("ZIP entry too large");
  if (
    localOffset + 30 > zip.length ||
    zip.readUInt32LE(localOffset) !== LOCAL_SIGNATURE
  )
    throw new Error("Invalid ZIP local header");
  const start =
    localOffset +
    30 +
    zip.readUInt16LE(localOffset + 26) +
    zip.readUInt16LE(localOffset + 28);
  const end = start + compressedSize;
  if (end > zip.length) throw new Error("Truncated ZIP entry");
  const data = zip.subarray(start, end);
  if (method === 0) return Buffer.from(data);
  if (method === 8)
    return inflateRawSync(data, { maxOutputLength: ZIP_MAX_ENTRY_BYTES });
  throw new Error(`Unsupported ZIP compression method ${method}`);
}
