/**
 * Minimal, dependency-free ZIP archive writer/reader built on node:zlib.
 *
 * Exists so state backup/restore works on every platform (Linux, macOS,
 * Windows) with zero npm dependencies: entries are deflated with the built-in
 * zlib and packed into a standard ZIP container (no zip64 — sizes are capped
 * at 4 GiB per entry and per archive).
 *
 * Safety: every path is normalized and validated on write AND on read
 * (no absolute paths, no `..` segments, no duplicate names), entry CRCs are
 * verified on read, and total entry counts/sizes are capped so a hostile file
 * cannot exhaust memory while inflating (zip-bomb protection).
 */

import { deflateRawSync, inflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;
const VERSION_NEEDED = 20;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const MAX_UINT32 = 0xffffffff;

/** Absolute safety caps for reading hostile archives. */
export const ZIP_MAX_ENTRIES = 50_000;
export const ZIP_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

// ---------------------------------------------------------------------------
// CRC32 (standard table-based implementation, reflected polynomial 0xEDB88320)
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
	let c = i;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	CRC_TABLE[i] = c >>> 0;
}

export function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/**
 * Normalize an archive path and reject anything unsafe:
 * - backslashes become forward slashes
 * - leading "./" and "/" are stripped
 * - empty segments and "." are dropped
 * - ".." segments and drive-letter segments throw
 */
