let songs = [];

const state = {
  route: "list",
  songId: null,
  sort: "release-desc",
  showKana: true,
  showCallKana: true,
  showCallRomaji: false,
  layout: "split",
  mediaId: null,
  audioOnly: false,
  manualTime: 0,
  openDropdown: null
};

const app = document.querySelector("#app");

async function loadSongs() {
  const indexRes = await fetch("./songs/index.json");
  const index = await indexRes.json();

  const list = await Promise.all(
    index.songs.map(async (file) => {
      try {
        const res = await fetch(`./songs/${file}`);
        return await res.json();
      } catch (e) {
        console.error("加载失败:", file, e);
        return null;
      }
    })
  );

  songs = list.filter(Boolean);
}

function setRoute(route, songId = null) {
  state.route = route;
  state.songId = songId;
  state.mediaId = null;
  state.manualTime = 0;
  render();
}

function getCurrentSong() {
  return songs.find((song) => song.id === state.songId) || songs[0];
}

function getCurrentMedia(song) {
  return (
    song.media.items.find((item) => item.id === state.mediaId) ||
    song.media.items.find((item) => item.id === song.media.defaultVersion) ||
    song.media.items[0]
  );
}

function sortSongs(items) {
  const sorted = [...items];
  const collator = new Intl.Collator(["ja", "zh-Hans", "en"], {
    sensitivity: "base",
    numeric: true
  });

  if (state.sort === "release-asc") {
    return sorted.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  }

  if (state.sort === "release-desc") {
    return sorted.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  }

  if (state.sort === "title-asc") {
    return sorted.sort((a, b) => collator.compare(a.titleKana, b.titleKana));
  }

  return sorted.sort((a, b) => collator.compare(b.titleKana, a.titleKana));
}

function formatDate(dateString) {
  return dateString.replaceAll("-", ".");
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const rest = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function activeLyricIndex(song, media) {
  if (!song || !media || media.syncMode === "detached") {
    return -1;
  }

  const lyricTime = state.manualTime - (media.timeOffset || 0);
  return song.lyrics.findIndex((line) => lyricTime >= line.start && lyricTime < line.end);
}

function embedUrl(media) {
  if (media.provider === "bilibili") {
    const params = new URLSearchParams({
      bvid: media.bvid,
      page: "1",
      autoplay: "0",
      t: String(media.videoStart ?? media.timeOffset ?? 0)
    });

    return `https://player.bilibili.com/player.html?${params.toString()}`;
  }

  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    enablejsapi: "0"
  });

  if (media.si) {
    params.set("si", media.si);
  }

  const start = media.videoStart ?? media.timeOffset;
  if (start) {
    params.set("start", String(Math.floor(start)));
  }

  return `https://www.youtube.com/embed/${media.youtubeId}?${params.toString()}`;
}

