const fs = require("fs");
const path = require("path");

const CONFIG_FILE = "plugins.json";

let appRef = null;
let userPluginDirectory = "";
let marketplaceDirectory = "";
let configPath = "";
let config = {
  installedMarketplaceIds: [],
  disabledPluginIds: [],
};
let catalog = [];
let activePreprocessors = [];
let pluginLoadErrors = new Map();
let initialized = false;

function normalizeExtension(extension) {
  const value = String(extension || "").trim().toLowerCase();
  if (!value) return "";
  return value.startsWith(".") ? value : `.${value}`;
}

function uniqueExtensions(extensions) {
  return [...new Set((extensions || []).map(normalizeExtension).filter(Boolean))];
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function getDefaultAppRoot() {
  return path.resolve(__dirname, "..", "..");
}

function getAppRoot() {
  if (appRef?.getAppPath) return appRef.getAppPath();
  return getDefaultAppRoot();
}

function getUserDataPath() {
  if (appRef?.getPath) return appRef.getPath("userData");
  return path.join(getDefaultAppRoot(), ".plugin-data");
}

function listPackageDirectories(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name));
}

function readPluginPackage(directory, source) {
  const manifestPath = path.join(directory, "plugin.json");
  const manifest = readJson(manifestPath);
  if (!manifest || typeof manifest !== "object") return null;

  const id = String(manifest.id || "").trim();
  const name = String(manifest.name || id).trim();
  const version = String(manifest.version || "0.0.0").trim();
  const entry = String(manifest.entry || "main.js").trim();
  const extensions = uniqueExtensions(manifest.extensions);

  if (!id || !name || !extensions.length) return null;

  return {
    id,
    name,
    version,
    description: String(manifest.description || "").trim(),
    author: String(manifest.author || "").trim(),
    extensions,
    entry,
    defaultEnabled: Boolean(manifest.defaultEnabled),
    directory,
    source,
    entryPath: path.join(directory, entry),
  };
}

function loadConfig(marketplacePackages) {
  config = readJson(configPath, null);
  if (!config || typeof config !== "object") {
    config = {
      installedMarketplaceIds: marketplacePackages
        .filter((plugin) => plugin.defaultEnabled)
        .map((plugin) => plugin.id),
      disabledPluginIds: [],
    };
    writeJson(configPath, config);
    return;
  }

  config.installedMarketplaceIds = Array.isArray(config.installedMarketplaceIds)
    ? config.installedMarketplaceIds
    : [];
  config.disabledPluginIds = Array.isArray(config.disabledPluginIds)
    ? config.disabledPluginIds
    : [];
}

function isMarketplaceInstalled(plugin) {
  return config.installedMarketplaceIds.includes(plugin.id);
}

function isDisabled(plugin) {
  return config.disabledPluginIds.includes(plugin.id);
}

function isEnabled(plugin) {
  if (plugin.source === "marketplace" && !isMarketplaceInstalled(plugin)) return false;
  return !isDisabled(plugin);
}

function toPublicPlugin(plugin, extra = {}) {
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    author: plugin.author,
    extensions: plugin.extensions.map((extension) => extension.slice(1)),
    source: plugin.source,
    installed: plugin.source === "external" || isMarketplaceInstalled(plugin),
    enabled: isEnabled(plugin),
    directory: plugin.directory,
    error: pluginLoadErrors.get(plugin.id) || "",
    ...extra,
  };
}

function loadPreprocessor(plugin) {
  if (!fs.existsSync(plugin.entryPath)) {
    return {
      plugin,
      error: `入口文件不存在：${plugin.entry}`,
    };
  }

  try {
    delete require.cache[require.resolve(plugin.entryPath)];
    const moduleValue = require(plugin.entryPath);
    const pluginApi = typeof moduleValue === "function" ? moduleValue() : moduleValue;
    const decode = pluginApi?.decode || pluginApi?.decodeFile;

    if (typeof decode !== "function") {
      throw new Error("插件必须导出 decode 或 decodeFile 函数。");
    }

    return {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      extensions: plugin.extensions,
      source: plugin.source,
      directory: plugin.directory,
      decode,
    };
  } catch (error) {
    return {
      plugin,
      error: error.message || String(error),
    };
  }
}

