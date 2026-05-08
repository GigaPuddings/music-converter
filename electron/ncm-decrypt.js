const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const NCM_MAGIC = Buffer.from("CTENFDAM");
const NCM_KEY_CORE = Buffer.from([
  0x68, 0x7a, 0x48, 0x52, 0x41, 0x6d, 0x73, 0x6f,
  0x35, 0x6b, 0x49, 0x6e, 0x62, 0x61, 0x78, 0x57,
]);
const NCM_KEY_META = Buffer.from([
  0x23, 0x31, 0x34, 0x6c, 0x6a, 0x6b, 0x5f, 0x21,
  0x5c, 0x5d, 0x26, 0x30, 0x55, 0x3c, 0x27, 0x28,
]);

function aes128EcbDecrypt(buffer, key) {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

function pkcs7Unpad(buffer) {
  if (!buffer.length) return buffer;
  const pad = buffer[buffer.length - 1];
  if (pad <= 0 || pad > 16 || pad > buffer.length) return buffer;
  for (let index = buffer.length - pad; index < buffer.length; index += 1) {
    if (buffer[index] !== pad) return buffer;
  }
  return buffer.subarray(0, buffer.length - pad);
}

function readUInt32LE(source, state, label) {
  if (state.offset + 4 > source.length) throw new Error(`NCM 文件不完整，无法读取 ${label}。`);
  const value = source.readUInt32LE(state.offset);
  state.offset += 4;
  return value;
}

function readBytes(source, state, length, label) {
  if (length < 0 || state.offset + length > source.length) {
    throw new Error(`NCM 文件不完整，无法读取 ${label}。`);
  }
  const value = source.subarray(state.offset, state.offset + length);
  state.offset += length;
  return value;
}

function decodeNcmKey(source, state) {
  const keyLength = readUInt32LE(source, state, "key length");
  const encryptedKey = Buffer.from(readBytes(source, state, keyLength, "key data"));
  for (let index = 0; index < encryptedKey.length; index += 1) encryptedKey[index] ^= 0x64;

  const keyData = pkcs7Unpad(aes128EcbDecrypt(encryptedKey, NCM_KEY_CORE));
  if (keyData.length <= 17) throw new Error("NCM 音频密钥解析失败。");
  return keyData.subarray(17);
}

function decodeNcmMeta(source, state) {
  const metaLength = readUInt32LE(source, state, "meta length");
  if (!metaLength) return {};

  let metaRaw = Buffer.from(readBytes(source, state, metaLength, "meta data"));
  if (metaRaw.length <= 22) return {};
  metaRaw = metaRaw.subarray(22);
  for (let index = 0; index < metaRaw.length; index += 1) metaRaw[index] ^= 0x63;

  try {
    const cipherText = Buffer.from(metaRaw.toString("utf8"), "base64");
    const plain = pkcs7Unpad(aes128EcbDecrypt(cipherText, NCM_KEY_META));
    const separator = plain.indexOf(0x3a);
    if (separator < 0) return {};
    const type = plain.subarray(0, separator).toString("utf8");
    const jsonText = plain.subarray(separator + 1).toString("utf8");
    return { type, data: JSON.parse(jsonText) };
  } catch (error) {
    return {};
  }
}

function skipNcmCover(source, state) {
  if (state.offset + 9 > source.length) throw new Error("NCM 文件不完整，无法读取封面信息。");
  state.offset += 5;

  const coverFrameLength = readUInt32LE(source, state, "cover frame length");
  const coverFrameStart = state.offset;
  const coverLength = readUInt32LE(source, state, "cover length");
  readBytes(source, state, coverLength, "cover data");
  state.offset = coverFrameStart + coverFrameLength + 4;
  if (state.offset > source.length) throw new Error("NCM 封面区长度异常。");
}

function buildNcmKeyBox(key) {
  if (!key.length) throw new Error("NCM 音频密钥为空。");
  const box = Buffer.alloc(256);
  for (let index = 0; index < 256; index += 1) box[index] = index;

  let j = 0;
  for (let index = 0; index < 256; index += 1) {
    j = (box[index] + j + key[index % key.length]) & 0xff;
    [box[index], box[j]] = [box[j], box[index]];
  }

  const keyBox = Buffer.alloc(256);
  for (let index = 0; index < 256; index += 1) {
    const i = (index + 1) & 0xff;
    const si = box[i];
    const sj = box[(i + si) & 0xff];
    keyBox[index] = box[(si + sj) & 0xff];
  }
  return keyBox;
}

function decryptNcmAudio(audio, key) {
  const keyBox = buildNcmKeyBox(key);
  const output = Buffer.from(audio);
  for (let index = 0; index < output.length; index += 1) {
    output[index] ^= keyBox[index & 0xff];
  }
  return output;
}

function sniffExt(buffer) {
  if (buffer.subarray(0, 4).equals(Buffer.from("fLaC"))) return "flac";
  if (buffer.subarray(0, 3).equals(Buffer.from("ID3")) || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return "mp3";
  if (buffer.subarray(0, 4).equals(Buffer.from("OggS"))) return "ogg";
  if (buffer.subarray(0, 4).equals(Buffer.from("RIFF")) && buffer.subarray(8, 12).equals(Buffer.from("WAVE"))) return "wav";
  if (buffer.subarray(4, 8).equals(Buffer.from("ftyp"))) return "m4a";
  return "";
}

function getMetaFormat(meta) {
  const value = meta?.data?.format || meta?.data?.fileFormat || "";
  const format = String(value).toLowerCase().replace(/^\./, "");
  return ["flac", "mp3", "ogg", "wav", "m4a", "aac"].includes(format) ? format : "";
}

function decodeNcmFile(inputPath, outputDirectory) {
  const source = fs.readFileSync(inputPath);
  if (!source.subarray(0, NCM_MAGIC.length).equals(NCM_MAGIC)) {
    throw new Error("不是有效的 NCM 文件。");
  }

  const state = { offset: NCM_MAGIC.length + 2 };
  const audioKey = decodeNcmKey(source, state);
  const meta = decodeNcmMeta(source, state);
  skipNcmCover(source, state);

  const audio = decryptNcmAudio(source.subarray(state.offset), audioKey);
  const outputExt = getMetaFormat(meta) || sniffExt(audio);
  if (!outputExt) throw new Error("NCM 解锁完成但未识别出音频格式。");

  const outputPath = path.join(outputDirectory, `decoded.${outputExt}`);
  fs.writeFileSync(outputPath, audio);
  return outputPath;
}

module.exports = { decodeNcmFile };
