const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const os = require("os");
const {
  PREPROCESS_INPUTS,
  decodeWithPreprocessor,
} = require("./preprocessors");

let mainWindow;
const runningJobs = new Map();
const cancellingJobs = new Set();

const SUPPORTED_INPUTS = new Set([
  ".aac",
  ".aiff",
  ".alac",
  ".ape",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".opus",
  ".wav",
  ".webm",
  ".wma",
]);

const BLOCKED_ENCRYPTED_INPUTS = new Set([
  ".kwm",
  ".qmc0",
  ".qmc3",
  ".qmcflac",
  ".qmcogg",
  ".mflac",
]);

const OUTPUT_PRESETS = {
  mp3: ["-codec:a", "libmp3lame", "-b:a"],
  flac: ["-codec:a", "flac", "-compression_level"],
  wav: ["-codec:a", "pcm_s16le"],
  m4a: ["-codec:a", "aac", "-b:a"],
  ogg: ["-codec:a", "libvorbis", "-b:a"],
};

const SKIPPED_DIRECTORIES = new Set([
  "$RECYCLE.BIN",
  "System Volume Information",
  "Recovery",
]);

function getRendererEntry() {
  if (process.env.ELECTRON_START_URL) {
    return process.env.ELECTRON_START_URL;
  }

  return path.join(app.getAppPath(), "build", "index.html");
}

function getBundledFfmpegPath() {
  return path.join(process.resourcesPath, "ffmpeg", "ffmpeg.exe");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 640,
    backgroundColor: "#f5f6f1",
    frame: false,
    titleBarStyle: "hidden",
    title: "",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const rendererEntry = getRendererEntry();
  if (process.env.ELECTRON_START_URL) {
    mainWindow.loadURL(rendererEntry);
  } else {
    mainWindow.loadFile(rendererEntry);
  }
}

