const path = require("path");
const { decodeKugouFile } = require("../kugou-decrypt");
const { decodeNcmFile } = require("../ncm-decrypt");

const preprocessors = [
  {
    id: "ncm",
    name: "NCM unlocker",
    extensions: [".ncm"],
    decode: decodeNcmFile,
  },
  {
    id: "kugou",
    name: "Kugou unlocker",
    extensions: [".kgg", ".kgm", ".kgma", ".vpr"],
    decode: decodeKugouFile,
  },
];

const PREPROCESS_INPUTS = new Set(
  preprocessors.flatMap((preprocessor) => preprocessor.extensions)
);

function getPreprocessorForPath(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  return preprocessors.find((preprocessor) => preprocessor.extensions.includes(ext)) || null;
}

function decodeWithPreprocessor(inputPath, outputDirectory) {
  const preprocessor = getPreprocessorForPath(inputPath);
  if (!preprocessor) {
    throw new Error("没有可用于该格式的音频解锁插件。");
  }

  return {
    preprocessor,
    decodedPath: preprocessor.decode(inputPath, outputDirectory),
  };
}

module.exports = {
  PREPROCESS_INPUTS,
  decodeWithPreprocessor,
  getPreprocessorForPath,
  preprocessors,
};
