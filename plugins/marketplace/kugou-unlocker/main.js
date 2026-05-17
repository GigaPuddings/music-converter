const { decodeKugouFile } = require("../../../electron/kugou-decrypt");

function decode({ inputPath, outputDirectory }) {
  return decodeKugouFile(inputPath, outputDirectory);
}

module.exports = { decode };