function getFfmpegPath() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  if (app.isPackaged) {
    const bundledPath = getBundledFfmpegPath();
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
  }

  try {
    const staticPath = require("ffmpeg-static");
    if (staticPath && fs.existsSync(staticPath)) {
      return staticPath;
    }
  } catch (error) {
    // Fall through to PATH lookup.
  }

  return "ffmpeg";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function parseDuration(stderr) {
  const match = stderr.match(/Duration:\s(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function parseTime(stderr) {
  const matches = [...stderr.matchAll(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
  const match = matches[matches.length - 1];
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function shouldSkipDirectory(inputPath) {
  return SKIPPED_DIRECTORIES.has(path.basename(inputPath));
}

function collectAudioFiles(inputPath, collected = []) {
  if (!inputPath) return collected;

  let stat;
  try {
    stat = fs.statSync(inputPath);
  } catch (error) {
    return collected;
  }

  if (stat.isDirectory()) {
    if (shouldSkipDirectory(inputPath)) return collected;

    let entries;
    try {
      entries = fs.readdirSync(inputPath);
    } catch (error) {
      return collected;
    }

    for (const entry of entries) {
      collectAudioFiles(path.join(inputPath, entry), collected);
    }
    return collected;
  }

  collected.push(inputPath);
  return collected;
}

function collectFiles(inputPath, collected = []) {
  if (!inputPath || !fs.existsSync(inputPath)) return collected;

  const stat = fs.statSync(inputPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(inputPath)) {
      collectFiles(path.join(inputPath, entry), collected);
    }
    return collected;
  }

  collected.push(inputPath);
  return collected;
}

function removeDirectoryQuietly(directory) {
  if (!directory) return;
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    // Best-effort cleanup only.
  }
}

function safeOutputName(inputPath, format) {
  const parsed = path.parse(inputPath);
  const cleaned = parsed.name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
  return `${cleaned || "converted"}.${format}`;
}

function uniqueOutputPath(outputDirectory, inputPath, format) {
  const parsed = path.parse(safeOutputName(inputPath, format));
  let candidate = path.join(outputDirectory, `${parsed.name}${parsed.ext}`);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDirectory, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }

  return candidate;
}

function classifyFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const exists = fs.existsSync(filePath);
  const stat = exists ? fs.statSync(filePath) : null;
  const baseJob = {
    id: `${filePath}-${Date.now()}-${Math.random()}`,
    path: filePath,
    name: path.basename(filePath),
    size: stat ? stat.size : 0,
    sizeLabel: stat ? formatBytes(stat.size) : "",
    progress: 0,
  };

  if (!exists) {
    return {
      ...baseJob,
      status: "blocked",
      message: "文件不存在或无法访问。",
    };
  }

  if (!ext) {
    return {
      ...baseJob,
      status: "blocked",
      message: "无法识别文件格式，请确认文件有有效扩展名。",
    };
  }

  if (PREPROCESS_INPUTS.has(ext)) {
    return {
      ...baseJob,
      status: "ready",
      requiresPreprocess: true,
      message: "需要先解锁为普通音频，再转码。",
    };
  }

  if (BLOCKED_ENCRYPTED_INPUTS.has(ext)) {
    return {
      ...baseJob,
      status: "blocked",
      message: "专有加密格式不支持转换。请使用你有权处理的未加密音频源文件。",
    };
  }

  if (!SUPPORTED_INPUTS.has(ext)) {
    return {
      ...baseJob,
      status: "blocked",
      message: "不支持的格式。支持 FLAC、WAV、M4A、AAC、OGG、OPUS、WMA、APE、AIFF、MP3。",
    };
  }

  return {
    ...baseJob,
    status: "ready",
    message: "",
  };
}

function classifyPaths(paths) {
  const uniquePaths = [...new Set(Array.isArray(paths) ? paths.filter(Boolean) : [])];
  const files = uniquePaths.flatMap((inputPath) => collectAudioFiles(inputPath));
  return files.map(classifyFile);
}

function emitJobUpdate(id, patch) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("conversion:update", { id, ...patch });
}

function getOutputArgs(format, bitrate) {
  if (format === "flac") return [...OUTPUT_PRESETS.flac, "8"];
  if (format === "wav") return OUTPUT_PRESETS.wav;
  const preset = OUTPUT_PRESETS[format] || OUTPUT_PRESETS.mp3;
  return [...preset, `${Number(bitrate) || 320}k`];
}

async function convertFile(job, options) {
  if (job.status === "blocked") return job;

  const outputFormat = OUTPUT_PRESETS[options.outputFormat] ? options.outputFormat : "mp3";
  const ffmpegPath = getFfmpegPath();
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const outputPath = uniqueOutputPath(options.outputDirectory, job.path, outputFormat);
  let inputPath = job.path;
  let tempDirectory = "";
  let stderr = "";
  let duration = null;
  let finalJob = job;

  try {
    if (PREPROCESS_INPUTS.has(path.extname(job.path).toLowerCase())) {
      const preprocessResult = await preprocessEncryptedFile(job);
      inputPath = preprocessResult.inputPath;
      tempDirectory = preprocessResult.tempDirectory;
    }
  } catch (error) {
    const wasCancelled = error.code === "CONVERSION_CANCELLED" || error.message === "已取消";
    const patch = {
      status: wasCancelled ? "cancelled" : "failed",
      progress: 0,
      message: error.message || "加密音频预处理失败。",
    };
    finalJob = { ...job, ...patch };
    emitJobUpdate(job.id, patch);
    removeDirectoryQuietly(tempDirectory);
    return finalJob;
  }

  emitJobUpdate(job.id, {
    status: "running",
    progress: 1,
    outputPath,
    message: "开始转码",
  });

  await new Promise((resolve) => {
    const args = [
      "-hide_banner",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-map_metadata",
      "0",
      "-id3v2_version",
      "3",
      ...getOutputArgs(outputFormat, options.bitrate),
      outputPath,
    ];

    const child = spawn(ffmpegPath, args, { windowsHide: true });
    runningJobs.set(job.id, child);

    child.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      duration = duration || parseDuration(stderr);
      const current = parseTime(chunk);

      if (duration && current !== null) {
        const progress = Math.max(1, Math.min(99, Math.round((current / duration) * 100)));
        emitJobUpdate(job.id, { progress, message: `转码中 ${progress}%` });
      }
    });

    child.on("error", (error) => {
      runningJobs.delete(job.id);
      const patch = {
        status: "failed",
        progress: 0,
        message:
          error.code === "ENOENT"
            ? "未找到 FFmpeg。请重新安装依赖，或设置 FFMPEG_PATH 指向 ffmpeg.exe。"
            : error.message,
      };
      finalJob = { ...job, ...patch };
      emitJobUpdate(job.id, patch);
      resolve();
    });

    child.on("close", (code) => {
      runningJobs.delete(job.id);

      if (code === 0) {
        const patch = {
          status: "done",
          progress: 100,
          outputPath,
          message: "完成",
        };
        finalJob = { ...job, ...patch };
        emitJobUpdate(job.id, patch);
        resolve();
        return;
      }

      const wasCancelled = cancellingJobs.has(job.id) || code === null || code === 255;
      cancellingJobs.delete(job.id);
      const patch = {
        status: wasCancelled ? "cancelled" : "failed",
        progress: 0,
        message: wasCancelled
          ? "已取消"
          : stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(" ") || "转码失败",
      };
      finalJob = { ...job, ...patch };
      emitJobUpdate(job.id, patch);
      resolve();
    });
  });

  removeDirectoryQuietly(tempDirectory);
  return finalJob;
}