export function normalizeZipPath(path: string): string {
	const cleaned = path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
	const parts = cleaned.split("/").filter((s) => s.length > 0 && s !== ".");
	for (const part of parts) {
		if (part === "..") throw new Error(`Unsafe archive path: ${path}`);
		if (/^[a-zA-Z]:$/.test(part)) throw new Error(`Unsafe archive path: ${path}`);
	}
	return parts.join("/");
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export interface ZipEntryInput {
	path: string;
	data: Buffer | string;
}

interface PreparedEntry {
	name: string;
	nameBuf: Buffer;
	data: Buffer;
	compressed: Buffer;
	method: number;
	crc: number;
}

function prepareEntry(input: ZipEntryInput): PreparedEntry {
	const name = normalizeZipPath(input.path);
	if (!name) throw new Error("Empty archive path");
	const data = typeof input.data === "string" ? Buffer.from(input.data, "utf-8") : input.data;
	if (data.length > MAX_UINT32) throw new Error(`Archive entry too large: ${name}`);
	const crc = crc32(data);
	const compressed = data.length > 0 ? deflateRawSync(data) : data;
	const method = data.length > 0 ? METHOD_DEFLATE : METHOD_STORE;
	return { name, nameBuf: Buffer.from(name, "utf-8"), data, compressed, method, crc };
}

/** Write a ZIP archive (deflate, UTF-8 names, no data descriptors, no zip64). */
export function writeZip(entries: ZipEntryInput[]): Buffer {
	const prepared: PreparedEntry[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		const p = prepareEntry(entry);
		if (seen.has(p.name)) throw new Error(`Duplicate archive path: ${p.name}`);
		seen.add(p.name);
		prepared.push(p);
	}

	const chunks: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	let centralSize = 0;

	for (const e of prepared) {
		const local = Buffer.alloc(30);
		local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
		local.writeUInt16LE(VERSION_NEEDED, 4);
		local.writeUInt16LE(FLAG_UTF8, 6);
		local.writeUInt16LE(e.method, 8);
		local.writeUInt16LE(0, 10); // mod time
		local.writeUInt16LE(0, 12); // mod date
		local.writeUInt32LE(e.crc, 14);
		local.writeUInt32LE(e.compressed.length, 18);
		local.writeUInt32LE(e.data.length, 22);
		local.writeUInt16LE(e.nameBuf.length, 26);
		local.writeUInt16LE(0, 28); // extra length
		chunks.push(local, e.nameBuf, e.compressed);

		const cd = Buffer.alloc(46);
		cd.writeUInt32LE(CENTRAL_DIRECTORY, 0);
		cd.writeUInt16LE(VERSION_NEEDED, 4); // version made by
		cd.writeUInt16LE(VERSION_NEEDED, 6); // version needed
		cd.writeUInt16LE(FLAG_UTF8, 8);
		cd.writeUInt16LE(e.method, 10);
		cd.writeUInt16LE(0, 12); // mod time
		cd.writeUInt16LE(0, 14); // mod date
		cd.writeUInt32LE(e.crc, 16);
		cd.writeUInt32LE(e.compressed.length, 20);
		cd.writeUInt32LE(e.data.length, 24);
		cd.writeUInt16LE(e.nameBuf.length, 28);
		cd.writeUInt16LE(0, 30); // extra length
		cd.writeUInt16LE(0, 32); // comment length
		cd.writeUInt16LE(0, 34); // disk number
		cd.writeUInt16LE(0, 36); // internal attributes
		cd.writeUInt32LE(0, 38); // external attributes
		cd.writeUInt32LE(offset, 42); // local header offset
		central.push(cd, e.nameBuf);
		centralSize += cd.length + e.nameBuf.length;

		offset += local.length + e.nameBuf.length + e.compressed.length;
	}

	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(END_OF_CENTRAL_DIR, 0);
	eocd.writeUInt16LE(0, 4); // disk number
	eocd.writeUInt16LE(0, 6); // central dir start disk
	eocd.writeUInt16LE(prepared.length, 8);
	eocd.writeUInt16LE(prepared.length, 10);
	eocd.writeUInt32LE(centralSize, 12);
	eocd.writeUInt32LE(offset, 16);
	eocd.writeUInt16LE(0, 20); // comment length

	return Buffer.concat([...chunks, ...central, eocd]);
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

export interface ZipReadEntry {
	path: string;
	data: Buffer;
}

/** Read a ZIP archive produced by {@link writeZip} (or any standard zip). */
export function readZip(buf: Buffer): ZipReadEntry[] {
	if (buf.length < 22) throw new Error("Invalid archive: too small");

	// Locate the end-of-central-directory record (search from the end; a
	// comment of up to 64 KiB may follow it).
	let eocdPos = -1;
	const scanStart = Math.max(0, buf.length - (22 + 0xffff));
	for (let i = buf.length - 22; i >= scanStart; i--) {
		if (buf.readUInt32LE(i) === END_OF_CENTRAL_DIR) {
			eocdPos = i;
			break;
		}
	}
	if (eocdPos < 0) throw new Error("Invalid archive: missing end-of-central-directory record");

	const totalEntries = buf.readUInt16LE(eocdPos + 10);
	const centralSize = buf.readUInt32LE(eocdPos + 12);
	const centralOffset = buf.readUInt32LE(eocdPos + 16);
	if (totalEntries > ZIP_MAX_ENTRIES) throw new Error(`Archive has too many entries (${totalEntries})`);
	if (centralOffset + centralSize > eocdPos) throw new Error("Invalid archive: central directory out of bounds");

	const entries: ZipReadEntry[] = [];
	const seen = new Set<string>();
	let totalBytes = 0;
	let pos = centralOffset;

	for (let i = 0; i < totalEntries; i++) {
		if (pos + 46 > centralOffset + centralSize) throw new Error("Invalid archive: truncated central directory");
		if (buf.readUInt32LE(pos) !== CENTRAL_DIRECTORY) throw new Error("Invalid archive: bad central directory signature");
		const method = buf.readUInt16LE(pos + 10);
		const crc = buf.readUInt32LE(pos + 16);
		const compressedSize = buf.readUInt32LE(pos + 20);
		const uncompressedSize = buf.readUInt32LE(pos + 24);
		const nameLen = buf.readUInt16LE(pos + 28);
		const extraLen = buf.readUInt16LE(pos + 30);
		const commentLen = buf.readUInt16LE(pos + 32);
		const localOffset = buf.readUInt32LE(pos + 42);

		const rawName = buf.toString("utf-8", pos + 46, pos + 46 + nameLen);
		const name = normalizeZipPath(rawName);
		if (!name) throw new Error(`Invalid archive: empty entry name`);

		pos += 46 + nameLen + extraLen + commentLen;

		// Directory entries carry no data.
		if (rawName.endsWith("/")) continue;
		if (seen.has(name)) throw new Error(`Duplicate archive path: ${name}`);
		seen.add(name);

		// Validate the local header matches the central directory.
		if (localOffset + 30 > buf.length) throw new Error("Invalid archive: bad local header offset");
		if (buf.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new Error("Invalid archive: bad local file header");
		const localNameLen = buf.readUInt16LE(localOffset + 26);
		const localExtraLen = buf.readUInt16LE(localOffset + 28);
		const dataStart = localOffset + 30 + localNameLen + localExtraLen;
		if (dataStart + compressedSize > buf.length) throw new Error(`Invalid archive: truncated data for ${name}`);

		let data: Buffer;
		if (method === METHOD_STORE) {
			data = Buffer.from(buf.subarray(dataStart, dataStart + compressedSize));
		} else if (method === METHOD_DEFLATE) {
			try {
				data = inflateRawSync(buf.subarray(dataStart, dataStart + compressedSize));
			} catch (err) {
				throw new Error(`Invalid archive: corrupt deflate data for ${name}: ${err instanceof Error ? err.message : String(err)}`);
			}
		} else {
			throw new Error(`Unsupported archive compression method ${method} for ${name}`);
		}

		if (data.length !== uncompressedSize) throw new Error(`Invalid archive: size mismatch for ${name}`);
		if (crc32(data) !== crc) throw new Error(`Invalid archive: CRC mismatch for ${name}`);

		totalBytes += data.length;
		if (totalBytes > ZIP_MAX_TOTAL_BYTES) throw new Error("Archive too large (zip-bomb protection)");
		entries.push({ path: name, data });
	}

	return entries;
}
