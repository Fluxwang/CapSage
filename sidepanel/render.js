// 页面内侧边栏的纯视图片段。侧边栏需要把 TikTok 页面向左挤开，因此它由
// content-tiktok.js 挂载到当前页面；这里保留可复用的列表 / 生成结果结构，
// 让完整工作区不再和数据捕获逻辑混在同一段模板里。

export function renderCaptionRows({ captions, translations, bilingual, currentCueIndex, escapeHtml }) {
  return captions.map((caption, index) => {
    const time = `${escapeHtml(caption.start)}-${escapeHtml(caption.end)}`;
    const translation = translations[index]
      ? `<p class="tcs-translation">${escapeHtml(translations[index])}</p>`
      : "";
    // 关掉双语时原文让位给译文；没有译文时原文仍然要留着，否则这一行就空了。
    const source = bilingual || !translations[index]
      ? `<p class="tcs-source">${escapeHtml(caption.text)}</p>`
      : "";
    const active = index === currentCueIndex ? " is-active" : "";
    return `<article class="tcs-row${active}" data-cue-index="${index}"><time>${time}</time><div>${source}${translation}</div></article>`;
  }).join("") || "<div class=\"tcs-placeholder\">点击「获取字幕」开始。</div>";
}

export function renderSummaryList({ output, loading, error, escapeHtml }) {
  if (loading) return "<p class=\"tcs-generating\">正在提炼视频要点…</p>";
  if (error) return `<div class="tcs-generation-error">${escapeHtml(error)}<button class="tcs-open-options" type="button">打开设置</button></div>`;
  if (!output) return "<p class=\"tcs-summary-placeholder\">点击「生成要点」后，这里会列出视频的核心信息。</p>";
  const items = output
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.、)]|[-•])\s*/, "").trim())
    .filter(Boolean);
  const list = items.length ? items : [output];
  // 设计稿的编号是独立的一列等宽强调色数字，不是 <ol> 的 marker——marker
  // 没法单独上色和对齐到那 62px 的槽里。
  const rows = list
    .map((item, index) => `<div class="tcs-summary-row"><span class="tcs-summary-index">${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(item)}</p></div>`)
    .join("");
  return `<div class="tcs-summary-list">${rows}</div>`;
}

export function renderRewriteOutput({ output, loading, error, escapeHtml }) {
  if (loading) return "<p class=\"tcs-generating\">正在生成仿写脚本…</p>";
  if (error) return `<div class="tcs-generation-error">${escapeHtml(error)}<button class="tcs-open-options" type="button">打开设置</button></div>`;
  if (!output) return "<p class=\"tcs-summary-placeholder\">选择时长和类型后生成一份全新的脚本。</p>";
  const paragraphs = output
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div class="tcs-rewrite-output">${paragraphs}</div>`;
}
