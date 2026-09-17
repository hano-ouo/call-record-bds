let songs = [];

const state = {
  route: "list",
  songId: null,
  sort: "release-desc",
  showKana: true,
  showCallKana: true,
  showCallRomaji: false,
  layout: "split",
  mediaKind: "video",
  videoCategory: "callLecture",
  versionIndex: 0,
  manualTime: 0,
  openDropdown: null
};

const app = document.querySelector("#app");

/*
 * 双屏歌词自动跟随
 *
 * 重要：
 * 不要在每次 timeupdate 时都 scrollIntoView。
 * 音频播放时 timeupdate 会高频触发，如果每次都启动 smooth scroll，
 * 多个滚动动画会互相叠加，造成“第一句 ↔ 当前句”来回跳动。
 *
 * 现在只在“当前歌词行发生变化”时滚动一次。
 */
const AUTO_SCROLL_RESUME_MS = 5000;

let autoScrollPausedUntil = 0;
let scrollResumeTimer = null;
let programmaticScroll = false;

/*
 * 记录上一次真正触发自动定位的歌词 index。
 *
 * 这和 state.manualTime 不同：
 * manualTime 每秒都会变化，
 * active lyric index 通常只在进入下一句时变化。
 */
let lastAutoScrolledLyricIndex = -1;

/* 防止 render 后旧播放器定时器继续工作 */
let playerBindingToken = 0;

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
  state.mediaKind = "video";
  state.videoCategory = "callLecture";
  state.versionIndex = 0;
  state.manualTime = 0;

  lastAutoScrolledLyricIndex = -1;
  autoScrollPausedUntil = 0;

  render();
}

function getCurrentSong() {
  return songs.find((song) => song.id === state.songId) || songs[0];
}

/* 当前媒体：返回 { media, mapped, category } */
function getCurrentMedia(song) {
  if (!song) {
    return {
      media: null,
      mapped: false,
      category: null
    };
  }

  if (state.mediaKind === "audio") {
    return {
      media: song.media.audio,
      mapped: true,
      category: "audio"
    };
  }

  const group = song.media.video[state.videoCategory];
  const items = group?.items || [];
  const item = items[state.versionIndex] || items[0];

  return {
    media: item,
    mapped: state.videoCategory === "callLecture",
    category: state.videoCategory
  };
}

/* 歌曲有效长度 */
function getSongLength(song, media) {
  return media?.duration ?? Math.max(...song.lyrics.map((line) => line.end), 60);
}

/* 媒体时间 → 歌词时间 */
function mediaTimeToLyricTime(media, mediaTime) {
  if (!media) return 0;

  if (media.provider === "audio") {
    return mediaTime;
  }

  return mediaTime - (media.timeOffset || 0);
}

/* 歌词时间 → 媒体时间 */
function lyricTimeToMediaTime(media, lyricTime) {
  if (!media) return lyricTime;

  if (media.provider === "audio") {
    return lyricTime;
  }

  return lyricTime + (media.timeOffset || 0);
}

/* 钳制歌词时间 */
function clampLyricTime(lyricTime, totalLength) {
  if (lyricTime < 0) return 0;
  if (lyricTime > totalLength) return totalLength;

  return lyricTime;
}