function customSelect(control, label, options, value) {
  const selected = options.find((option) => option.value === value) || options[0];
  return `
    <div class="select-menu ${state.openDropdown === control ? "open" : ""}">
      <button class="select-trigger" type="button" data-dropdown="${control}" aria-label="${label}">
        <span>${selected.label}</span>
        <span class="select-arrow">⌄</span>
      </button>
      <div class="select-options" role="listbox">
        ${options
          .map(
            (option) => `
              <button
                class="select-option ${option.value === value ? "selected" : ""}"
                type="button"
                data-select-control="${control}"
                data-select-value="${option.value}"
              >${option.label}</button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function switchControl(toggle, label, active) {
  return `
    <button class="toggle-chip ${active ? "on" : ""}" type="button" data-toggle="${toggle}" aria-pressed="${active}">
      <span class="toggle-dot"></span>
      <span>${label}</span>
    </button>
  `;
}

function stripPunctuation(text) {
  return String(text || "").replace(
    /[！？!?、。，,.\s　「」『』（）()【】\[\]…・×]/g,
    ""
  );
}

function renderSegments(segments) {
  return segments
    .map((seg) => {
      const kana = seg.type === "kanji" && seg.kana ? ` data-kana="${seg.kana}"` : "";
      const romaji = seg.type !== "latin" && seg.romaji ? ` data-romaji="${seg.romaji}"` : "";
      const compact = seg.compact ? ` data-compact="true"` : "";
      return `<span class="seg" data-type="${seg.type}"${kana}${romaji}${compact}>${seg.text}</span>`;
    })
    .join("");
}

function renderCallSegments(call) {
  return call.segments
    .map((seg) => {
      const kana = seg.type === "kanji" && seg.kana ? ` data-kana="${seg.kana}"` : "";
      const romaji = seg.type !== "latin" && seg.romaji ? ` data-romaji="${seg.romaji}"` : "";
      const compact = seg.compact ? ` data-compact="true"` : "";
      return `<span class="seg" data-type="${seg.type}"${kana}${romaji}${compact}>${seg.text}</span>`;
    })
    .join("");
}

function callBlock(line) {
  if (!line.calls || !line.calls.length) {
    return "";
  }

  return `
    <div class="line-calls">
      ${line.calls
        .map(
          (call) => `
            <div class="line-call" data-align="${call.align || "start"}" data-offset="${call.offset || 0}">
              <div class="call-main">${renderCallSegments(call)}</div>
              <div class="call-kana-layer"></div>
              <div class="call-romaji-layer"></div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

/* 歌词模式专用：把整行所有 call 扁平渲染成 \\call// 形式，一行内并排 */
function renderFlowCalls(line) {
  if (!line.calls || !line.calls.length) {
    return "";
  }

  return `
    <div class="flow-calls">
      ${line.calls
        .map(
          (call) => `
            <span class="flow-call">
              <span class="call-bracket">\\\\</span><span class="call-main">${renderCallSegments(call)}</span><span class="call-bracket">//</span>
              <span class="call-kana-layer"></span>
              <span class="call-romaji-layer"></span>
            </span>
          `
        )
        .join("")}
    </div>
  `;
}

function renderShell(inner) {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">CALL</div>
          <div>
            <h1>BUDDiiS <span class="dot">•</span> CALL LECTURE</h1>
            <p>静态托管 MVP · 歌词、Call 词与视频备注</p>
          </div>
        </div>
        <div class="nav-actions">
          <button class="button ${state.route === "list" ? "primary" : ""}" data-action="home">歌曲列表</button>
          <button class="button" data-action="format">文件格式示例</button>
        </div>
      </header>
      <main class="content">${inner}</main>
    </div>
  `;
}

function renderList() {
  const items = sortSongs(songs.filter((song) => song.hasCall));
  renderShell(`
    <section class="toolbar">
      <div>
        <strong>歌曲列表</strong>
        <span class="song-meta">${items.length} 首有 Call 词的歌曲</span>
      </div>
      <div class="toolbar-group">
        ${customSelect("sort", "歌曲排序", [
          { value: "release-desc", label: "发售时间 · 新到旧" },
          { value: "release-asc", label: "发售时间 · 旧到新" },
          { value: "title-asc", label: "曲名首字母 · A-Z" },
          { value: "title-desc", label: "曲名首字母 · Z-A" }
        ], state.sort)}
      </div>
    </section>
    <section class="song-list">
      ${items
        .map(
          (song) => `
            <button class="song-row" type="button" data-action="open-song" data-song-id="${song.id}">
              <h2>${song.title}</h2>
              <span class="song-date">${formatDate(song.releaseDate)}</span>
              <span class="song-tag">${song.media.items.length} 个视频版本</span>
              <span class="song-excerpt">${song.preview.lyricExcerpt}</span>
            </button>
          `
        )
        .join("")}
    </section>
  `);
}

function layoutAnnotations() {
  document.querySelectorAll(".line").forEach((line) => {
    const content = line.querySelector(".lyric-content");
    if (!content) return;

    const kanaLayer = content.querySelector(".lyric-kana-layer");
    const romajiLayer = content.querySelector(".lyric-romaji-layer");
    if (!kanaLayer || !romajiLayer) return;

    kanaLayer.innerHTML = "";
    romajiLayer.innerHTML = "";

    const contentRect = content.getBoundingClientRect();

    content.querySelectorAll(".lyric-main .seg").forEach((seg) => {
      const rect = seg.getBoundingClientRect();

      if (state.showKana && seg.dataset.kana) {
        const kanaText = stripPunctuation(seg.dataset.kana);
        if (kanaText) {
          const el = document.createElement("div");
          el.className = "kana-mark";
          if (seg.dataset.compact === "true") {
            el.classList.add("compact");
          }
          el.textContent = kanaText;
          const centerX = rect.left - contentRect.left + rect.width / 2;
          el.style.left = `${centerX}px`;
          el.style.top = `${rect.top - contentRect.top - 14}px`;
          kanaLayer.appendChild(el);
        }
      }
    });

    content.querySelectorAll(".line-call").forEach((call) => {
      const callKanaLayer = call.querySelector(".call-kana-layer");
      const callRomajiLayer = call.querySelector(".call-romaji-layer");
      if (!callKanaLayer || !callRomajiLayer) return;

      callKanaLayer.innerHTML = "";
      callRomajiLayer.innerHTML = "";

      const callRect = call.getBoundingClientRect();

      call.querySelectorAll(".call-main .seg").forEach((seg) => {
        const rect = seg.getBoundingClientRect();

        if (state.showCallKana && seg.dataset.kana) {
          const kanaText = stripPunctuation(seg.dataset.kana);
          if (kanaText) {
            const el = document.createElement("div");
            el.className = "kana-mark";
            if (seg.dataset.compact === "true") {
              el.classList.add("compact");
            }
            el.textContent = kanaText;
            const centerX = rect.left - callRect.left + rect.width / 2;
            el.style.left = `${centerX}px`;
            el.style.top = `${rect.top - callRect.top - 16}px`;
            callKanaLayer.appendChild(el);
          }
        }

        if (state.showCallRomaji && seg.dataset.romaji) {
          const romajiText = stripPunctuation(seg.dataset.romaji);
          if (romajiText) {
            const el = document.createElement("div");
            el.className = "romaji-mark";
            if (seg.dataset.compact === "true") {
              el.classList.add("compact");
            }
            el.textContent = romajiText;
            const centerX = rect.left - callRect.left + rect.width / 2;
            el.style.left = `${centerX}px`;
            el.style.top = `${rect.bottom - callRect.top + 2}px`;
            callRomajiLayer.appendChild(el);
          }
        }
      });
    });
  });
}

/* 歌词模式专用注音排版：作用于 .flow-line 结构 */
function layoutFlowAnnotations() {
  document.querySelectorAll(".flow-line").forEach((line) => {
    const content = line.querySelector(".lyric-content");
    if (!content) return;

    const kanaLayer = content.querySelector(".lyric-kana-layer");
    const romajiLayer = content.querySelector(".lyric-romaji-layer");
    if (!kanaLayer || !romajiLayer) return;

    kanaLayer.innerHTML = "";
    romajiLayer.innerHTML = "";

    const contentRect = content.getBoundingClientRect();

    content.querySelectorAll(".lyric-main .seg").forEach((seg) => {
      const rect = seg.getBoundingClientRect();

      if (state.showKana && seg.dataset.kana) {
        const kanaText = stripPunctuation(seg.dataset.kana);
        if (kanaText) {
          const el = document.createElement("div");
          el.className = "kana-mark";
          if (seg.dataset.compact === "true") {
            el.classList.add("compact");
          }
          el.textContent = kanaText;
          const centerX = rect.left - contentRect.left + rect.width / 2;
          el.style.left = `${centerX}px`;
          el.style.top = `${rect.top - contentRect.top - 14}px`;
          kanaLayer.appendChild(el);
        }
      }
    });

    content.querySelectorAll(".flow-call").forEach((call) => {
      const callKanaLayer = call.querySelector(".call-kana-layer");
      const callRomajiLayer = call.querySelector(".call-romaji-layer");
      if (!callKanaLayer || !callRomajiLayer) return;

      callKanaLayer.innerHTML = "";
      callRomajiLayer.innerHTML = "";

      const callRect = call.getBoundingClientRect();

      call.querySelectorAll(".call-main .seg").forEach((seg) => {
        const rect = seg.getBoundingClientRect();

        if (state.showCallKana && seg.dataset.kana) {
          const kanaText = stripPunctuation(seg.dataset.kana);
          if (kanaText) {
            const el = document.createElement("div");
            el.className = "kana-mark";
            if (seg.dataset.compact === "true") {
              el.classList.add("compact");
            }
            el.textContent = kanaText;
            const centerX = rect.left - callRect.left + rect.width / 2;
            el.style.left = `${centerX}px`;
            el.style.top = `${rect.top - callRect.top - 14}px`;
            callKanaLayer.appendChild(el);
          }
        }

        if (state.showCallRomaji && seg.dataset.romaji) {
          const romajiText = stripPunctuation(seg.dataset.romaji);
          if (romajiText) {
            const el = document.createElement("div");
            el.className = "romaji-mark";
            if (seg.dataset.compact === "true") {
              el.classList.add("compact");
            }
            el.textContent = romajiText;
            const centerX = rect.left - callRect.left + rect.width / 2;
            el.style.left = `${centerX}px`;
            el.style.top = `${rect.bottom - callRect.top + 2}px`;
            callRomajiLayer.appendChild(el);
          }
        }
      });
    });
  });
}

function layoutCalls() {
  document.querySelectorAll(".line").forEach((line) => {
    const content = line.querySelector(".lyric-content");
    const main = line.querySelector(".lyric-main");
    if (!content || !main) return;

    const segs = [...main.querySelectorAll(".seg")];
    const calls = content.querySelectorAll(".line-call");
    if (!segs.length) return;

    const mainRect = main.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();

    calls.forEach((call) => {
      const align = call.dataset.align || "start";
      const offset = Number(call.dataset.offset || 0);

      let target = null;
      if (align === "end") {
        target = segs[segs.length - 1];
      } else {
        target = segs[offset] || segs[0];
      }
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const x = (align === "end" ? rect.right : rect.left) - contentRect.left;
      const y = mainRect.bottom - contentRect.top + 9;

      call.style.left = `${x}px`;
      call.style.top = `${y}px`;
      call.style.transform = "none";
    });
  });
}

function renderDetail() {
  const song = getCurrentSong();
  if (!song) {
    renderShell(`<section class="format-note"><h3>没有可显示的歌曲</h3></section>`);
    return;
  }

  const media = getCurrentMedia(song);
  const currentIndex = activeLyricIndex(song, media);
  const detached = media.syncMode === "detached";
  const lyricsMode = state.layout === "lyrics";
  const maxTime = Math.max(...song.lyrics.map((line) => line.end), 60);
  const gridClass =
    state.layout === "video" ? "video-focus" : "";

  renderShell(`
    <section class="detail-head">
      <div>
        <h2>${song.title}</h2>
        <p>${song.releaseDate} · ${media.label}${detached ? " · 练习版不关联时间轴" : ""}</p>
      </div>
      <div class="detail-head-side">
        <div class="mode-switch">
          <button class="mode-btn ${state.layout === "split" ? "active" : ""}" data-layout="split">双屏</button>
          <button class="mode-btn ${state.layout === "lyrics" ? "active" : ""}" data-layout="lyrics">歌词模式</button>
          <button class="mode-btn ${state.layout === "video" ? "active" : ""}" data-layout="video">视频放大</button>
        </div>
        ${
          lyricsMode
            ? `<div class="lyrics-tools lyrics-tools-inline">
                 ${switchControl("kana", "歌词假名", state.showKana)}
                 ${switchControl("call-kana", "Call假名", state.showCallKana)}
                 ${switchControl("call-romaji", "Call罗马音", state.showCallRomaji)}
               </div>`
            : ""
        }
      </div>
    </section>

    ${
      lyricsMode
        ? `
          <section class="lyrics-flow">
            <div class="lyrics-flow-scroll">
              ${song.lyrics
                .map(
                  (line) => `
                    <div class="flow-line">
                      <div class="lyric-content">
                        <div class="lyric-main">${renderSegments(line.ja.segments)}</div>
                        <div class="lyric-kana-layer"></div>
                        <div class="lyric-romaji-layer"></div>
                        ${renderFlowCalls(line)}
                      </div>
                    </div>
                  `
                )
                .join("")}
            </div>
          </section>
        `
        : `
          <section class="detail-grid ${gridClass}">
            <article class="panel lyrics-panel">
              <div class="panel-head">
                <h3>歌词 / Call</h3>
                <div class="lyrics-tools">
                  ${switchControl("kana", "歌词假名", state.showKana)}
                  ${switchControl("call-kana", "Call假名", state.showCallKana)}
                  ${switchControl("call-romaji", "Call罗马音", state.showCallRomaji)}
                </div>
              </div>
              <div class="lyrics-and-calls">
                <div class="lyrics-scroll" id="lyrics-scroll">
                  ${song.lyrics
                    .map(
                      (line, index) => `
                        <div class="line ${index === currentIndex ? "active" : ""}" data-line-index="${index}">
                          <div class="time">${formatTime(line.start)}</div>
                          <div class="lyric-content">
                            <div class="lyric-main">${renderSegments(line.ja.segments)}</div>
                            <div class="lyric-kana-layer"></div>
                            <div class="lyric-romaji-layer"></div>
                            ${callBlock(line)}
                          </div>
                        </div>
                      `
                    )
                    .join("")}
                </div>
              </div>
            </article>

            <aside class="panel video-panel">
              <div class="panel-head">
                <h3>视频</h3>
                ${customSelect(
                  "media",
                  "视频版本",
                  song.media.items.map((item) => ({ value: item.id, label: item.label })),
                  media.id
                )}
              </div>
              <div class="player-frame">
                <iframe
                  src="${embedUrl(media)}"
                  title="${song.title} ${media.label}"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowfullscreen
                  referrerpolicy="strict-origin-when-cross-origin"
                ></iframe>
                <div class="audio-cover ${state.audioOnly ? "" : "hidden"}">
                  <div>
                    <h3>${song.title}</h3>
                    <p>${media.label} · 音频模式</p>
                  </div>
                </div>
              </div>
              <div class="video-meta">
                <button class="chip ${state.audioOnly ? "active" : ""}" data-toggle="audio">音频模式</button>
                <p>${media.note}</p>
              </div>
              <div class="manual-clock ${detached ? "hidden" : ""}">
                <strong>手动同步时间轴</strong>
                <div class="range-row">
                  <input type="range" min="0" max="${maxTime}" step="0.1" value="${state.manualTime}" data-control="manual-time" />
                  <span>${formatTime(state.manualTime)}</span>
                </div>
                <p class="song-meta">外嵌视频第一版不读取播放时间；拖动这里模拟歌词进度。后续可接 YouTube / Bilibili API 做真实同步。</p>
              </div>
            </aside>
          </section>
        `
    }
  `);

  requestAnimationFrame(() => {
    if (lyricsMode) {
      layoutFlowAnnotations();
      return;
    }

    layoutAnnotations();
    layoutCalls();

    const active = document.querySelector(".line.active");
    const scroller = document.querySelector("#lyrics-scroll");
    if (active && scroller) {
      active.scrollIntoView({ block: "center" });
    }
  });
}

function renderFormat() {
  renderShell(`
    <section class="format-note">
      <h3>推荐文件格式示例</h3>
      <p>歌曲数据按文件拆分为 songs/ 目录下的 JSON。songs/index.json 只维护文件名列表，新增歌曲不用改 app.js。</p>
      <pre>songs/index.json
{
  "songs": [
    "kimi-wa-toshi-densetsu.json"
  ]
}

songs/kimi-wa-toshi-densetsu.json
{
  "id": "kimi-wa-toshi-densetsu",
  "title": "キミは都市伝説",
  "titleKana": "きみはとしでんせつ",
  "releaseDate": "2026-07-08",
  "hasCall": true,
  "preview": {
    "lyricExcerpt": "Love還元",
    "note": ""
  },
  "lyrics": [
    {
      "start": 20.72,
      "end": 23.914,
      "ja": {
        "text": "キミとすれ違った路地裏",
        "segments": [
          { "text": "キミ", "type": "kana", "romaji": "kimi" },
          { "text": "と", "type": "kana", "romaji": "to" },
          { "text": "すれ違", "type": "kanji", "kana": "すれちが", "romaji": "surechiga" },
          { "text": "った", "type": "kana", "romaji": "tta" },
          { "text": "路地裏", "type": "kanji", "kana": "ろじうら", "romaji": "rojiura" }
        ]
      },
      "translations": {},
      "calls": [
        {
          "text": "運命っ！",
          "align": "end",
          "segments": [
            { "text": "運命", "type": "kanji", "kana": "うんめい", "romaji": "unmei" },
            { "text": "っ！", "type": "kana", "romaji": "!" }
          ]
        }
      ]
    }
  ],
  "media": {
    "defaultVersion": "practice",
    "items": [
      {
        "id": "practice",
        "label": "Live练习",
        "provider": "bilibili",
        "bvid": "BV1gBgs6SEqN",
        "syncMode": "manual",
        "videoStart": 177,
        "timeOffset": 188,
        "audioOnly": true,
        "note": "Bilibili 视频从 2:57 开始，第一句歌词在 3:08"
      }
    ]
  }
}</pre>
    </section>
  `);
}

function render() {
  if (state.route === "detail") {
    renderDetail();
    return;
  }

  if (state.route === "format") {
    renderFormat();
    return;
  }

  renderList();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) {
    return;
  }

  if (target.dataset.action === "home") {
    setRoute("list");
  }

  if (target.dataset.action === "format") {
    setRoute("format");
  }

  if (target.dataset.action === "open-song") {
    setRoute("detail", target.dataset.songId);
  }

  if (target.dataset.layout) {
    state.layout = target.dataset.layout;
    render();
  }

  if (target.dataset.dropdown) {
    state.openDropdown =
      state.openDropdown === target.dataset.dropdown ? null : target.dataset.dropdown;
    render();
  }

  if (target.dataset.selectControl) {
    const control = target.dataset.selectControl;
    const value = target.dataset.selectValue;
    state.openDropdown = null;

    if (control === "sort") {
      state.sort = value;
    }

    if (control === "media") {
      state.mediaId = value;
      state.manualTime = 0;
    }

    render();
  }

  if (target.dataset.toggle === "kana") {
    state.showKana = !state.showKana;
    render();
  }

  if (target.dataset.toggle === "call-kana") {
    state.showCallKana = !state.showCallKana;
    render();
  }

  if (target.dataset.toggle === "call-romaji") {
    state.showCallRomaji = !state.showCallRomaji;
    render();
  }

  if (target.dataset.toggle === "audio") {
    state.audioOnly = !state.audioOnly;
    render();
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;

  if (target.dataset.control === "manual-time") {
    state.manualTime = Number(target.value);
    render();
  }
});

async function bootstrap() {
  await loadSongs();
  render();
}

bootstrap();