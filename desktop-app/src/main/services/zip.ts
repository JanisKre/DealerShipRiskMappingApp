import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Minimal ZIP reader and writer: DWD station archives (hail history) and
 * XLSX packages (spreadsheet import). The reader uses the central directory,
 * so it does not depend on local-header sizes, and caps the inflated size so
 * a malformed or hostile archive cannot exhaust memory.
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

/** Writes a ZIP archive with every entry deflated. */
export function writeZip(
  entries: Array<{ name: string; data: Buffer }>,
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIGNATURE, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