function sortSongs(items) {
  const sorted = [...items];

  const collator = new Intl.Collator(["ja", "zh-Hans", "en"], {
    sensitivity: "base",
    numeric: true
  });

  if (state.sort === "release-asc") {
    return sorted.sort((a, b) =>
      a.releaseDate.localeCompare(b.releaseDate)
    );
  }

  if (state.sort === "release-desc") {
    return sorted.sort((a, b) =>
      b.releaseDate.localeCompare(a.releaseDate)
    );
  }

  if (state.sort === "title-asc") {
    return sorted.sort((a, b) =>
      collator.compare(a.titleKana, b.titleKana)
    );
  }

  return sorted.sort((a, b) =>
    collator.compare(b.titleKana, a.titleKana)
  );
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

/*
 * 当前歌词 index。
 *
 * 注意：
 * 不再通过“最接近时间”的方式寻找歌词，
 * 仍然严格使用 start <= time < end。
 */
function activeLyricIndex(song, mapped) {
  if (!song || !mapped) {
    return -1;
  }

  return song.lyrics.findIndex(
    (line) =>
      state.manualTime >= line.start &&
      state.manualTime < line.end
  );
}

function embedUrl(media) {
  if (media.provider === "bilibili") {
    const params = new URLSearchParams({
      bvid: media.bvid,
      page: String(media.page ?? 1),
      autoplay: "0",
      t: String(media.videoStart ?? media.timeOffset ?? 0)
    });

    return `https://player.bilibili.com/player.html?${params.toString()}`;
  }

  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    enablejsapi: "1",
    origin: window.location.origin
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
  const selected =
    options.find((option) => option.value === value) || options[0];

  return `
    <div class="select-menu ${state.openDropdown === control ? "open" : ""}">
      <button
        class="select-trigger"
        type="button"
        data-dropdown="${control}"
        aria-label="${label}"
      >
        <span>${selected.label}</span>
        <span class="select-arrow">⌄</span>
      </button>

      <div class="select-options" role="listbox">
        ${options
          .map(
            (option) => `
              <button
                class="select-option ${
                  option.value === value ? "selected" : ""
                }"
                type="button"
                data-select-control="${control}"
                data-select-value="${option.value}"
              >
                ${option.label}
              </button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function switchControl(toggle, label, active) {
  return `
    <button
      class="toggle-chip ${active ? "on" : ""}"
      type="button"
      data-toggle="${toggle}"
      aria-pressed="${active}"
    >
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

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSegments(segments) {
  return segments
    .map((seg) => {
      const kana =
        seg.type === "kanji" && seg.kana
          ? ` data-kana="${escapeHtml(seg.kana)}"`
          : "";

      const romaji =
        seg.type !== "latin" && seg.romaji
          ? ` data-romaji="${escapeHtml(seg.romaji)}"`
          : "";

      const compact =
        seg.compact
          ? ` data-compact="true"`
          : "";

      return `
        <span
          class="seg"
          data-type="${escapeHtml(seg.type)}"
          ${kana}
          ${romaji}
          ${compact}
        >${escapeHtml(seg.text)}</span>
      `;
    })
    .join("");
}

function renderCallSegments(call) {
  return call.segments
    .map((seg) => {
      const kana =
        seg.type === "kanji" && seg.kana
          ? ` data-kana="${escapeHtml(seg.kana)}"`
          : "";

      const romaji =
        seg.type !== "latin" && seg.romaji
          ? ` data-romaji="${escapeHtml(seg.romaji)}"`
          : "";

      const compact =
        seg.compact
          ? ` data-compact="true"`
          : "";

      return `
        <span
          class="seg"
          data-type="${escapeHtml(seg.type)}"
          ${kana}
          ${romaji}
          ${compact}
        >${escapeHtml(seg.text)}</span>
      `;
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
            <div
              class="line-call"
              data-align="${escapeHtml(call.align || "start")}"
              data-offset="${call.offset || 0}"
            >
              <div class="call-main">
                ${renderCallSegments(call)}
              </div>

              <div class="call-kana-layer"></div>
              <div class="call-romaji-layer"></div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

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
              <span class="call-bracket">\\</span>
              <span class="call-main">
                ${renderCallSegments(call)}
              </span>
              <span class="call-bracket">//</span>

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
            <h1>
              BUDDiiS
              <span class="dot">•</span>
              CALL LECTURE
            </h1>

            <p>
              静态托管 MVP · 歌词、Call 词与视频备注
            </p>
          </div>
        </div>

        <div class="nav-actions">
          <button
            class="button ${state.route === "list" ? "primary" : ""}"
            data-action="home"
          >
            歌曲列表
          </button>

          <button
            class="button"
            data-action="format"
          >
            文件格式示例
          </button>
        </div>
      </header>

      <main class="content">
        ${inner}
      </main>

    </div>
  `;
}

function renderList() {
  const items = sortSongs(
    songs.filter((song) => song.hasCall)
  );

  renderShell(`
    <section class="toolbar">
      <div>
        <strong>歌曲列表</strong>
        <span class="song-meta">
          ${items.length} 首有 Call 词的歌曲
        </span>
      </div>

      <div class="toolbar-group">
        ${customSelect(
          "sort",
          "歌曲排序",
          [
            {
              value: "release-desc",
              label: "发售时间 · 新到旧"
            },
            {
              value: "release-asc",
              label: "发售时间 · 旧到新"
            },
            {
              value: "title-asc",
              label: "曲名首字母 · A-Z"
            },
            {
              value: "title-desc",
              label: "曲名首字母 · Z-A"
            }
          ],
          state.sort
        )}
      </div>
    </section>

    <section class="song-list">
      ${items
        .map(
          (song) => `
            <button
              class="song-row"
              type="button"
              data-action="open-song"
              data-song-id="${escapeHtml(song.id)}"
            >
              <h2>${escapeHtml(song.title)}</h2>

              <span class="song-date">
                ${formatDate(song.releaseDate)}
              </span>

              <span class="song-tag">
                ${
                  song.media.video.callLecture.items.length +
                  song.media.video.livePractice.items.length
                }
                个视频版本
              </span>

              <span class="song-excerpt">
                ${escapeHtml(song.preview.lyricExcerpt)}
              </span>
            </button>
          `
        )
        .join("")}
    </section>
  `);
}

/*
 * 歌词 / 假名布局
 *
 * 这一部分保留原有逻辑。
 */
function layoutAnnotations() {
  document.querySelectorAll(".line").forEach((line) => {
    const content = line.querySelector(".lyric-content");

    if (!content) return;

    const kanaLayer =
      content.querySelector(".lyric-kana-layer");

    const romajiLayer =
      content.querySelector(".lyric-romaji-layer");

    if (!kanaLayer || !romajiLayer) return;

    kanaLayer.innerHTML = "";
    romajiLayer.innerHTML = "";

    const contentRect =
      content.getBoundingClientRect();

    content
      .querySelectorAll(".lyric-main .seg")
      .forEach((seg) => {
        const rect =
          seg.getBoundingClientRect();

        if (state.showKana && seg.dataset.kana) {
          const kanaText =
            stripPunctuation(seg.dataset.kana);

          if (kanaText) {
            const el =
              document.createElement("div");

            el.className = "kana-mark";

            if (
              seg.dataset.compact === "true"
            ) {
              el.classList.add("compact");
            }

            el.textContent = kanaText;

            const centerX =
              rect.left -
              contentRect.left +
              rect.width / 2;

            el.style.left = `${centerX}px`;

            el.style.top =
              `${rect.top - contentRect.top - 14}px`;

            kanaLayer.appendChild(el);
          }
        }
      });

    content
      .querySelectorAll(".line-call")
      .forEach((call) => {
        const callKanaLayer =
          call.querySelector(".call-kana-layer");

        const callRomajiLayer =
          call.querySelector(".call-romaji-layer");

        if (!callKanaLayer || !callRomajiLayer) {
          return;
        }

        callKanaLayer.innerHTML = "";
        callRomajiLayer.innerHTML = "";

        const callRect =
          call.getBoundingClientRect();

        call
          .querySelectorAll(".call-main .seg")
          .forEach((seg) => {
            const rect =
              seg.getBoundingClientRect();

            if (
              state.showCallKana &&
              seg.dataset.kana
            ) {
              const kanaText =
                stripPunctuation(
                  seg.dataset.kana
                );

              if (kanaText) {
                const el =
                  document.createElement("div");

                el.className = "kana-mark";

                if (
                  seg.dataset.compact ===
                  "true"
                ) {
                  el.classList.add("compact");
                }

                el.textContent = kanaText;

                const centerX =
                  rect.left -
                  callRect.left +
                  rect.width / 2;

                el.style.left =
                  `${centerX}px`;

                el.style.top =
                  `${rect.top - callRect.top - 16}px`;

                callKanaLayer.appendChild(el);
              }
            }

            if (
              state.showCallRomaji &&
              seg.dataset.romaji
            ) {
              const romajiText =
                stripPunctuation(
                  seg.dataset.romaji
                );

              if (romajiText) {
                const el =
                  document.createElement("div");

                el.className =
                  "romaji-mark";

                if (
                  seg.dataset.compact ===
                  "true"
                ) {
                  el.classList.add("compact");
                }

                el.textContent =
                  romajiText;

                const centerX =
                  rect.left -
                  callRect.left +
                  rect.width / 2;

                el.style.left =
                  `${centerX}px`;

                el.style.top =
                  `${rect.bottom - callRect.top + 2}px`;

                callRomajiLayer.appendChild(
                  el
                );
              }
            }
          });
      });
  });
}

function layoutFlowAnnotations() {
  document.querySelectorAll(".flow-line").forEach((line) => {
    const content =
      line.querySelector(".lyric-content");

    if (!content) return;

    const kanaLayer =
      content.querySelector(".lyric-kana-layer");

    const romajiLayer =
      content.querySelector(".lyric-romaji-layer");

    if (!kanaLayer || !romajiLayer) return;

    kanaLayer.innerHTML = "";
    romajiLayer.innerHTML = "";

    const contentRect =
      content.getBoundingClientRect();

    content
      .querySelectorAll(".lyric-main .seg")
      .forEach((seg) => {
        const rect =
          seg.getBoundingClientRect();

        if (state.showKana && seg.dataset.kana) {
          const kanaText =
            stripPunctuation(seg.dataset.kana);

          if (kanaText) {
            const el =
              document.createElement("div");

            el.className = "kana-mark";

            if (
              seg.dataset.compact ===
              "true"
            ) {
              el.classList.add("compact");
            }

            el.textContent = kanaText;

            const centerX =
              rect.left -
              contentRect.left +
              rect.width / 2;

            el.style.left =
              `${centerX}px`;

            el.style.top =
              `${rect.top - contentRect.top - 14}px`;

            kanaLayer.appendChild(el);
          }
        }
      });

    content
      .querySelectorAll(".flow-call")
      .forEach((call) => {
        const callKanaLayer =
          call.querySelector(".call-kana-layer");

        const callRomajiLayer =
          call.querySelector(".call-romaji-layer");

        if (
          !callKanaLayer ||
          !callRomajiLayer
        ) {
          return;
        }

        callKanaLayer.innerHTML = "";
        callRomajiLayer.innerHTML = "";

        const callRect =
          call.getBoundingClientRect();

        call
          .querySelectorAll(".call-main .seg")
          .forEach((seg) => {
            const rect =
              seg.getBoundingClientRect();

            if (
              state.showCallKana &&
              seg.dataset.kana
            ) {
              const kanaText =
                stripPunctuation(
                  seg.dataset.kana
                );

              if (kanaText) {
                const el =
                  document.createElement("div");

                el.className =
                  "kana-mark";

                if (
                  seg.dataset.compact ===
                  "true"
                ) {
                  el.classList.add(
                    "compact"
                  );
                }

                el.textContent =
                  kanaText;

                const centerX =
                  rect.left -
                  callRect.left +
                  rect.width / 2;

                el.style.left =
                  `${centerX}px`;

                el.style.top =
                  `${rect.top - callRect.top - 14}px`;

                callKanaLayer.appendChild(
                  el
                );
              }
            }

            if (
              state.showCallRomaji &&
              seg.dataset.romaji
            ) {
              const romajiText =
                stripPunctuation(
                  seg.dataset.romaji
                );

              if (romajiText) {
                const el =
                  document.createElement(
                    "div"
                  );

                el.className =
                  "romaji-mark";

                if (
                  seg.dataset.compact ===
                  "true"
                ) {
                  el.classList.add(
                    "compact"
                  );
                }

                el.textContent =
                  romajiText;

                const centerX =
                  rect.left -
                  callRect.left +
                  rect.width / 2;

                el.style.left =
                  `${centerX}px`;

                el.style.top =
                  `${rect.bottom - callRect.top + 2}px`;

                callRomajiLayer.appendChild(
                  el
                );
              }
            }
          });
      });
  });
}

/*
 * Call 定位
 *
 * 仍然以歌词 segment 为锚点。
 * 由于 .lyrics-scroll 现在允许横向滚动，
 * 超出面板的 Call 可以通过水平滚动查看。
 */
function layoutCalls() {
  document.querySelectorAll(".line").forEach((line) => {
    const content =
      line.querySelector(".lyric-content");

    const main =
      line.querySelector(".lyric-main");

    if (!content || !main) return;

    const segs = [
      ...main.querySelectorAll(".seg")
    ];

    const calls =
      content.querySelectorAll(".line-call");

    if (!segs.length) return;

    const mainRect =
      main.getBoundingClientRect();

    const contentRect =
      content.getBoundingClientRect();

    calls.forEach((call) => {
      const align =
        call.dataset.align || "start";

      const offset =
        Number(call.dataset.offset || 0);

      let target = null;

      if (align === "end") {
        target =
          segs[segs.length - 1];
      } else {
        target =
          segs[offset] || segs[0];
      }

      if (!target) return;

      const rect =
        target.getBoundingClientRect();

      const x =
        (
          align === "end"
            ? rect.right
            : rect.left
        ) - contentRect.left;

      /*
       * Call 位于歌词下方。
       *
       * 这里稍微增加一点上方空间，
       * 避免 Call 的假名视觉上贴着歌词。
       */
      const y =
        mainRect.bottom -
        contentRect.top +
        16;

      call.style.left =
        `${x}px`;

      call.style.top =
        `${y}px`;

      call.style.transform =
        "none";
    });
  });
}

/*
 * 判断用户是否正在手动操作歌词滚动。
 *
 * 这里仅暂停“自动跟随”，
 * 不会禁止用户滚动整个网页。
 */
function pauseAutoFollowForUserScroll() {
  autoScrollPausedUntil =
    Date.now() + AUTO_SCROLL_RESUME_MS;

  if (scrollResumeTimer) {
    clearTimeout(scrollResumeTimer);
  }

  scrollResumeTimer = setTimeout(() => {
    autoScrollPausedUntil = 0;

    const song = getCurrentSong();

    if (!song) return;

    const { mapped } =
      getCurrentMedia(song);

    /*
     * 恢复跟随后不强制立即滚动。
     * 下一次歌词真正切换时再定位。
     */
  }, AUTO_SCROLL_RESUME_MS);
}

/*
 * 只更新当前歌词高亮。
 */
function updateActiveLine(song, mapped) {
  const index =
    activeLyricIndex(song, mapped);

  document
    .querySelectorAll(".line")
    .forEach((el, i) => {
      el.classList.toggle(
        "active",
        i === index
      );
    });

  return index;
}

/*
 * 自动滚动到当前歌词。
 *
 * 核心修复：
 *
 * 旧逻辑：
 * 每次 timeupdate
 * → scrollIntoView({ block: "center" })
 * → smooth animation
 * → 下一次 timeupdate 再来一次
 * → 多个动画叠加
 * → 上下跳动
 *
 * 新逻辑：
 * 只有 index 改变时才滚动。
 */
function followActiveLyric(song, mapped, force = false) {
  const index =
    activeLyricIndex(song, mapped);

  document
    .querySelectorAll(".line")
    .forEach((el, i) => {
      el.classList.toggle(
        "active",
        i === index
      );
    });

  if (index < 0) {
    return;
  }

  /*
   * 用户最近主动滚动过时，
   * 暂时不抢夺滚动位置。
   */
  if (
    !force &&
    Date.now() < autoScrollPausedUntil
  ) {
    return;
  }

  /*
   * 当前行没有变化：
   * 不重复滚动。
   */
  if (
    !force &&
    index === lastAutoScrolledLyricIndex
  ) {
    return;
  }

  const active =
    document.querySelector(
      `.line[data-line-index="${index}"]`
    );

  const scroller =
    document.querySelector(
      "#lyrics-scroll"
    );

  if (!active || !scroller) {
    return;
  }

  /*
   * 第一、第二句不强行制造顶部留白。
   *
   * scrollIntoView 的 center 在滚动边界处会自然被限制，
   * 因此靠近开头时会停留在顶部附近。
   */
  const scrollerRect =
    scroller.getBoundingClientRect();

  const activeRect =
    active.getBoundingClientRect();

  const activeCenter =
    activeRect.top +
    activeRect.height / 2;

  const viewportCenter =
    scrollerRect.top +
    scrollerRect.height / 2;

  const delta =
    activeCenter -
    viewportCenter;

  /*
   * 已经基本处于视觉中心时，不再移动。
   */
  if (
    Math.abs(delta) < 8
  ) {
    lastAutoScrolledLyricIndex =
      index;

    return;
  }

  lastAutoScrolledLyricIndex =
    index;

  programmaticScroll = true;

  /*
   * 只操作歌词内部 scroller，
   * 不让整个页面跟着移动。
   *
   * 这里使用 smooth，但由于只有“歌词切换”
   * 才触发一次，因此不会再产生高频动画叠加。
   */
  scroller.scrollTo({
    top:
      scroller.scrollTop +
      delta,
    behavior: "smooth"
  });

  requestAnimationFrame(() => {
    programmaticScroll = false;
  });
}

/*
 * 滑杆 value 与右侧时间文本跟随媒体时间更新。
 */
function updateManualSlider(media) {
  const slider =
    document.querySelector(
      'input[data-control="manual-time"]'
    );

  if (!slider) return;

  const total =
    Number(slider.dataset.total) || 0;

  const clamped =
    clampLyricTime(
      state.manualTime,
      total
    );

  const mediaTime =
    lyricTimeToMediaTime(
      media,
      clamped
    );

  slider.value = mediaTime;

  const label =
    document.querySelector(
      "#manual-time-label"
    );

  if (label) {
    label.textContent =
      `${formatTime(clamped)} / ${formatTime(total)}`;
  }
}

/* ===== YouTube IFrame API ===== */

let ytPlayer = null;
let ytTimer = null;

function loadYouTubeAPI() {
  if (
    window.YT &&
    window.YT.Player
  ) {
    return Promise.resolve(
      window.YT
    );
  }

  return new Promise((resolve) => {
    const prev =
      window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady =
      () => {
        if (prev) {
          prev();
        }

        resolve(window.YT);
      };

    const tag =
      document.createElement(
        "script"
      );

    tag.src =
      "https://www.youtube.com/iframe_api";

    document.head.appendChild(tag);
  });
}

function bindYouTubePlayer(
  media,
  song,
  totalLength
) {
  if (ytTimer) {
    clearInterval(ytTimer);
    ytTimer = null;
  }

  ytPlayer = null;

  const bindingToken =
    ++playerBindingToken;

  loadYouTubeAPI().then((YT) => {
    if (
      bindingToken !==
      playerBindingToken
    ) {
      return;
    }

    const iframe =
      document.querySelector(
        "#yt-player"
      );

    if (!iframe) return;

    ytPlayer =
      new YT.Player(
        "yt-player",
        {
          videoId:
            media.youtubeId,

          playerVars: {
            start: Math.floor(
              media.videoStart ??
              media.timeOffset ??
              0
            ),
            rel: 0,
            modestbranding: 1,
            playsinline: 1
          },

          events: {
            onReady: () => {
              ytTimer =
                setInterval(() => {
                  if (
                    !ytPlayer ||
                    !ytPlayer.getCurrentTime
                  ) {
                    return;
                  }

                  const mediaTime =
                    ytPlayer.getCurrentTime();

                  const raw =
                    mediaTimeToLyricTime(
                      media,
                      mediaTime
                    );

                  state.manualTime =
                    clampLyricTime(
                      raw,
                      totalLength
                    );

                  followActiveLyric(
                    song,
                    true,
                    false
                  );

                  updateManualSlider(
                    media
                  );
                }, 250);
            }
          }
        }
      );
  });
}

/* ===== 本地音频 ===== */

let audioEl = null;

function bindAudioPlayer(song) {
  audioEl =
    document.querySelector(
      "#audio-player"
    );

  if (!audioEl) return;

  audioEl.oncontextmenu =
    (event) => {
      event.preventDefault();
    };

  if (
    audioEl.dataset.bound === "1"
  ) {
    return;
  }

  audioEl.dataset.bound = "1";

  /*
   * 音频 timeupdate 不再直接 scroll。
   *
   * followActiveLyric 内部会判断：
   * 当前歌词 index 是否真的发生变化。
   */
  audioEl.addEventListener(
    "timeupdate",
    () => {
      const { media } =
        getCurrentMedia(song);

      const totalLength =
        getSongLength(
          song,
          media
        );

      state.manualTime =
        clampLyricTime(
          audioEl.currentTime,
          totalLength
        );

      followActiveLyric(
        song,
        true,
        false
      );

      updateManualSlider(
        media
      );
    }
  );
}

function seekMedia(mediaTime) {
  if (audioEl) {
    audioEl.currentTime =
      mediaTime;
  }

  if (
    ytPlayer &&
    ytPlayer.seekTo
  ) {
    ytPlayer.seekTo(
      mediaTime,
      true
    );
  }
}

function renderPlayer(
  media,
  song
) {
  if (!media) {
    return `
      <div class="player-frame">
        <p class="song-meta">
          暂无媒体
        </p>
      </div>
    `;
  }

  if (
    media.provider === "audio"
  ) {
    return `
      <div class="player-frame audio-frame">

        ${
          media.cover
            ? `
              <img
                class="audio-cover-img"
                src="${escapeHtml(media.cover)}"
                alt="${escapeHtml(song.title)}"
              />
            `
            : ""
        }

        <audio
          id="audio-player"
          src="${escapeHtml(media.src)}"
          controls
          controlsList="nodownload"
          preload="metadata"
        ></audio>

      </div>
    `;
  }

  if (
    media.provider === "bilibili"
  ) {
    return `
      <div class="player-frame">

        <iframe
          src="${embedUrl(media)}"
          title="${escapeHtml(song.title)} ${escapeHtml(media.label || "")}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>

      </div>
    `;
  }

  return `
    <div class="player-frame">

      <iframe
        id="yt-player"
        src="${embedUrl(media)}"
        title="${escapeHtml(song.title)} ${escapeHtml(media.label || "")}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>

    </div>
  `;
}

function renderDetail() {
  /*
   * render 时重新建立 DOM。
   * 所以旧的自动定位状态需要保留，
   * 但不能让旧播放器继续控制新的 DOM。
   */
  if (scrollResumeTimer) {
    clearTimeout(
      scrollResumeTimer
    );

    scrollResumeTimer = null;
  }

  autoScrollPausedUntil = 0;

  playerBindingToken++;

  const song =
    getCurrentSong();

  if (!song) {
    renderShell(`
      <section class="format-note">
        <h3>没有可显示的歌曲</h3>
      </section>
    `);

    return;
  }

  const {
    media,
    mapped
  } =
    getCurrentMedia(song);

  const currentIndex =
    activeLyricIndex(
      song,
      mapped
    );

  const lyricsMode =
    state.layout === "lyrics";

  const totalLength =
    getSongLength(
      song,
      media
    );

  const audioMode =
    state.mediaKind === "audio";

  const gridClass =
    audioMode
      ? "audio-focus"
      : state.layout === "video"
        ? "video-focus"
        : "";

  const isMappedVideo =
    mapped &&
    media?.provider !== "audio";

  renderShell(`
    <section class="detail-head">

      <div>
        <h2>
          ${escapeHtml(song.title)}
        </h2>

        <p>
          ${escapeHtml(song.releaseDate)}
          ·
          ${escapeHtml(media?.label || "")}
        </p>
      </div>

      <div class="detail-head-side">

        <div class="toolbar-group">

          <button
            class="chip ${
              state.layout === "split"
                ? "active"
                : ""
            }"
            data-layout="split"
          >
            双屏
          </button>

          <button
            class="chip ${
              state.layout === "lyrics"
                ? "active"
                : ""
            }"
            data-layout="lyrics"
          >
            歌词模式
          </button>

          <button
            class="chip ${
              state.layout === "video"
                ? "active"
                : ""
            }"
            data-layout="video"
          >
            视频放大
          </button>

        </div>

        ${
          lyricsMode
            ? `
              <div class="lyrics-tools lyrics-tools-inline">

                ${switchControl(
                  "kana",
                  "歌词假名",
                  state.showKana
                )}

                ${switchControl(
                  "call-kana",
                  "Call假名",
                  state.showCallKana
                )}

                ${switchControl(
                  "call-romaji",
                  "Call罗马音",
                  state.showCallRomaji
                )}

              </div>
            `
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

                        <div class="lyric-main">
                          ${renderSegments(
                            line.ja.segments
                          )}
                        </div>

                        <div class="lyric-kana-layer"></div>
                        <div class="lyric-romaji-layer"></div>

                        ${renderFlowCalls(
                          line
                        )}

                      </div>

                    </div>
                  `
                )
                .join("")}

            </div>

          </section>
        `
        : `
          <section
            class="detail-grid ${gridClass}"
          >

            <article class="panel lyrics-panel">

              <div class="panel-head">

                <h3>
                  歌词 / Call
                </h3>

                <div class="lyrics-tools">

                  ${switchControl(
                    "kana",
                    "歌词假名",
                    state.showKana
                  )}

                  ${switchControl(
                    "call-kana",
                    "Call假名",
                    state.showCallKana
                  )}

                  ${switchControl(
                    "call-romaji",
                    "Call罗马音",
                    state.showCallRomaji
                  )}

                </div>

              </div>

              <div class="lyrics-and-calls">

                <div
                  class="lyrics-scroll"
                  id="lyrics-scroll"
                >

                  ${song.lyrics
                    .map(
                      (line, index) => `
                        <div
                          class="line ${
                            index === currentIndex
                              ? "active"
                              : ""
                          }"
                          data-line-index="${index}"
                        >

                          <div class="time">
                            ${formatTime(
                              line.start
                            )}
                          </div>

                          <div class="lyric-content">

                            <div class="lyric-main">
                              ${renderSegments(
                                line.ja.segments
                              )}
                            </div>

                            <div class="lyric-kana-layer"></div>
                            <div class="lyric-romaji-layer"></div>

                            ${callBlock(
                              line
                            )}

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

                ${customSelect(
                  "media-kind",
                  "媒体类型",
                  [
                    {
                      value: "video",
                      label: "视频"
                    },
                    {
                      value: "audio",
                      label: "音频"
                    }
                  ],
                  state.mediaKind
                )}

                ${
                  audioMode
                    ? ""
                    : customSelect(
                        "video-category",
                        "视频分类",
                        [
                          {
                            value:
                              "callLecture",
                            label:
                              "Call 讲座"
                          },
                          {
                            value:
                              "livePractice",
                            label:
                              "Live 练习"
                          }
                        ],
                        state.videoCategory
                      )
                }

              </div>

              ${renderPlayer(
                media,
                song
              )}

              <div class="video-meta">
                <p>
                  ${escapeHtml(
                    media?.note || ""
                  )}
                </p>
              </div>

              <div
                class="manual-clock ${
                  isMappedVideo
                    ? ""
                    : "hidden"
                }"
              >

                <strong>
                  手动同步时间轴
                </strong>

                <div class="range-row">

                  <input
                    type="range"
                    min="${
                      media?.videoStart ??
                      0
                    }"
                    max="${
                      (media?.videoStart ??
                        0) +
                      totalLength
                    }"
                    step="0.1"
                    value="${lyricTimeToMediaTime(
                      media,
                      state.manualTime
                    )}"
                    data-control="manual-time"
                    data-total="${totalLength}"
                  />

                  <span id="manual-time-label">
                    ${formatTime(
                      state.manualTime
                    )}
                    /
                    ${formatTime(
                      totalLength
                    )}
                  </span>

                </div>

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

    /*
     * 必须先完成歌词布局，
     * 再进行自动定位。
     */
    layoutAnnotations();
    layoutCalls();

    if (
      document.fonts?.ready
    ) {
      document.fonts.ready.then(() => {
        if (
          state.route === "detail" &&
          state.layout !== "lyrics"
        ) {
          layoutAnnotations();
          layoutCalls();
        }
      });
    }

    if (audioMode) {
      bindAudioPlayer(song);
    } else if (
      media &&
      media.provider === "youtube" &&
      mapped
    ) {
      bindYouTubePlayer(
        media,
        song,
        totalLength
      );
    }

    /*
     * 歌词内部滚动事件。
     *
     * 只暂停自动跟随，不阻止滚动。
     */
    const scroller =
      document.querySelector(
        "#lyrics-scroll"
      );

    if (
      scroller &&
      scroller.dataset.scrollBound !== "1"
    ) {
      scroller.dataset.scrollBound = "1";

      const markUserScroll =
        () => {
          /*
           * programmaticScroll 为 true 时，
           * 说明这是我们自己造成的滚动，
           * 不应该被当成用户行为。
           */
          if (programmaticScroll) {
            return;
          }

          pauseAutoFollowForUserScroll();
        };

      scroller.addEventListener(
        "wheel",
        markUserScroll,
        { passive: true }
      );

      scroller.addEventListener(
        "touchmove",
        markUserScroll,
        { passive: true }
      );

      scroller.addEventListener(
        "pointerdown",
        markUserScroll
      );

      scroller.addEventListener(
        "keydown",
        (event) => {
          if (
            [
              "ArrowUp",
              "ArrowDown",
              "PageUp",
              "PageDown",
              "Home",
              "End"
            ].includes(event.key)
          ) {
            markUserScroll();
          }
        }
      );
    }

    /*
     * 初始定位：
     *
     * 只做一次。
     * 如果是第一句/第二句，scrollTop 会自然被限制在 0，
     * 不会人为制造一大片顶部空白。
     */
    const active =
      document.querySelector(
        ".line.active"
      );

    if (
      active &&
      scroller
    ) {
      const index =
        Number(
          active.dataset.lineIndex
        );

      lastAutoScrolledLyricIndex =
        -1;

      /*
       * 初始状态不使用 scrollIntoView，
       * 直接计算 delta。
       */
      const scrollerRect =
        scroller.getBoundingClientRect();

      const activeRect =
        active.getBoundingClientRect();

      const activeCenter =
        activeRect.top +
        activeRect.height / 2;

      const viewportCenter =
        scrollerRect.top +
        scrollerRect.height / 2;

      const delta =
        activeCenter -
        viewportCenter;

      /*
       * 只有在确实需要滚动时才执行。
       * 浏览器自身会自动把 scrollTop 限制在合法范围。
       */
      if (
        Math.abs(delta) >= 8
      ) {
        programmaticScroll = true;

        scroller.scrollTo({
          top:
            scroller.scrollTop +
            delta,
          behavior: "auto"
        });

        requestAnimationFrame(() => {
          programmaticScroll = false;
        });
      }

      lastAutoScrolledLyricIndex =
        index;
    }
  });
}

function renderFormat() {
  renderShell(`
    <section class="format-note">

      <h3>
        推荐文件格式示例
      </h3>

      <p>
        歌曲数据按文件拆分为
        songs/ 目录下的 JSON。
        songs/index.json 只维护文件名列表，
        新增歌曲不用改 app.js。
      </p>

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
  "hasCall": true
}</pre>

    </section>
  `);
}

function render() {
  if (
    state.route === "detail"
  ) {
    renderDetail();
    return;
  }

  if (
    state.route === "format"
  ) {
    renderFormat();
    return;
  }

  renderList();
}

document.addEventListener(
  "click",
  (event) => {
    const target =
      event.target.closest(
        "button"
      );

    if (!target) {
      return;
    }

    if (
      target.dataset.action ===
      "home"
    ) {
      setRoute("list");
      return;
    }

    if (
      target.dataset.action ===
      "format"
    ) {
      setRoute("format");
      return;
    }

    if (
      target.dataset.action ===
      "open-song"
    ) {
      setRoute(
        "detail",
        target.dataset.songId
      );

      return;
    }

    if (
      target.dataset.layout
    ) {
      state.layout =
        target.dataset.layout;

      lastAutoScrolledLyricIndex =
        -1;

      render();

      return;
    }

    if (
      target.dataset.dropdown
    ) {
      state.openDropdown =
        state.openDropdown ===
        target.dataset.dropdown
          ? null
          : target.dataset.dropdown;

      render();

      return;
    }

    if (
      target.dataset.selectControl
    ) {
      const control =
        target.dataset.selectControl;

      const value =
        target.dataset.selectValue;

      state.openDropdown = null;

      if (control === "sort") {
        state.sort = value;
      }

      if (
        control === "media-kind"
      ) {
        state.mediaKind =
          value;

        state.versionIndex = 0;
        state.manualTime = 0;

        lastAutoScrolledLyricIndex =
          -1;
      }

      if (
        control ===
        "video-category"
      ) {
        state.videoCategory =
          value;

        state.versionIndex = 0;
        state.manualTime = 0;

        lastAutoScrolledLyricIndex =
          -1;
      }

      render();

      return;
    }

    if (
      target.dataset.toggle ===
      "kana"
    ) {
      state.showKana =
        !state.showKana;

      render();

      return;
    }

    if (
      target.dataset.toggle ===
      "call-kana"
    ) {
      state.showCallKana =
        !state.showCallKana;

      render();

      return;
    }

    if (
      target.dataset.toggle ===
      "call-romaji"
    ) {
      state.showCallRomaji =
        !state.showCallRomaji;

      render();

      return;
    }
  }
);

document.addEventListener(
  "input",
  (event) => {
    const target =
      event.target;

    if (
      target.dataset.control !==
      "manual-time"
    ) {
      return;
    }

    const song =
      getCurrentSong();

    const {
      media,
      mapped
    } =
      getCurrentMedia(song);

    const total =
      Number(
        target.dataset.total
      ) || 0;

    const mediaTime =
      Number(target.value);

    const raw =
      mediaTimeToLyricTime(
        media,
        mediaTime
      );

    state.manualTime =
      clampLyricTime(
        raw,
        total
      );

    seekMedia(
      mediaTime
    );

    /*
     * 手动拖动时间轴时允许立即定位。
     */
    lastAutoScrolledLyricIndex =
      -1;

    followActiveLyric(
      song,
      mapped,
      true
    );

    updateManualSlider(
      media
    );
  }
);

async function bootstrap() {
  await loadSongs();
  render();
}

bootstrap();
