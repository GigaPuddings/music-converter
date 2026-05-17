const { decodeNcmFile } = require("../../../electron/ncm-decrypt");

function decode({ inputPath, outputDirectory }) {
  return decodeNcmFile(inputPath, outputDirectory);
}

module.exports = { decode };
