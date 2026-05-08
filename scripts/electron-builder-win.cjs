const path = require("path");
const { spawnSync } = require("child_process");

const builderCli = require.resolve("electron-builder/cli.js", {
  paths: [path.join(__dirname, "..")],
});
const args = process.argv.slice(2);

const result = spawnSync(process.execPath, [builderCli, ...args], {
  cwd: path.join(__dirname, ".."),
  env: {
    ...process.env,
    npm_config_user_agent: "npm",
    npm_execpath: "",
  },
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(result.error);
}

process.exit(result.status ?? 1);