function selectDecodedFile(tempDirectory) {
  const files = collectFiles(tempDirectory)
    .filter((filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      return SUPPORTED_INPUTS.has(ext) && !PREPROCESS_INPUTS.has(ext);
    })
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .filter((entry) => entry.stat.isFile() && entry.stat.size > 0)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || b.stat.size - a.stat.size);

  return files[0]?.filePath || "";
}

async function preprocessEncryptedFile(job) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "music-converter-"));

  emitJobUpdate(job.id, {
    status: "running",
    progress: 1,
    message: "正在解锁加密音频...",
  });

  const { decodedPath, preprocessor } = decodeWithPreprocessor(job.path, tempDirectory);

  if (!decodedPath) {
    removeDirectoryQuietly(tempDirectory);
    throw new Error(`${preprocessor.name} 未生成可转码的音频文件。`);
  }

  emitJobUpdate(job.id, {
    progress: 5,
    message: "解锁完成，正在转码...",
  });

  return { inputPath: decodedPath, tempDirectory };
}

ipcMain.handle("app:get-defaults", async () => ({
  outputDirectory: app.getPath("desktop"),
}));

ipcMain.handle("paths:classify", async (_event, paths) => {
  return classifyPaths(Array.isArray(paths) ? paths : []);
});

ipcMain.handle("window:minimize", async () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.handle("window:toggle-maximize", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle("window:hide", async () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
});

ipcMain.handle("window:close", async () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

ipcMain.handle("files:select", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择音频文件",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "音频文件",
        extensions: [
          "flac",
          "wav",
          "m4a",
          "aac",
          "ogg",
          "opus",
          "wma",
          "ape",
          "aiff",
          "mp3",
          "ncm",
          "kgg",
          "kgm",
          "kgma",
          "vpr",
          "kwm",
          "mflac",
        ],
      },
    ],
  });

  return result.canceled ? [] : classifyPaths(result.filePaths);
});

ipcMain.handle("folder:import", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择要导入的音乐文件夹",
    properties: ["openDirectory", "multiSelections"],
  });

  return result.canceled ? [] : classifyPaths(result.filePaths);
});

ipcMain.handle("folder:select-output", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择输出目录",
    properties: ["openDirectory", "createDirectory"],
  });

  return result.canceled ? "" : result.filePaths[0];
});

ipcMain.handle("conversion:start", async (_event, payload) => {
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const options = payload.options || {};

  if (!options.outputDirectory || !fs.existsSync(options.outputDirectory)) {
    try {
      fs.mkdirSync(options.outputDirectory, { recursive: true });
    } catch (error) {
      throw new Error("请选择有效的输出目录。");
    }
  }

  const results = [];
  for (const job of jobs) {
    results.push(await convertFile(job, options));
  }

  return results;
});

ipcMain.handle("conversion:cancel", async (_event, id) => {
  const child = runningJobs.get(id);
  if (child) {
    cancellingJobs.add(id);
    child.kill("SIGTERM");
    runningJobs.delete(id);
  }
  return true;
});

ipcMain.handle("shell:show-item", async (_event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  }
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  for (const [id, child] of runningJobs) {
    cancellingJobs.add(id);
    child.kill("SIGTERM");
  }
  runningJobs.clear();
});
