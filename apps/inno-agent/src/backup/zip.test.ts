import { describe, expect, it } from "vitest";
import { crc32, normalizeZipPath, readZip, writeZip, ZIP_MAX_ENTRIES } from "./zip.js";

describe("normalizeZipPath", () => {
	it("normalizes separators and leading slashes", () => {
		expect(normalizeZipPath("workspace//a\\b/c")).toBe("workspace/a/b/c");
		expect(normalizeZipPath("/abs/path")).toBe("abs/path");
		expect(normalizeZipPath("./rel/path")).toBe("rel/path");
		expect(normalizeZipPath("a/./b")).toBe("a/b");
	});

	it("rejects traversal and drive-letter segments", () => {
		expect(() => normalizeZipPath("../evil")).toThrow();
		expect(() => normalizeZipPath("a/../../evil")).toThrow();
		expect(() => normalizeZipPath("C:/evil")).toThrow();
	});
});

describe("writeZip / readZip round trip", () => {
	it("round-trips nested text and empty entries", () => {
		const buf = writeZip([
			{ path: "data/sessions/2026-08-22.jsonl", data: "line1\nline2\n" },
			{ path: "workspace/hello.cpp", data: Buffer.from("#include <iostream>\n") },
			{ path: "empty.txt", data: "" },
			{ path: "manifest.json", data: JSON.stringify({ ok: true }) },
		]);
		const entries = readZip(buf);
		expect(entries.map((e) => e.path).sort()).toEqual([
			"data/sessions/2026-08-22.jsonl",
			"empty.txt",
			"manifest.json",
			"workspace/hello.cpp",
		]);
		expect(entries.find((e) => e.path === "data/sessions/2026-08-22.jsonl")!.data.toString()).toBe("line1\nline2\n");
		expect(entries.find((e) => e.path === "empty.txt")!.data.length).toBe(0);
		expect(JSON.parse(entries.find((e) => e.path === "manifest.json")!.data.toString())).toEqual({ ok: true });
	});

	it("round-trips unicode names and binary data", () => {
		const binary = Buffer.alloc(300_000);
		for (let i = 0; i < binary.length; i++) binary[i] = (i * 31) % 256;
		const buf = writeZip([
			{ path: "workspace/órán készült jegyzet.md", data: "ünnepélyes szöveg áéőú" },
			{ path: "data/l3/memory.db", data: binary },
		]);
		const entries = readZip(buf);
		expect(entries.find((e) => e.path === "workspace/órán készült jegyzet.md")!.data.toString()).toBe("ünnepélyes szöveg áéőú");
		expect(entries.find((e) => e.path === "data/l3/memory.db")!.data.equals(binary)).toBe(true);
	});

	it("rejects duplicate paths on write", () => {
		expect(() => writeZip([{ path: "a.txt", data: "1" }, { path: "a.txt", data: "2" }])).toThrow(/Duplicate/);
	});

	it("rejects traversal names on write", () => {
		expect(() => writeZip([{ path: "../evil.txt", data: "x" }])).toThrow(/Unsafe/);
	});

	it("detects corrupted entry data (CRC or inflate failure)", () => {
		const buf = writeZip([{ path: "hello.txt", data: "hello world hello world hello world" }]);
		// Locate the compressed payload inside the local file header.
		const nameLen = buf.readUInt16LE(26);
		const extraLen = buf.readUInt16LE(28);
		const dataStart = 30 + nameLen + extraLen;
		const csize = buf.readUInt32LE(18);
		const corrupted = Buffer.from(buf);
		corrupted[dataStart + csize - 1] ^= 0xff;
		expect(() => readZip(corrupted)).toThrow();
	});

	it("rejects an archive with a traversal name on read", () => {
		// Hand-craft a minimal zip whose entry name escapes the archive root.
		const name = Buffer.from("../evil.txt", "utf-8");
		const data = Buffer.from("x");
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(0, 8); // store
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		const cd = Buffer.alloc(46);
		cd.writeUInt32LE(0x02014b50, 0);
		cd.writeUInt16LE(20, 4);
		cd.writeUInt16LE(20, 6);
		cd.writeUInt16LE(0x0800, 8);
		cd.writeUInt16LE(0, 10);
		cd.writeUInt32LE(crc, 16);
		cd.writeUInt32LE(data.length, 20);
		cd.writeUInt32LE(data.length, 24);
		cd.writeUInt16LE(name.length, 28);
		cd.writeUInt32LE(0, 42);
		const eocd = Buffer.alloc(22);
		eocd.writeUInt32LE(0x06054b50, 0);
		eocd.writeUInt16LE(1, 8);
		eocd.writeUInt16LE(1, 10);
		eocd.writeUInt32LE(cd.length + name.length, 12);
		eocd.writeUInt32LE(local.length + name.length + data.length, 16);
		const zip = Buffer.concat([local, name, data, cd, name, eocd]);
		expect(() => readZip(zip)).toThrow(/Unsafe/);
	});

	it("rejects archives with too many entries", () => {
		// An EOCD claiming ZIP_MAX_ENTRIES + 1 entries must be refused before
		// any central directory parsing happens.
		const eocd = Buffer.alloc(22);
		eocd.writeUInt32LE(0x06054b50, 0);
		eocd.writeUInt16LE(ZIP_MAX_ENTRIES + 1, 8);
		eocd.writeUInt16LE(ZIP_MAX_ENTRIES + 1, 10);
		eocd.writeUInt32LE(0, 12);
		eocd.writeUInt32LE(22, 16);
		expect(() => readZip(eocd)).toThrow(/too many entries/);
	});
});
