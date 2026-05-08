const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const KGM_HEADER = Buffer.from([
  0x7c, 0xd5, 0x32, 0xeb, 0x86, 0x02, 0x7f, 0x4b,
  0xa8, 0xaf, 0xa6, 0x8e, 0x0f, 0xff, 0x99, 0x14,
]);

const VPR_HEADER = Buffer.from([
  0x05, 0x28, 0xbc, 0x96, 0xe9, 0xe4, 0x5a, 0x43,
  0x91, 0xaa, 0xbd, 0xd0, 0x7a, 0xf5, 0x36, 0x31,
]);

const VPR_MASK_DIFF = [
  0x25, 0xdf, 0xe8, 0xa6, 0x75, 0x1e, 0x75, 0x0e,
  0x2f, 0x80, 0xf3, 0x2d, 0xb8, 0xb6, 0xe3, 0x11, 0x00,
];

const SQLITE_HEADER = Buffer.from("SQLite format 3\0");
const KUGOU_DB_PAGE_SIZE = 0x400;
const KUGOU_DB_MASTER_KEY = Buffer.from([
  0x1d, 0x61, 0x31, 0x45, 0xb2, 0x47, 0xbf, 0x7f,
  0x3d, 0x18, 0x96, 0x72, 0x14, 0x4f, 0xe4, 0xbf,
  0x00, 0x00, 0x00, 0x00, 0x73, 0x41, 0x6c, 0x54,
]);

const QMC_V2_PREFIX = "QQMusic EncV2,Key:";
const QMC_MIX_KEY_1 = Buffer.from([
  0x33, 0x38, 0x36, 0x5a, 0x4a, 0x59, 0x21, 0x40,
  0x23, 0x2a, 0x24, 0x25, 0x5e, 0x26, 0x29, 0x28,
]);
const QMC_MIX_KEY_2 = Buffer.from([
  0x2a, 0x2a, 0x23, 0x21, 0x28, 0x23, 0x24, 0x25,
  0x26, 0x5e, 0x61, 0x31, 0x63, 0x5a, 0x2c, 0x54,
]);

function isDebugEnabled() {
  return process.env.MUSIC_CONVERTER_DEBUG_KGG === "1";
}

function getDebugLogPath() {
  return process.env.MUSIC_CONVERTER_KGG_LOG || path.join(process.cwd(), "kgg-debug.log");
}

function debugLog(message, details = {}) {
  if (!isDebugEnabled()) return;
  const safeDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (Buffer.isBuffer(value)) {
      safeDetails[key] = {
        length: value.length,
        hexHead: value.subarray(0, 32).toString("hex"),
      };
    } else {
      safeDetails[key] = value;
    }
  }
  const line = `${new Date().toISOString()} ${message} ${JSON.stringify(safeDetails)}\n`;
  try {
    fs.appendFileSync(getDebugLogPath(), line);
  } catch (error) {
    // Debug logging must never break conversion.
  }
}

function debugSqliteLog(message, details = {}) {
  if (process.env.MUSIC_CONVERTER_DEBUG_SQLITE !== "1") return;
  debugLog(message, details);
}

const TABLE1 = [
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x01,0x21,0x01,0x61,0x01,0x21,0x01,0xe1,0x01,0x21,0x01,0x61,0x01,0x21,0x01,
  0xd2,0x23,0x02,0x02,0x42,0x42,0x02,0x02,0xc2,0xc2,0x02,0x02,0x42,0x42,0x02,0x02,
  0xd3,0xd3,0x02,0x03,0x63,0x43,0x63,0x03,0xe3,0xc3,0xe3,0x03,0x63,0x43,0x63,0x03,
  0x94,0xb4,0x94,0x65,0x04,0x04,0x04,0x04,0x84,0x84,0x84,0x84,0x04,0x04,0x04,0x04,
  0x95,0x95,0x95,0x95,0x04,0x05,0x25,0x05,0xe5,0x85,0xa5,0x85,0xe5,0x05,0x25,0x05,
  0xd6,0xb6,0x96,0xb6,0xd6,0x27,0x06,0x06,0xc6,0xc6,0x86,0x86,0xc6,0xc6,0x06,0x06,
  0xd7,0xd7,0x97,0x97,0xd7,0xd7,0x06,0x07,0xe7,0xc7,0xe7,0x87,0xe7,0xc7,0xe7,0x07,
  0x18,0x38,0x18,0x78,0x18,0x38,0x18,0xe9,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
  0x19,0x19,0x19,0x19,0x19,0x19,0x19,0x19,0x08,0x09,0x29,0x09,0x69,0x09,0x29,0x09,
  0xda,0x3a,0x1a,0x3a,0x5a,0x3a,0x1a,0x3a,0xda,0x2b,0x0a,0x0a,0x4a,0x4a,0x0a,0x0a,
  0xdb,0xdb,0x1b,0x1b,0x5b,0x5b,0x1b,0x1b,0xdb,0xdb,0x0a,0x0b,0x6b,0x4b,0x6b,0x0b,
  0x9c,0xbc,0x9c,0x7c,0x1c,0x3c,0x1c,0x7c,0x9c,0xbc,0x9c,0x6d,0x0c,0x0c,0x0c,0x0c,
  0x9d,0x9d,0x9d,0x9d,0x1d,0x1d,0x1d,0x1d,0x9d,0x9d,0x9d,0x9d,0x0c,0x0d,0x2d,0x0d,
  0xde,0xbe,0x9e,0xbe,0xde,0x3e,0x1e,0x3e,0xde,0xbe,0x9e,0xbe,0xde,0x2f,0x0e,0x0e,
  0xdf,0xdf,0x9f,0x9f,0xdf,0xdf,0x1f,0x1f,0xdf,0xdf,0x9f,0x9f,0xdf,0xdf,0x0e,0x0f,
  0x00,0x20,0x00,0x60,0x00,0x20,0x00,0xe0,0x00,0x20,0x00,0x60,0x00,0x20,0x00,0xf1,
];

const TABLE2 = [
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x00,0x01,0x23,0x01,0x67,0x01,0x23,0x01,0xef,0x01,0x23,0x01,0x67,0x01,0x23,0x01,
  0xdf,0x21,0x02,0x02,0x46,0x46,0x02,0x02,0xce,0xce,0x02,0x02,0x46,0x46,0x02,0x02,
  0x00,0x22,0x00,0x66,0x00,0x22,0x00,0xee,0x00,0x22,0x00,0x66,0x00,0x22,0x00,0xfe,
];

