import { deflateRawSync } from "node:zlib";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(date.getFullYear(), 1980);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { time, day };
}

function u16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value >>> 0, 0);
  return buf;
}

function u32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

export type ZipEntry = {
  name: string;
  data: Buffer;
  date?: Date;
};

/** Build a ZIP archive (deflate) with UTF-8 names. Paths should use `/`. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const now = new Date();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!name) continue;
    const data = entry.data;
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, "utf8");
    const { time, day } = dosDateTime(entry.date ?? now);
    const flags = 0x0800; // UTF-8
    const compression = 8;

    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      u16(20),
      u16(flags),
      u16(compression),
      u16(time),
      u16(day),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      compressed,
    ]);
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      u16(20),
      u16(20),
      u16(flags),
      u16(compression),
      u16(time),
      u16(day),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(centrals.length),
    u16(centrals.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, eocd]);
}
