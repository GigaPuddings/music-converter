import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Titlebar from "./components/titlebar";

const STATUS_LABELS = {
  ready: "待转换",
  blocked: "不支持",
  running: "转换中",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const BITRATES = [128, 192, 256, 320];
const OUTPUT_FORMATS = ["mp3", "flac", "wav", "m4a", "ogg"];
const SUPPORTED_INPUT_FORMATS = [
  "MP3",
  "FLAC",
  "WAV",
  "M4A",
  "AAC",
  "OGG",
  "NCM",
  "OPUS",
  "WMA",
  "APE",
  "AIFF",
  "ALAC",
  "WEBM",
];
const PREPROCESS_FORMATS = ["NCM", "KGG", "KGM", "KGMA", "VPR"];
const TERMINAL_STATUSES = new Set(["done", "failed", "cancelled"]);

function getBatchJobProgress(job) {
  if (!job) return 0;
  if (TERMINAL_STATUSES.has(job.status)) return 100;
  return Math.max(0, Math.min(100, Number(job.progress) || 0));
}

function mergeJobs(existing, incoming) {
  const seen = new Set(existing.map((job) => job.path));
  return [...existing, ...incoming.filter((job) => !seen.has(job.path))];
}

function countNewJobs(existing, incoming) {
  const seen = new Set(existing.map((job) => job.path));
  return incoming.filter((job) => !seen.has(job.path)).length;
}

function getReadyJobs(jobs) {
  return jobs.filter((job) => job.status === "ready");
}

function App() {
  const [jobs, setJobs] = useState([]);
  const [outputDirectory, setOutputDirectory] = useState("");
  const [outputFormat, setOutputFormat] = useState("mp3");
  const [bitrate, setBitrate] = useState(320);
  const [autoConvert, setAutoConvert] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeBatch, setActiveBatch] = useState({ ids: [], total: 0 });
  const conversionRef = useRef(false);

  useEffect(() => {
    if (!window.musicConverter) return undefined;

    window.musicConverter.getDefaults().then((defaults) => {
      if (defaults?.outputDirectory) setOutputDirectory(defaults.outputDirectory);
    });

    const removeConversionListener = window.musicConverter.onConversionUpdate((update) => {
      setJobs((current) =>
        current.map((job) => (job.id === update.id ? { ...job, ...update } : job)),
      );
    });

    return () => removeConversionListener?.();
  }, []);

  const startConversion = useCallback(
    async (jobSource = jobs) => {
      const readyJobs = getReadyJobs(jobSource);
      if (!readyJobs.length) {
        setNotice("没有可转换的文件。");
        return;
      }

      if (!outputDirectory) {
        setNotice("请先选择输出目录。");
        return;
      }

      if (conversionRef.current) return;

      const confirmed = window.confirm(
        `确认开始转换 ${readyJobs.length} 个文件为 ${outputFormat.toUpperCase()} 吗？`,
      );
      if (!confirmed) return;

      conversionRef.current = true;
      setIsConverting(true);
      setActiveBatch({ ids: readyJobs.map((job) => job.id), total: readyJobs.length });
      setNotice("");

      try {
        const results = await window.musicConverter.startConversion({
          jobs: readyJobs,
          options: { outputDirectory, outputFormat, bitrate },
        });

        if (Array.isArray(results)) {
          setJobs((current) =>
            current.map((job) => results.find((result) => result.id === job.id) || job),
          );

          const done = results.filter((job) => job.status === "done").length;
          const failed = results.filter((job) => job.status === "failed").length;
          const cancelled = results.filter((job) => job.status === "cancelled").length;
          setNotice(`转换结束：${done} 个完成，${failed} 个失败，${cancelled} 个取消。`);
        }
      } catch (error) {
        setNotice(error.message || "启动转换失败。");
      } finally {
        conversionRef.current = false;
        setIsConverting(false);
      }
    },
    [bitrate, jobs, outputDirectory, outputFormat],
  );

  const addJobs = useCallback(
    (incoming) => {
      if (!incoming.length) {
        setNotice("没有发现可导入的音频文件。");
        return;
      }

      let nextJobs = [];
      let addedCount = 0;
      setJobs((current) => {
        addedCount = countNewJobs(current, incoming);
        nextJobs = mergeJobs(current, incoming);
        return nextJobs;
      });

      if (addedCount === 0) {
        setNotice("这些文件已经在队列中。");
      } else {
        const blocked = incoming.filter((job) => job.status === "blocked").length;
        setNotice(
          `已添加 ${addedCount} 个文件${blocked ? `，其中 ${blocked} 个不可转换` : ""}。`,
        );
      }

      const readyIncoming = incoming.filter((job) => job.status === "ready");
      if (autoConvert && readyIncoming.length) {
        setTimeout(() => startConversion(nextJobs), 0);
      }
    },
    [autoConvert, startConversion],
  );

  useEffect(() => {
    if (!window.musicConverter?.onDroppedPaths) return undefined;

    return window.musicConverter.onDroppedPaths(async (paths) => {
      setIsDragging(false);
      setNotice("");

      if (!paths.length) {
        setNotice("没有读取到拖拽路径，请改用选择文件或导入文件夹。");
        return;
      }

      try {
        addJobs(await window.musicConverter.classifyPaths(paths));
      } catch (error) {
        setNotice(error.message || "读取拖拽文件失败。");
      }
    });
  }, [addJobs]);

  const stats = useMemo(() => {
    const total = jobs.length;
    const convertible = jobs.filter((job) => job.status !== "blocked").length;
    const done = jobs.filter((job) => job.status === "done").length;
    const failed = jobs.filter((job) => job.status === "failed").length;
    const cancelled = jobs.filter((job) => job.status === "cancelled").length;
    const running = jobs.filter((job) => job.status === "running").length;
    const pending = jobs.filter((job) => job.status === "ready").length;
    return { total, convertible, done, failed, cancelled, running, pending };
  }, [jobs]);

  const batchProgress = useMemo(() => {
    const batchJobs = activeBatch.ids
      .map((id) => jobs.find((job) => job.id === id))
      .filter(Boolean);

    if (!batchJobs.length) {
      return {
        percent: 0,
        processed: 0,
        total: activeBatch.total,
        runningName: "",
        visible: false,
      };
    }

    const total = activeBatch.total || batchJobs.length;
    const processed = batchJobs.filter((job) => TERMINAL_STATUSES.has(job.status)).length;
    const percent = Math.round(
      batchJobs.reduce((sum, job) => sum + getBatchJobProgress(job), 0) / total,
    );
    const runningName = batchJobs.find((job) => job.status === "running")?.name || "";

    return {
      percent: Math.max(0, Math.min(100, percent)),
      processed,
      total,
      runningName,
      visible: isConverting || processed > 0,
    };
  }, [activeBatch, isConverting, jobs]);

  async function chooseFiles() {
    setNotice("");
    try {
      addJobs(await window.musicConverter.selectFiles());
    } catch (error) {
      setNotice(error.message || "选择文件失败。");
    }
  }

  async function importFolder() {
    setNotice("");
    try {
      addJobs(await window.musicConverter.importFolder());
    } catch (error) {
      setNotice(error.message || "导入文件夹失败。");
    }
  }

  async function chooseOutputDirectory() {
    try {
      const selected = await window.musicConverter.selectOutputFolder();
      if (selected) setOutputDirectory(selected);
    } catch (error) {
      setNotice(error.message || "选择输出目录失败。");
    }
  }

  async function cancelRunning() {
    const running = jobs.find((job) => job.status === "running");
    if (running) {
      await window.musicConverter.cancelConversion(running.id);
      setNotice("正在取消当前任务。");
    }
  }

  function clearCompleted() {
    setJobs((current) => current.filter((job) => job.status !== "done"));
  }

  function clearQueue() {
    if (isConverting) {
      setNotice("转换进行中，请先取消当前任务，或者等待完成后再清空队列。");
      return;
    }
    setJobs([]);
    setActiveBatch({ ids: [], total: 0 });
    setNotice("");
  }

  function removeJob(id) {
    setJobs((current) => current.filter((job) => job.id !== id));
  }

  async function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    setNotice("");

    try {
      const paths =
        (await window.musicConverter.getDroppedPaths?.(event.dataTransfer.files)) ||
        Array.from(event.dataTransfer.files || [])
          .map((file) => file.path)
          .filter(Boolean);

      if (!paths.length) {
        setNotice("没有读取到拖拽路径，请改用选择文件或导入文件夹。");
        return;
      }

      addJobs(await window.musicConverter.classifyPaths(paths));
    } catch (error) {
      setNotice(error.message || "读取拖拽文件失败。");
    }
  }

  return (
    <main
      className={`app-shell ${isDragging ? "dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <Titlebar />

      <div className="content-shell">
        <section className="workspace">
          <header className="topbar">
            <div>
              <p className="eyebrow">Local Audio Tool</p>
              <h1>音乐格式转换</h1>
            </div>
            <div className="top-actions">
              <button className="secondary" type="button" onClick={chooseOutputDirectory}>
                输出位置
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => startConversion()}
                disabled={isConverting}
              >
                开始转换
              </button>
            </div>
          </header>

          <section className="drop-zone">
            <div>
              <h2>拖拽音乐文件或文件夹到这里</h2>
              <p>支持批量导入；下方会显示单文件进度和本次转换总进度。</p>
            </div>
            <div className="drop-actions">
              <button type="button" onClick={chooseFiles}>
                选择文件
              </button>
              <button type="button" onClick={importFolder}>
                导入文件夹
              </button>
            </div>
          </section>

          {/* <section className="format-strip" aria-label="支持格式">
            <div>
              <span>输入支持</span>
              <strong>{SUPPORTED_INPUT_FORMATS.join(" / ")}</strong>
            </div>
            <div>
              <span>可预处理</span>
              <strong>{PREPROCESS_FORMATS.join(" / ")}</strong>
            </div>
            <div>
              <span>输出格式</span>
              <strong>{OUTPUT_FORMATS.map((format) => format.toUpperCase()).join(" / ")}</strong>
            </div>
          </section> */}

          <section className="controls">
            <label>
              输出目录
              <input value={outputDirectory || "桌面"} readOnly />
            </label>
            <label>
              输出格式
              <select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value)}>
                {OUTPUT_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              码率
              <select
                value={bitrate}
                onChange={(event) => setBitrate(Number(event.target.value))}
                disabled={outputFormat === "flac" || outputFormat === "wav"}
              >
                {BITRATES.map((value) => (
                  <option key={value} value={value}>
                    {value} kbps
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={autoConvert}
                onChange={(event) => setAutoConvert(event.target.checked)}
              />
              自动转换
            </label>
            <button className="secondary" type="button" onClick={cancelRunning} disabled={!isConverting}>
              取消当前
            </button>
          </section>

          {notice ? <p className="notice">{notice}</p> : null}

          {batchProgress.visible ? (
            <section className="overall-progress" aria-label="批量转换总进度">
              <div className="overall-progress__header">
                <div>
                  <span>总进度</span>
                  <strong>{batchProgress.percent}%</strong>
                </div>
                <p>
                  已处理 {batchProgress.processed} / {batchProgress.total} 个
                  {batchProgress.runningName ? `，当前：${batchProgress.runningName}` : ""}
                </p>
              </div>
              <div className="progress-track total">
                <div style={{ width: `${batchProgress.percent}%` }} />
              </div>
            </section>
          ) : null}

          <section className="queue">
            <div className="queue-header">
              <div className="queue-title">
                <h2>转换队列</h2>
                <p>
                  {stats.total} 个文件，{stats.convertible} 个可转换，{stats.running} 个处理中，
                  {stats.pending} 个等待，{stats.done} 个完成，{stats.failed} 个失败，{stats.cancelled} 个取消。
                </p>
              </div>
              <div className="queue-actions">
                <button className="ghost" type="button" onClick={clearCompleted} disabled={!stats.done || isConverting}>
                  清理完成项
                </button>
                <button className="secondary" type="button" onClick={clearQueue} disabled={!jobs.length || isConverting}>
                  清空队列
                </button>
              </div>
            </div>

            {jobs.length === 0 ? (
              <div className="empty-state">队列为空，拖拽文件或导入文件夹开始。</div>
            ) : (
              <div className="job-list">
                {jobs.map((job) => (
                  <article className={`job ${job.status}`} key={job.id}>
                    <div className="job-main">
                      <div className="job-info">
                        <h3>{job.name}</h3>
                        <p>{job.path}</p>
                      </div>
                      <span>{STATUS_LABELS[job.status] || job.status}</span>
                    </div>
                    <div className="progress-track">
                      <div style={{ width: `${job.progress || 0}%` }} />
                    </div>
                    <div className="job-footer">
                      <p>{job.message || job.sizeLabel || "等待处理"}</p>
                      <div className="job-actions">
                        {job.outputPath && job.status === "done" ? (
                          <button type="button" onClick={() => window.musicConverter.showItem(job.outputPath)}>
                            定位
                          </button>
                        ) : null}
                        <button type="button" onClick={() => removeJob(job.id)} disabled={job.status === "running"}>
                          移除
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>

        <aside className="side-panel">
          <h2>应用设置</h2>
          <p>默认输出到桌面，也可以手动指定保存位置。批量转换会按队列顺序执行，窗口会实时刷新当前任务与总进度。</p>
          <div className="side-card">
            <strong>支持转换</strong>
            <span>{SUPPORTED_INPUT_FORMATS.join("、")} 可转为 {OUTPUT_FORMATS.map((format) => format.toUpperCase()).join("、")}。</span>
          </div>
          <div className="source-note">
            <strong>处理边界</strong>
            <span>
              本应用仅处理你有权转换的本地未加密音频文件，不包含任何解密或规避访问控制的逻辑。
            </span>
          </div>
        </aside>
      </div>
    </main>
  );
}

export default App;