function refreshCatalog() {
  const marketplacePackages = listPackageDirectories(marketplaceDirectory)
    .map((directory) => readPluginPackage(directory, "marketplace"))
    .filter(Boolean);

  loadConfig(marketplacePackages);

  const externalPackages = listPackageDirectories(userPluginDirectory)
    .map((directory) => readPluginPackage(directory, "external"))
    .filter(Boolean);

  const seen = new Set();
  catalog = [...marketplacePackages, ...externalPackages].filter((plugin) => {
    if (seen.has(plugin.id)) return false;
    seen.add(plugin.id);
    return true;
  });

  const loaded = [];
  const errors = new Map();

  for (const plugin of catalog.filter(isEnabled)) {
    const result = loadPreprocessor(plugin);
    if (result.error) {
      errors.set(plugin.id, result.error);
    } else {
      loaded.push(result);
    }
  }

  activePreprocessors = loaded;
  pluginLoadErrors = errors;
  return { errors };
}

function ensureInitialized() {
  if (initialized) return;
  initializePreprocessors(appRef);
}

function initializePreprocessors(appInstance = null) {
  appRef = appInstance || appRef;
  const appRoot = getAppRoot();
  marketplaceDirectory = path.join(appRoot, "plugins", "marketplace");
  userPluginDirectory = path.join(getUserDataPath(), "plugins");
  configPath = path.join(getUserDataPath(), CONFIG_FILE);
  fs.mkdirSync(userPluginDirectory, { recursive: true });
  initialized = true;
  refreshCatalog();
}

function reloadPreprocessors() {
  ensureInitialized();
  return getPluginCatalog();
}

function getPreprocessExtensions() {
  ensureInitialized();
  return new Set(activePreprocessors.flatMap((plugin) => plugin.extensions));
}

function getPreprocessorForPath(inputPath) {
  ensureInitialized();
  const ext = path.extname(inputPath).toLowerCase();
  return activePreprocessors.find((plugin) => plugin.extensions.includes(ext)) || null;
}

async function decodeWithPreprocessor(inputPath, outputDirectory) {
  const preprocessor = getPreprocessorForPath(inputPath);
  if (!preprocessor) {
    throw new Error("没有可用于该格式的音频解锁插件。");
  }

  const result = await Promise.resolve(
    preprocessor.decode({
      inputPath,
      outputDirectory,
      pluginDirectory: preprocessor.directory,
      extensions: preprocessor.extensions,
    })
  );
  const decodedPath = typeof result === "string" ? result : result?.decodedPath || result?.path || "";

  return {
    preprocessor,
    decodedPath,
  };
}

function getPluginCatalog() {
  ensureInitialized();
  const activeIds = new Set(activePreprocessors.map((plugin) => plugin.id));
  return {
    marketplaceDirectory,
    userPluginDirectory,
    plugins: catalog.map((plugin) =>
      toPublicPlugin(plugin, {
        active: activeIds.has(plugin.id),
      })
    ),
  };
}

function saveConfig() {
  writeJson(configPath, config);
  refreshCatalog();
}

function installMarketplacePlugin(id) {
  ensureInitialized();
  const plugin = catalog.find((entry) => entry.id === id && entry.source === "marketplace");
  if (!plugin) throw new Error("插件市场中没有找到该插件。");
  if (!config.installedMarketplaceIds.includes(id)) {
    config.installedMarketplaceIds.push(id);
  }
  config.disabledPluginIds = config.disabledPluginIds.filter((pluginId) => pluginId !== id);
  saveConfig();
  return getPluginCatalog();
}

function uninstallMarketplacePlugin(id) {
  ensureInitialized();
  config.installedMarketplaceIds = config.installedMarketplaceIds.filter((pluginId) => pluginId !== id);
  config.disabledPluginIds = config.disabledPluginIds.filter((pluginId) => pluginId !== id);
  saveConfig();
  return getPluginCatalog();
}

function setPluginEnabled(id, enabled) {
  ensureInitialized();
  const plugin = catalog.find((entry) => entry.id === id);
  if (!plugin) throw new Error("没有找到该插件。");

  if (enabled) {
    if (plugin.source === "marketplace" && !config.installedMarketplaceIds.includes(id)) {
      config.installedMarketplaceIds.push(id);
    }
    config.disabledPluginIds = config.disabledPluginIds.filter((pluginId) => pluginId !== id);
  } else if (!config.disabledPluginIds.includes(id)) {
    config.disabledPluginIds.push(id);
  }

  saveConfig();
  return getPluginCatalog();
}

module.exports = {
  decodeWithPreprocessor,
  getPluginCatalog,
  getPreprocessExtensions,
  getPreprocessorForPath,
  initializePreprocessors,
  installMarketplacePlugin,
  reloadPreprocessors,
  setPluginEnabled,
  uninstallMarketplacePlugin,
};
