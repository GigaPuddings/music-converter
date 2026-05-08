import React from "react";
import "../styles.css";

export default function Titlebar() {
  return (
    <header className="titlebar">
      <div className="window-title">音乐格式转换</div>
      <div className="window-actions">
        {/* <button type="button" aria-label="隐藏窗口" onClick={() => window.musicConverter.hideWindow()}>
          隐藏
        </button> */}
        <button type="button" aria-label="最小化" onClick={() => window.musicConverter.minimizeWindow()}>
          <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10.5 24L38.5 24" stroke="#333" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button
          type="button"
          aria-label="最大化或还原"
          onClick={() => window.musicConverter.toggleMaximizeWindow()}
        >
          <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M39 6H9C7.34315 6 6 7.34315 6 9V39C6 40.6569 7.34315 42 9 42H39C40.6569 42 42 40.6569 42 39V9C42 7.34315 40.6569 6 39 6Z" fill="none" stroke="#333" stroke-width="4"/></svg>
        </button>
        <button type="button" aria-label="关闭" onClick={() => window.musicConverter.closeWindow()}>
          <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 8L40 40" stroke="#333" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 40L40 8" stroke="#333" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </header>
  );
}
