const fs = require("fs");
const path = require("path");

const binDir = path.join(__dirname, "..", "node_modules", ".bin");
fs.mkdirSync(binDir, { recursive: true });

const cmdPath = path.join(binDir, "pwd.CMD");
const ps1Path = path.join(binDir, "pwd.ps1");
const shellPath = path.join(binDir, "pwd");

fs.writeFileSync(
  cmdPath,
  "@ECHO off\r\nnode -e \"console.log(process.cwd())\"\r\n",
  "utf8",
);

fs.writeFileSync(
  ps1Path,
  "node -e \"console.log(process.cwd())\"\r\n",
  "utf8",
);

fs.writeFileSync(
  shellPath,
  "#!/usr/bin/env sh\nnode -e \"console.log(process.cwd())\"\n",
  "utf8",
);