const MASK_V2_PREDEF = [
  0xb8,0xd5,0x3d,0xb2,0xe9,0xaf,0x78,0x8c,0x83,0x33,0x71,0x51,0x76,0xa0,0xcd,0x37,
  0x2f,0x3e,0x35,0x8d,0xa9,0xbe,0x98,0xb7,0xe7,0x8c,0x22,0xce,0x5a,0x61,0xdf,0x68,
  0x69,0x89,0xfe,0xa5,0xb6,0xde,0xa9,0x77,0xfc,0xc8,0xbd,0xbd,0xe5,0x6d,0x3e,0x5a,
  0x36,0xef,0x69,0x4e,0xbe,0xe1,0xe9,0x66,0x1c,0xf3,0xd9,0x02,0xb6,0xf2,0x12,0x9b,
  0x44,0xd0,0x6f,0xb9,0x35,0x89,0xb6,0x46,0x6d,0x73,0x82,0x06,0x69,0xc1,0xed,0xd7,
  0x85,0xc2,0x30,0xdf,0xa2,0x62,0xbe,0x79,0x2d,0x62,0x62,0x3d,0x0d,0x7e,0xbe,0x48,
  0x89,0x23,0x02,0xa0,0xe4,0xd5,0x75,0x51,0x32,0x02,0x53,0xfd,0x16,0x3a,0x21,0x3b,
  0x16,0x0f,0xc3,0xb2,0xbb,0xb3,0xe2,0xba,0x3a,0x3d,0x13,0xec,0xf6,0x01,0x45,0x84,
  0xa5,0x70,0x0f,0x93,0x49,0x0c,0x64,0xcd,0x31,0xd5,0xcc,0x4c,0x07,0x01,0x9e,0x00,
  0x1a,0x23,0x90,0xbf,0x88,0x1e,0x3b,0xab,0xa6,0x3e,0xc4,0x73,0x47,0x10,0x7e,0x3b,
  0x5e,0xbc,0xe3,0x00,0x84,0xff,0x09,0xd4,0xe0,0x89,0x0f,0x5b,0x58,0x70,0x4f,0xfb,
  0x65,0xd8,0x5c,0x53,0x1b,0xd3,0xc8,0xc6,0xbf,0xef,0x98,0xb0,0x50,0x4f,0x0f,0xea,
  0xe5,0x83,0x58,0x8c,0x28,0x2c,0x84,0x67,0xcd,0xd0,0x9e,0x47,0xdb,0x27,0x50,0xca,
  0xf4,0x63,0x63,0xe8,0x97,0x7f,0x1b,0x4b,0x0c,0xc2,0xc1,0x21,0x4c,0xcc,0x58,0xf5,
  0x94,0x52,0xa3,0xf3,0xd3,0xe0,0x68,0xf4,0x00,0x23,0xf3,0x5e,0x0a,0x7b,0x93,0xdd,
  0xab,0x12,0xb2,0x13,0xe8,0x84,0xd7,0xa7,0x9f,0x0f,0x32,0x4c,0x55,0x1d,0x04,0x36,
  0x52,0xdc,0x03,0xf3,0xf9,0x4e,0x42,0xe9,0x3d,0x61,0xef,0x7c,0xb6,0xb3,0x93,0x50,
];

function hasPrefix(buffer, prefix) {
  return buffer.length >= prefix.length && prefix.every((value, index) => buffer[index] === value);
}

function getMask(pos) {
  let offset = pos >> 4;
  let value = 0;
  while (offset >= 0x11) {
    value ^= TABLE1[offset % TABLE1.length] || 0;
    offset >>= 4;
    value ^= TABLE2[offset % TABLE2.length] || 0;
    offset >>= 4;
  }
  return (MASK_V2_PREDEF[pos % MASK_V2_PREDEF.length] ^ value) & 0xff;
}

function sniffExt(buffer) {
  if (buffer.subarray(0, 4).equals(Buffer.from("fLaC"))) return "flac";
  if (buffer.subarray(0, 3).equals(Buffer.from("ID3")) || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return "mp3";
  if (buffer.subarray(0, 4).equals(Buffer.from("OggS"))) return "ogg";
  if (buffer.subarray(0, 4).equals(Buffer.from("RIFF"))) return "wav";
  if (buffer.subarray(4, 8).equals(Buffer.from("ftyp"))) return "m4a";
  if (buffer[0] === 0xff && (buffer[1] === 0xf1 || buffer[1] === 0xf9)) return "aac";
  return "bin";
}

function findFlacFirstFrameOffset(buffer) {
  if (!buffer.subarray(0, 4).equals(Buffer.from("fLaC"))) return -1;

  let offset = 4;
  let sawStreamInfo = false;
  for (let blockIndex = 0; blockIndex < 128; blockIndex += 1) {
    if (offset + 4 > buffer.length) return -1;
    const header = buffer[offset];
    const isLast = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const length = buffer.readUIntBE(offset + 1, 3);
    offset += 4;

    if (type > 6 || offset + length > buffer.length) return -1;
    if (blockIndex === 0 && (type !== 0 || length !== 34)) return -1;
    if (type === 0) sawStreamInfo = true;

    offset += length;
    if (isLast) return sawStreamInfo ? offset : -1;
  }

  return -1;
}

function isLikelyAudioBuffer(buffer, ext) {
  if (ext === "flac") {
    const frameOffset = findFlacFirstFrameOffset(buffer);
    return frameOffset > 0
      && frameOffset + 2 < buffer.length
      && buffer[frameOffset] === 0xff
      && (buffer[frameOffset + 1] & 0xfc) === 0xf8;
  }
  if (ext === "mp3") return buffer.length > 4096;
  if (ext === "ogg") return buffer.length > 4096 && buffer.subarray(0, 4).equals(Buffer.from("OggS"));
  if (ext === "wav") return buffer.length > 44 && buffer.subarray(8, 12).equals(Buffer.from("WAVE"));
  if (ext === "m4a") return buffer.length > 4096 && buffer.subarray(4, 8).equals(Buffer.from("ftyp"));
  if (ext === "aac") return buffer.length > 4096;
  return false;
}

function writeDecodedAudio(outputDirectory, ext, audio) {
  const outputPath = path.join(outputDirectory, `decoded.${ext}`);
  fs.writeFileSync(outputPath, audio);
  debugLog("kugou:decoded-file:write", { outputPath, ext, size: audio.length });
  return outputPath;
}

function md5(buffer) {
  return crypto.createHash("md5").update(buffer).digest();
}

function kugouMd5(buffer) {
  const digest = md5(buffer);
  const output = Buffer.alloc(16);
  for (let index = 0; index < 16; index += 2) {
    output[index] = digest[14 - index];
    output[index + 1] = digest[15 - index];
  }
  return output;
}

function xorCollapseUInt32(value) {
  return (value ^ (value >>> 8) ^ (value >>> 16) ^ (value >>> 24)) & 0xff;
}

function decryptKugouV3Audio(audio, cryptoSlot, cryptoKey, offsetBase = 0) {
  const slotKeys = new Map([[1, Buffer.from([0x6c, 0x2c, 0x2f, 0x27])]]);
  const slotKey = slotKeys.get(cryptoSlot);
  if (!slotKey) throw new Error(`Unsupported Kugou crypto slot ${cryptoSlot}.`);

  const slotBox = kugouMd5(slotKey);
  const fileBox = Buffer.concat([kugouMd5(cryptoKey), Buffer.from([0x6b])]);
  for (let index = 0; index < audio.length; index += 1) {
    const offset = offsetBase + index;
    audio[index] ^= fileBox[offset % fileBox.length];
    audio[index] ^= (audio[index] << 4) & 0xff;
    audio[index] ^= slotBox[offset % slotBox.length];
    audio[index] ^= xorCollapseUInt32(offset);
    audio[index] &= 0xff;
  }
}

function nextPageIv(seed) {
  const left = Math.imul(seed, 0x9ef4) >>> 0;
  const right = Math.imul(Math.floor(seed / 0xce26), 0x7fffff07) >>> 0;
  const value = (left - right) >>> 0;
  return (value & 0x80000000) === 0 ? value : (value + 0x7fffff07) >>> 0;
}

function derivePageAesKey(seed) {
  const masterKey = Buffer.from(KUGOU_DB_MASTER_KEY);
  masterKey.writeUInt32LE(seed >>> 0, 0x10);
  return md5(masterKey);
}

function derivePageAesIv(seed) {
  const iv = Buffer.alloc(16);
  let value = (seed + 1) >>> 0;
  for (let index = 0; index < 16; index += 4) {
    value = nextPageIv(value);
    iv.writeUInt32LE(value, index);
  }
  return md5(iv);
}

function aes128CbcNoPadding(buffer, key, iv) {
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

function decryptKugouDatabase(buffer) {
  debugLog("kugou-db:decrypt:start", { size: buffer.length, sqliteHeader: buffer.subarray(0, 16) });
  if (buffer.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) return buffer;
  if (buffer.length === 0 || buffer.length % KUGOU_DB_PAGE_SIZE !== 0) {
    throw new Error("酷狗数据库大小异常，无法读取 KGG v5 密钥。");
  }

  const output = Buffer.from(buffer);
  const page1 = output.subarray(0, KUGOU_DB_PAGE_SIZE);
  const expected = Buffer.from(page1.subarray(0x10, 0x18));
  page1.copy(page1, 0x10, 0x08, 0x10);
  aes128CbcNoPadding(page1.subarray(0x10), derivePageAesKey(1), derivePageAesIv(1)).copy(page1, 0x10);
  if (!page1.subarray(0x10, 0x18).equals(expected)) {
    debugLog("kugou-db:decrypt:page1-check-failed", { expected, actual: page1.subarray(0x10, 0x18) });
    throw new Error("酷狗数据库解密失败，可能数据库版本不兼容。");
  }
  SQLITE_HEADER.copy(page1, 0);

  for (let page = 2, offset = KUGOU_DB_PAGE_SIZE; offset < output.length; page += 1, offset += KUGOU_DB_PAGE_SIZE) {
    aes128CbcNoPadding(
      output.subarray(offset, offset + KUGOU_DB_PAGE_SIZE),
      derivePageAesKey(page),
      derivePageAesIv(page),
    ).copy(output, offset);
  }

  debugLog("kugou-db:decrypt:done", { size: output.length });
  return output;
}

function getDefaultKugouDatabasePath() {
  const appData = process.env.APPDATA || "";
  const candidates = [
    appData ? path.join(appData, "Kugou8", "KGMusicV3.db") : "",
    appData ? path.join(appData, "KuGou8", "KGMusicV3.db") : "",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function normalizeDbText(buffer) {
  return buffer
    .toString("utf8")
    .replace(/[\u0000-\u001f]+/g, "\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlausibleQmcEKey(value) {
  if (!value || value.length < 32 || value.length % 4 !== 0) return false;
  try {
    const raw = Buffer.from(value, "base64");
    if (raw.every((byte) => byte === 0)) return false;
    return raw.length >= 16 && (raw.length - 8) % 8 === 0;
  } catch (error) {
    return false;
  }
}

function findHashAdjacentKggEKey(text, audioHash) {
  const hashPattern = escapeRegExp(audioHash.toLowerCase());
  const wrapperPattern = new RegExp(
    `(?:flac|mp3|m4a|aac|ogg|ape)?0{32}${hashPattern}([A-Za-z0-9+/]{32,}={0,2})`,
    "i",
  );
  const wrapperMatch = text.match(wrapperPattern);
  if (wrapperMatch && isPlausibleQmcEKey(wrapperMatch[1])) {
    return {
      ekey: wrapperMatch[1],
      source: "hash-wrapper",
      relativeIndex: wrapperMatch.index,
      wrapperPrefix: wrapperMatch[0].slice(0, Math.min(wrapperMatch[0].length, 72)),
    };
  }

  const hashIndex = text.toLowerCase().indexOf(audioHash.toLowerCase());
  if (hashIndex < 0) return null;
  const afterHash = text.slice(hashIndex + audioHash.length);
  const adjacentMatch = afterHash.match(/^[A-Za-z0-9+/]{32,}={0,2}/);
  if (adjacentMatch && isPlausibleQmcEKey(adjacentMatch[0])) {
    return {
      ekey: adjacentMatch[0],
      source: "hash-adjacent",
      relativeIndex: hashIndex,
      wrapperPrefix: text.slice(Math.max(0, hashIndex - 40), hashIndex + audioHash.length),
    };
  }
  return null;
}

function selectDerivableKggEKey(candidates, audioHash, source) {
  for (const candidate of candidates) {
    try {
      const key = deriveQmcKey(candidate);
      debugLog("kgg-v5:find-ekey:derivable-candidate", {
        audioHash,
        source,
        ekeyLength: candidate.length,
        ekeyPrefix: candidate.slice(0, 32),
        qmcKeyLength: key.length,
      });
      return candidate;
    } catch (error) {
      debugLog("kgg-v5:find-ekey:bad-candidate", {
        audioHash,
        source,
        ekeyLength: candidate.length,
        ekeyPrefix: candidate.slice(0, 32),
        error: error.message,
      });
    }
  }
  return "";
}

function readVarint(buffer, offset) {
  let value = 0;
  for (let index = 0; index < 9; index += 1) {
    const byte = buffer[offset + index];
    if (index === 8) {
      return { value: (value * 256) + byte, length: 9 };
    }
    value = (value * 128) + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, length: index + 1 };
  }
  throw new Error("SQLite varint 解析失败。");
}

function getSqlitePage(buffer, pageSize, pageNumber) {
  const start = (pageNumber - 1) * pageSize;
  return buffer.subarray(start, start + pageSize);
}

function getBtreeHeaderOffset(pageNumber) {
  return pageNumber === 1 ? 100 : 0;
}

function getCellPointers(page, headerOffset, pageType) {
  const cellCount = page.readUInt16BE(headerOffset + 3);
  const pointerArrayOffset = pageType === 0x05 || pageType === 0x02 ? headerOffset + 12 : headerOffset + 8;
  const pointers = [];
  for (let index = 0; index < cellCount; index += 1) {
    pointers.push(page.readUInt16BE(pointerArrayOffset + index * 2));
  }
  return pointers;
}

function getTableLeafLocalPayloadLength(payloadLength, usableSize) {
  const maxLocal = usableSize - 35;
  if (payloadLength <= maxLocal) return payloadLength;

  const minLocal = Math.floor(((usableSize - 12) * 32) / 255) - 23;
  const local = minLocal + ((payloadLength - minLocal) % (usableSize - 4));
  return local <= maxLocal ? local : minLocal;
}

function readOverflowPayload(db, pageSize, firstPageNumber, remainingLength) {
  const chunks = [];
  let pageNumber = firstPageNumber;
  let remaining = remainingLength;
  const visited = new Set();

  while (pageNumber && remaining > 0) {
    if (visited.has(pageNumber)) throw new Error("SQLite overflow page loop.");
    visited.add(pageNumber);
    const page = getSqlitePage(db, pageSize, pageNumber);
    if (page.length < pageSize) throw new Error("SQLite overflow page out of range.");

    const nextPageNumber = page.readUInt32BE(0);
    const chunkLength = Math.min(remaining, pageSize - 4);
    chunks.push(page.subarray(4, 4 + chunkLength));
    remaining -= chunkLength;
    pageNumber = nextPageNumber;
  }

  if (remaining > 0) throw new Error("SQLite overflow payload is truncated.");
  return Buffer.concat(chunks);
}

function parseSqliteRecord(payload) {
  const headerInfo = readVarint(payload, 0);
  const headerLength = headerInfo.value;
  const serialTypes = [];
  let cursor = headerInfo.length;
  while (cursor < headerLength) {
    const serial = readVarint(payload, cursor);
    serialTypes.push(serial.value);
    cursor += serial.length;
  }

  const values = [];
  cursor = headerLength;
  for (const serialType of serialTypes) {
    if (serialType === 0) {
      values.push(null);
    } else if (serialType === 1) {
      values.push(payload.readInt8(cursor));
      cursor += 1;
    } else if (serialType === 2) {
      values.push(payload.readInt16BE(cursor));
      cursor += 2;
    } else if (serialType === 3) {
      values.push(payload.readIntBE(cursor, 3));
      cursor += 3;
    } else if (serialType === 4) {
      values.push(payload.readInt32BE(cursor));
      cursor += 4;
    } else if (serialType === 5) {
      values.push(payload.readIntBE(cursor, 6));
      cursor += 6;
    } else if (serialType === 6) {
      values.push(Number(payload.readBigInt64BE(cursor)));
      cursor += 8;
    } else if (serialType === 7) {
      values.push(payload.readDoubleBE(cursor));
      cursor += 8;
    } else if (serialType === 8) {
      values.push(0);
    } else if (serialType === 9) {
      values.push(1);
    } else if (serialType >= 12) {
      const length = Math.floor((serialType - 12) / 2);
      const value = payload.subarray(cursor, cursor + length);
      values.push(serialType % 2 === 0 ? Buffer.from(value) : value.toString("utf8"));
      cursor += length;
    } else {
      values.push(null);
    }
  }
  return values;
}

function parseCreateTableColumns(sql) {
  const start = sql.indexOf("(");
  const end = sql.lastIndexOf(")");
  if (start < 0 || end <= start) return [];

  const columns = [];
  let part = "";
  let depth = 0;
  let quote = "";
  const body = sql.slice(start + 1, end);
  for (const char of body) {
    if (quote) {
      part += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      part += char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      columns.push(part.trim());
      part = "";
      continue;
    }
    part += char;
  }
  if (part.trim()) columns.push(part.trim());

  return columns
    .map((column) => column.match(/^["`[]?([^"`\]\s]+)["`\]]?/))
    .filter(Boolean)
    .map((match) => match[1])
    .filter((name) => !/^(constraint|primary|unique|key|foreign|check)$/i.test(name));
}

function collectTableLeafRows(db, pageSize, pageNumber, rows, visited = new Set()) {
  if (!pageNumber || pageNumber < 1 || pageNumber > Math.ceil(db.length / pageSize)) {
    debugSqliteLog("sqlite:btree:bad-page", { pageNumber, pageSize, dbSize: db.length });
    return rows;
  }
  if (visited.has(pageNumber)) return rows;
  visited.add(pageNumber);

  const page = getSqlitePage(db, pageSize, pageNumber);
  const headerOffset = getBtreeHeaderOffset(pageNumber);
  const pageType = page[headerOffset];
  const pointers = getCellPointers(page, headerOffset, pageType);
  debugSqliteLog("sqlite:btree:page", {
    pageNumber,
    pageType,
    cellCount: pointers.length,
    headerOffset,
    pointerHead: pointers.slice(0, 8),
  });

  if (pageType === 0x05) {
    for (const pointer of pointers) {
      const childPage = page.readUInt32BE(pointer);
      collectTableLeafRows(db, pageSize, childPage, rows, visited);
    }
    const rightMostPage = page.readUInt32BE(headerOffset + 8);
    collectTableLeafRows(db, pageSize, rightMostPage, rows, visited);
    return rows;
  }

  if (pageType !== 0x0d) {
    debugSqliteLog("sqlite:btree:unsupported-page", { pageNumber, pageType });
    return rows;
  }

  for (const pointer of pointers) {
    let cursor = pointer;
    const payloadLength = readVarint(page, cursor);
    cursor += payloadLength.length;
    const rowId = readVarint(page, cursor);
    cursor += rowId.length;
    const localLength = getTableLeafLocalPayloadLength(payloadLength.value, pageSize);
    const payloadEnd = cursor + localLength;
    if (payloadEnd > page.length) {
      debugSqliteLog("sqlite:btree:payload-out-of-range", {
        pageNumber,
        pointer,
        payloadLength: payloadLength.value,
        localLength,
        localAvailable: page.length - cursor,
      });
      continue;
    }

    let payload = Buffer.from(page.subarray(cursor, payloadEnd));
    if (localLength < payloadLength.value) {
      const overflowPointerOffset = payloadEnd;
      if (overflowPointerOffset + 4 > page.length) {
        debugSqliteLog("sqlite:btree:overflow-pointer-missing", {
          pageNumber,
          pointer,
          payloadLength: payloadLength.value,
          localLength,
        });
        continue;
      }
      const firstOverflowPage = page.readUInt32BE(overflowPointerOffset);
      try {
        payload = Buffer.concat([
          payload,
          readOverflowPayload(db, pageSize, firstOverflowPage, payloadLength.value - localLength),
        ]);
        debugSqliteLog("sqlite:btree:overflow-payload-loaded", {
          pageNumber,
          pointer,
          payloadLength: payloadLength.value,
          localLength,
          firstOverflowPage,
        });
      } catch (error) {
        debugSqliteLog("sqlite:btree:overflow-payload-failed", {
          pageNumber,
          pointer,
          payloadLength: payloadLength.value,
          localLength,
          firstOverflowPage,
          error: error.message,
        });
        continue;
      }
    }
    try {
      rows.push({ rowId: rowId.value, values: parseSqliteRecord(payload) });
    } catch (error) {
      debugSqliteLog("sqlite:record:parse-failed", { pageNumber, pointer, error: error.message });
    }
  }
  return rows;
}

function getSqliteSchema(db) {
  const pageSize = db.readUInt16BE(16) || 65536;
  const rows = collectTableLeafRows(db, pageSize, 1, []);
  const schema = rows.map((row) => ({
    type: row.values[0],
    name: row.values[1],
    tableName: row.values[2],
    rootPage: row.values[3],
    sql: row.values[4],
  }));
  debugSqliteLog("sqlite:schema", {
    pageSize,
    count: schema.length,
    tables: schema
      .filter((entry) => entry.type === "table")
      .map((entry) => ({ name: entry.name, rootPage: entry.rootPage })),
  });
  return schema;
}

function getSqliteTableRows(db, tableName) {
  const pageSize = db.readUInt16BE(16) || 65536;
  const schema = getSqliteSchema(db);
  const table = schema.find((entry) => entry.type === "table" && entry.name === tableName);
  if (!table) throw new Error(`酷狗数据库缺少 ${tableName} 表。`);

  const columns = parseCreateTableColumns(table.sql || "");
  const rows = collectTableLeafRows(db, pageSize, table.rootPage, []);
  debugSqliteLog("sqlite:table:loaded", {
    tableName,
    rootPage: table.rootPage,
    columnCount: columns.length,
    rowCount: rows.length,
    columns,
  });
  return rows.map((row) => Object.fromEntries(columns.map((column, index) => [column, row.values[index]])));
}

function findKggEKey(audioHash) {
  const dbPath = getDefaultKugouDatabasePath();
  debugLog("kgg-v5:find-ekey:start", { audioHash, dbPath: dbPath || "" });
  if (!dbPath) {
    throw new Error("KGG v5 需要酷狗本地数据库 KGMusicV3.db，但未在 %APPDATA%\\Kugou8 下找到。");
  }

  const db = decryptKugouDatabase(fs.readFileSync(dbPath));
  try {
    const loadedTableName = "ShareFileItems";
    const shareFileRows = getSqliteTableRows(db, loadedTableName);

    if (shareFileRows.length) {
      const strongIdColumns = ["EncryptionKeyId", "FileHash", "Hash", "AudioHash", "audioHash"];
      const fallbackIdColumns = ["MD5", "OriginalHash", "PartMD5"];
      const idColumns = [...strongIdColumns, ...fallbackIdColumns];
      const keyColumns = ["EncryptionKey", "EKey", "ekey", "Key"];
      const matchingRows = shareFileRows
        .map((item, index) => {
          const matchedColumn = idColumns.find((column) =>
            String(item[column] || "").toLowerCase() === audioHash.toLowerCase(),
          );
          const keyColumn = keyColumns.find((column) => item[column]);
          const ekey = keyColumn ? String(item[keyColumn]) : "";
          return {
            item,
            index,
            matchedColumn,
            keyColumn,
            ekey,
            score:
              (ekey ? 100 : 0)
              + (strongIdColumns.includes(matchedColumn) ? 20 : 0)
              + (matchedColumn === "EncryptionKeyId" ? 10 : 0),
          };
        })
        .filter((entry) => entry.matchedColumn)
        .sort((a, b) => b.score - a.score || a.index - b.index);

      if (matchingRows.length) {
        const selected = matchingRows[0];
        const row = selected.item;
        const ekey = selected.ekey;
        debugLog("kgg-v5:find-ekey:sqlite-row", {
          audioHash,
          loadedTableName,
          matchedColumn: selected.matchedColumn,
          keyColumn: selected.keyColumn || "",
          ekeyLength: ekey.length,
          ekeyPrefix: ekey.slice(0, 32),
          matchedRows: matchingRows.length,
          rowColumns: Object.keys(row),
        });
        if (ekey) return ekey;
        debugLog("kgg-v5:find-ekey:sqlite-empty-key", {
          audioHash,
          loadedTableName,
          matchedRows: matchingRows.length,
          matchedColumns: matchingRows.map((entry) => entry.matchedColumn).slice(0, 8),
        });
      } else {
        debugLog("kgg-v5:find-ekey:sqlite-row-not-found", {
          audioHash,
          loadedTableName,
          rowCount: shareFileRows.length,
          firstColumns: Object.keys(shareFileRows[0] || {}),
        });
      }
    }
  } catch (error) {
    debugLog("kgg-v5:find-ekey:sqlite-failed", { audioHash, error: error.message, stack: error.stack });
  }

  const dbText = normalizeDbText(db);
  const hashIndex = dbText.indexOf(audioHash);
  debugLog("kgg-v5:find-ekey:hash-search", { audioHash, hashIndex, dbTextLength: dbText.length });
  if (hashIndex < 0) {
    throw new Error(`KGG v5 密钥未在酷狗数据库中找到：${audioHash}`);
  }

  const windowText = dbText.slice(Math.max(0, hashIndex - 8192), Math.min(dbText.length, hashIndex + 8192));
  const hashAdjacentEKey = findHashAdjacentKggEKey(windowText, audioHash);
  if (hashAdjacentEKey) {
    debugLog("kgg-v5:find-ekey:hash-adjacent", {
      audioHash,
      source: hashAdjacentEKey.source,
      ekeyLength: hashAdjacentEKey.ekey.length,
      ekeyPrefix: hashAdjacentEKey.ekey.slice(0, 32),
      relativeIndex: hashAdjacentEKey.relativeIndex,
      wrapperPrefix: hashAdjacentEKey.wrapperPrefix,
    });
    return hashAdjacentEKey.ekey;
  }

  const encV2Match = windowText.match(/QQMusic EncV2,Key:[A-Za-z0-9+/=]+/);
  if (encV2Match) {
    debugLog("kgg-v5:find-ekey:encv2-match", {
      audioHash,
      ekeyLength: encV2Match[0].length,
      ekeyPrefix: encV2Match[0].slice(0, 32),
      relativeIndex: encV2Match.index,
    });
    return encV2Match[0];
  }

  const base64Matches = [...windowText.matchAll(/[A-Za-z0-9+/]{32,}={0,2}/g)]
    .map((match) => match[0])
    .filter((value) => (
      value !== audioHash
      && !/^[0A]+={0,2}$/i.test(value)
      && isPlausibleQmcEKey(value)
    ));
  if (base64Matches.length) {
    const candidates = base64Matches.sort((a, b) => b.length - a.length);
    debugLog("kgg-v5:find-ekey:base64-candidates", {
      audioHash,
      count: candidates.length,
      top: candidates.slice(0, 5).map((value) => ({ length: value.length, prefix: value.slice(0, 24) })),
    });
    const derivable = selectDerivableKggEKey(candidates, audioHash, "base64-candidates");
    if (derivable) return derivable;
  }

  debugLog("kgg-v5:find-ekey:no-ekey", {
    audioHash,
    windowHead: windowText.slice(0, 160),
    windowTail: windowText.slice(-160),
  });
  throw new Error(`KGG v5 找到 audioHash，但未能定位 EncryptionKey：${audioHash}`);
}

function teaDecryptBlock(block, key, rounds = 32) {
  let v0 = block.readUInt32BE(0) >>> 0;
  let v1 = block.readUInt32BE(4) >>> 0;
  const k0 = key.readUInt32BE(0) >>> 0;
  const k1 = key.readUInt32BE(4) >>> 0;
  const k2 = key.readUInt32BE(8) >>> 0;
  const k3 = key.readUInt32BE(12) >>> 0;
  const delta = 0x9e3779b9 >>> 0;
  let sum = Math.imul(delta, rounds / 2) >>> 0;

  for (let round = 0; round < rounds / 2; round += 1) {
    v1 = (v1 - ((((v0 << 4) >>> 0) + k2) ^ (v0 + sum) ^ ((v0 >>> 5) + k3))) >>> 0;
    v0 = (v0 - ((((v1 << 4) >>> 0) + k0) ^ (v1 + sum) ^ ((v1 >>> 5) + k1))) >>> 0;
    sum = (sum - delta) >>> 0;
  }

  const output = Buffer.alloc(8);
  output.writeUInt32BE(v0, 0);
  output.writeUInt32BE(v1, 4);
  return output;
}

function simpleMakeKey(salt, length) {
  const key = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    key[index] = Math.floor(Math.abs(Math.tan(salt + index * 0.1)) * 100) & 0xff;
  }
  return key;
}

function decryptTencentTea(input, key) {
  debugLog("qmc-key:tea:start", { inputLength: input.length, key });
  if (input.length % 8 !== 0 || input.length < 16) {
    debugLog("qmc-key:tea:bad-length", { inputLength: input.length, inputHead: input.subarray(0, 32) });
    throw new Error("QMC key TEA 数据长度异常。");
  }

  const firstPlain = teaDecryptBlock(input.subarray(0, 8), key);
  const padLen = firstPlain[0] & 0x07;
  const outLen = input.length - 1 - padLen - 2 - 7;
  debugLog("qmc-key:tea:layout", { inputLength: input.length, padLen, outLen, firstPlain });
  if (outLen <= 0) {
    debugLog("qmc-key:tea:bad-output-length", { inputLength: input.length, padLen, outLen });
    throw new Error("QMC key TEA 解密结果异常。");
  }

  const output = Buffer.alloc(outLen);
  let inOffset = 8;
  let outOffset = 0;
  let pos = 1 + padLen + 2;
  let prevCipher = Buffer.alloc(8);
  let plain = firstPlain;

  while (outOffset < outLen) {
    if (pos < 8) {
      output[outOffset] = plain[pos] ^ prevCipher[pos];
      outOffset += 1;
      pos += 1;
      continue;
    }

    prevCipher = input.subarray(inOffset - 8, inOffset);
    const block = teaDecryptBlock(input.subarray(inOffset, inOffset + 8), key);
    plain = Buffer.alloc(8);
    for (let index = 0; index < 8; index += 1) {
      plain[index] = block[index] ^ prevCipher[index];
    }
    inOffset += 8;
    pos = 0;
  }

  debugLog("qmc-key:tea:done", { outputLength: output.length, outputHead: output.subarray(0, 32) });
  return output;
}

function decryptTencentTeaCompat(input, key) {
  debugLog("qmc-key:tea2:start", { inputLength: input.length, key });
  if (input.length % 8 !== 0 || input.length < 16) {
    debugLog("qmc-key:tea2:bad-length", { inputLength: input.length, inputHead: input.subarray(0, 32) });
    throw new Error("QMC key TEA data length is invalid.");
  }

  let blockPlain = teaDecryptBlock(input.subarray(0, 8), key);
  const padLen = blockPlain[0] & 0x07;
  const outLen = input.length - 1 - padLen - 2 - 7;
  debugLog("qmc-key:tea2:layout", { inputLength: input.length, padLen, outLen, firstPlain: blockPlain });
  if (outLen <= 0) {
    debugLog("qmc-key:tea2:bad-output-length", { inputLength: input.length, padLen, outLen });
    throw new Error("QMC key TEA output length is invalid.");
  }

  const output = Buffer.alloc(outLen);
  let prevCipher = Buffer.alloc(8);
  let currentCipher = Buffer.from(input.subarray(0, 8));
  let inOffset = 8;
  let outOffset = 0;

  const cryptBlock = () => {
    prevCipher = currentCipher;
    currentCipher = Buffer.from(input.subarray(inOffset, inOffset + 8));
    const mixed = Buffer.alloc(8);
    for (let index = 0; index < 8; index += 1) {
      mixed[index] = blockPlain[index] ^ currentCipher[index];
    }
    blockPlain = teaDecryptBlock(mixed, key);
    inOffset += 8;
    return 0;
  };

  let pos = 1 + padLen;
  for (let saltIndex = 0; saltIndex < 2;) {
    if (pos < 8) {
      pos += 1;
      saltIndex += 1;
    } else {
      pos = cryptBlock();
    }
  }

  while (outOffset < outLen) {
    if (pos < 8) {
      output[outOffset] = blockPlain[pos] ^ prevCipher[pos];
      outOffset += 1;
      pos += 1;
    } else {
      pos = cryptBlock();
    }
  }

  for (let zeroIndex = 0; zeroIndex < 7;) {
    if (pos >= 8) {
      pos = cryptBlock();
      continue;
    }
    if (blockPlain[pos] !== prevCipher[pos]) {
      debugLog("qmc-key:tea2:zero-check-failed", {
        zeroIndex,
        pos,
        plain: blockPlain[pos],
        prevCipher: prevCipher[pos],
      });
      throw new Error("QMC key TEA zero check failed.");
    }
    pos += 1;
    zeroIndex += 1;
  }

  debugLog("qmc-key:tea2:done", { outputLength: output.length, outputHead: output.subarray(0, 32) });
  return output;
}

function decryptQmcV2Key(key) {
  const rawKey = Buffer.isBuffer(key) ? key : Buffer.from(String(key));
  const prefix = rawKey.subarray(0, QMC_V2_PREFIX.length);
  const isEncV2 = prefix.equals(Buffer.from(QMC_V2_PREFIX));
  debugLog("qmc-key:encv2:start", {
    rawLength: rawKey.length,
    isEncV2,
    prefix,
  });
  if (!isEncV2) return rawKey;

  const stage1 = decryptTencentTeaCompat(rawKey.subarray(QMC_V2_PREFIX.length), QMC_MIX_KEY_1);
  const stage2 = decryptTencentTeaCompat(stage1, QMC_MIX_KEY_2);
  const decoded = Buffer.from(stage2.toString("utf8"), "base64");
  debugLog("qmc-key:encv2:done", { stage1Length: stage1.length, stage2Length: stage2.length, decoded });
  if (decoded.length < 16) throw new Error("QMC EncV2 key decode failed.");
  return decoded;
}

function deriveQmcKey(ekey) {
  const ekeyText = String(ekey).trim();
  debugLog("qmc-key:derive:start", {
    ekeyLength: ekeyText.length,
    ekeyPrefix: ekeyText.slice(0, 40),
    isEncV2Text: ekeyText.startsWith(QMC_V2_PREFIX),
  });
  let raw = ekeyText.startsWith(QMC_V2_PREFIX)
    ? Buffer.from(ekeyText, "utf8")
    : Buffer.from(ekeyText, "base64");
  if (raw.length > 0 && raw.subarray(0, QMC_V2_PREFIX.length).equals(Buffer.from(QMC_V2_PREFIX))) {
    debugLog("qmc-key:derive:raw-is-encv2", { rawLength: raw.length });
  }
  if (raw.length < 16) throw new Error("QMC ekey 长度过短。");
  raw = decryptQmcV2Key(raw);

  const simpleKey = simpleMakeKey(106, 8);
  const teaKey = Buffer.alloc(16);
  for (let index = 0; index < 8; index += 1) {
    teaKey[index * 2] = simpleKey[index];
    teaKey[index * 2 + 1] = raw[index];
  }

  const tail = decryptTencentTeaCompat(raw.subarray(8), teaKey);
  const derived = Buffer.concat([raw.subarray(0, 8), tail]);
  debugLog("qmc-key:derive:done", { rawLength: raw.length, tailLength: tail.length, derived });
  return derived;
}

class QmcRC4Cipher {
  constructor(key) {
    if (!key.length) throw new Error("QMC key 为空。");
    this.key = Buffer.from(key);
    this.n = this.key.length;
    this.s = Buffer.alloc(this.n);
    for (let index = 0; index < this.n; index += 1) this.s[index] = index & 0xff;

    let j = 0;
    for (let index = 0; index < this.n; index += 1) {
      j = (this.s[index] + j + this.key[index % this.n]) % this.n;
      [this.s[index], this.s[j]] = [this.s[j], this.s[index]];
    }

    this.hash = 1;
    for (let index = 0; index < this.n; index += 1) {
      const value = this.key[index];
      if (!value) continue;
      const nextHash = Math.imul(this.hash, value) >>> 0;
      if (nextHash === 0 || nextHash <= this.hash) break;
      this.hash = nextHash;
    }
  }

  getSegmentKey(id) {
    const seed = this.key[id % this.n];
    if (!seed) return 0;
    return Math.floor((this.hash / ((id + 1) * seed)) * 100.0) % this.n;
  }

  decrypt(buffer, offset = 0) {
    let toProcess = buffer.length;
    let processed = 0;
    const postProcess = (length) => {
      toProcess -= length;
      processed += length;
      offset += length;
      return toProcess === 0;
    };

    if (offset < 0x80) {
      const length = Math.min(buffer.length, 0x80 - offset);
      for (let index = 0; index < length; index += 1) {
        buffer[index] ^= this.key[this.getSegmentKey(offset + index)];
      }
      if (postProcess(length)) return;
    }

    if (offset % 5120 !== 0) {
      const length = Math.min(5120 - (offset % 5120), toProcess);
      this.decryptSegment(buffer.subarray(processed, processed + length), offset);
      if (postProcess(length)) return;
    }

    while (toProcess > 5120) {
      this.decryptSegment(buffer.subarray(processed, processed + 5120), offset);
      postProcess(5120);
    }

    if (toProcess > 0) {
      this.decryptSegment(buffer.subarray(processed), offset);
    }
  }

  decryptSegment(buffer, offset) {
    const s = Buffer.from(this.s);
    const skipLen = (offset % 5120) + this.getSegmentKey(Math.floor(offset / 5120));
    let j = 0;
    let k = 0;
    for (let index = -skipLen; index < buffer.length; index += 1) {
      j = (j + 1) % this.n;
      k = (s[j] + k) % this.n;
      [s[k], s[j]] = [s[j], s[k]];
      if (index >= 0) {
        buffer[index] ^= s[(s[j] + s[k]) % this.n];
      }
    }
  }
}

class QmcMapCipher {
  constructor(key) {
    if (!key.length) throw new Error("QMC key is empty.");
    this.key = Buffer.from(key);
    this.n = this.key.length;
  }

  static rotate(value, bits) {
    const shift = (bits + 4) % 8;
    return ((value << shift) | (value >> shift)) & 0xff;
  }

  getMask(offset) {
    let pos = offset;
    if (pos > 0x7fff) pos %= 0x7fff;
    const index = ((pos * pos) + 71214) % this.n;
    return QmcMapCipher.rotate(this.key[index], index & 0x07);
  }

  decrypt(buffer, offset = 0) {
    for (let index = 0; index < buffer.length; index += 1) {
      buffer[index] ^= this.getMask(offset + index);
    }
  }
}

function decodeKugouV5(source, headerLength, audioHash, outputDirectory) {
  debugLog("kgg-v5:decode:start", { sourceLength: source.length, headerLength, audioHash });
  const audio = Buffer.from(source.subarray(headerLength));
  const cryptoSlot = source.readUInt32LE(0x18);
  const cryptoKey = source.subarray(0x2c, 0x3c);
  let outputExt = "bin";
  try {
    decryptKugouV3Audio(audio, cryptoSlot, cryptoKey, 0);
    outputExt = sniffExt(audio);
    debugLog("kgg-v5:decode:kgm-sniff", {
      outputExt,
      audioLength: audio.length,
      audioHead: audio.subarray(0, 64),
      cryptoSlot,
      flacFrameOffset: outputExt === "flac" ? findFlacFirstFrameOffset(audio) : -1,
    });
    if (isLikelyAudioBuffer(audio, outputExt)) {
      return writeDecodedAudio(outputDirectory, outputExt, audio);
    }
  } catch (error) {
    debugLog("kgg-v5:decode:kgm-skip", { cryptoSlot, error: error.message });
  }

  const ekey = findKggEKey(audioHash);
  const qmcKey = deriveQmcKey(ekey);
  const qmcAudio = Buffer.from(source.subarray(headerLength));
  const cipherName = qmcKey.length > 300 ? "rc4" : "map";
  const cipher = cipherName === "rc4" ? new QmcRC4Cipher(qmcKey) : new QmcMapCipher(qmcKey);
  debugLog("kgg-v5:decode:cipher", { cipherName, qmcKeyLength: qmcKey.length });
  cipher.decrypt(qmcAudio, 0);

  outputExt = sniffExt(qmcAudio);
  debugLog("kgg-v5:decode:audio-sniff", {
    outputExt,
    audioLength: qmcAudio.length,
    audioHead: qmcAudio.subarray(0, 64),
    flacFrameOffset: outputExt === "flac" ? findFlacFirstFrameOffset(qmcAudio) : -1,
  });
  if (!isLikelyAudioBuffer(qmcAudio, outputExt)) {
    throw new Error("KGG v5 解锁完成但未识别出音频流，可能密钥不匹配或当前 QMC 变体未覆盖。");
  }

  return writeDecodedAudio(outputDirectory, outputExt, qmcAudio);
}

function decodeKugouFile(inputPath, outputDirectory) {
  const source = fs.readFileSync(inputPath);
  const ext = path.extname(inputPath).toLowerCase();
  const isVpr = ext === ".vpr";
  debugLog("kugou:decode-file:start", { inputPath, ext, size: source.length });

  if (!hasPrefix(source, isVpr ? VPR_HEADER : KGM_HEADER)) {
    throw new Error("不是有效的 KGM/KGMA/VPR 文件，或该 KGG/KGM 版本暂不支持纯 JS 解锁。");
  }

  const cryptoVersion = source.readUInt32LE(0x14);
  const headerLength = source.readUInt32LE(0x10);
  debugLog("kugou:header", { ext, cryptoVersion, headerLength });
  if (cryptoVersion && cryptoVersion !== 3) {
    if (cryptoVersion === 5) {
      const audioHashLength = source.readUInt32LE(0x44);
      const audioHash = source.subarray(0x48, 0x48 + audioHashLength).toString("utf8");
      debugLog("kgg-v5:header", { audioHashLength, audioHash });
      if (!audioHash) throw new Error("KGG v5 文件缺少 audioHash。");
      return decodeKugouV5(source, headerLength, audioHash, outputDirectory);
    }
    throw new Error(`当前纯 JS 解锁器不支持 KGM/KGG v${cryptoVersion}。`);
  }

  const audio = Buffer.from(source.subarray(headerLength));

  if (isVpr) {
    const key = Buffer.alloc(17);
    source.copy(key, 0, 0x1c, 0x2c);
    for (let index = 0; index < audio.length; index += 1) {
      let med = key[index % 17] ^ audio[index];
      med ^= (med & 0x0f) << 4;
      let mask = getMask(index);
      mask ^= (mask & 0x0f) << 4;
      audio[index] = (med ^ mask ^ VPR_MASK_DIFF[index % 17]) & 0xff;
    }
  } else {
    decryptKugouV3Audio(audio, source.readUInt32LE(0x18), source.subarray(0x2c, 0x3c), 0);
  }

  const outputExt = sniffExt(audio);
  debugLog("kgm-v3:audio-sniff", {
    outputExt,
    audioLength: audio.length,
    audioHead: audio.subarray(0, 64),
    flacFrameOffset: outputExt === "flac" ? findFlacFirstFrameOffset(audio) : -1,
  });
  if (!isLikelyAudioBuffer(audio, outputExt)) {
    throw new Error("KGM 预处理完成但未识别出音频流，可能是 KGG/v5 或未覆盖的新加密版本。");
  }

  return writeDecodedAudio(outputDirectory, outputExt, audio);
}

module.exports = { decodeKugouFile };
