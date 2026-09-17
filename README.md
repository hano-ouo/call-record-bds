```markdown
# Call 词记录网站

零依赖静态站点。

## 当前功能

### 歌曲列表
- 只展示有 Call 词的歌曲（`hasCall: true`）。
- 按发售时间或曲名升降序排序，使用自定义下拉 UI。
- 鼠标悬停 / 聚焦歌曲行时，显示发售日期、视频版本数、歌词摘录。

### 歌曲详情
- 日文歌词、Call 词展示；中文译文预留 `translations` 字段，暂不展示。
- 假名、Call 假名、Call 罗马音分别用独立开关控制，可同时开启。
- 三种布局：
  - **双屏**：左歌词 + 右播放面板。
  - **歌词模式**：全宽歌词流，无时间轴、无高亮，Call 用 `\\call//` 形式并排。
  - **视频放大**：左歌词窄栏 + 右播放面板放大。
- 音频模式下右栏变窄，显示封面图 + 原生 `<audio>` 播放器。

### 媒体
- 一级分类：**视频** / **音频**。
- 视频二级分类：**Call 讲座** / **Live 练习**。
  - Call 讲座：一定 YouTube，**映射时间轴**。
  - Live 练习：YouTube 或 B 站，**不映射**。
- 音频：本地文件，单版本，**映射时间轴**。
- 默认进入详情页为视频模式 + Call 讲座。

### 时间轴与同步
- Call 讲座：接入 YouTube IFrame API，每 250ms 读取当前时间，真同步歌词高亮。
- 音频：`<audio>` 的 `timeupdate` 驱动，真同步。
- Live 练习 / B 站：不接 API，不显示手动滑杆，不参与高亮。
- 手动时间轴滑杆：
  - 只对映射的视频（Call 讲座）显示。
  - 范围限制在 `[videoStart, videoStart + duration]`，左右两侧时间均显示。
  - 左侧时间钳制在 `[0, 总长]`，不会超过右侧总长。
  - 拖动时反向 seek 视频，并强制滚动到对应歌词。
- 自动居中：
  - 仅在“当前歌词行发生变化”时滚动一次，避免 `timeupdate` 高频触发导致抖动。
  - 用户主动滚动（滚轮 / 触摸 / 指针 / 方向键）后暂停 5 秒，之后恢复跟随。
- `timeOffset` 只对视频生效，音频不做偏移；`state.manualTime` 统一存**歌词时间**。

### 播放器
- YouTube / B 站用官方 iframe 嵌入，默认不自动播放。
- 音频用原生 `<audio controls>`，加 `controlsList="nodownload"` 并禁用右键菜单，降低随手下载的可能（前端无法真正阻止下载）。

## 数据维护

每首歌独立为一个 JSON 文件，放在 `songs/` 目录下，由 `songs/index.json` 维护文件名列表，新增歌曲不用改 `app.js`。

### 目录结构

```
站点根目录/
├── index.html
├── app.js
├── styles.css
├── songs/
│   ├── index.json
│   └── <song-id>.json
├── audio/
│   └── <song-id>.m4a
└── images/
    └── <song-id>.jpg
```

`songs/index.json`：

```json
{
  "songs": [
    "kimi-wa-toshi-densetsu.json"
  ]
}
```

### 歌曲 JSON 结构

```json
{
  "id": "song-id",
  "title": "曲名",
  "titleKana": "きょくめい",
  "releaseDate": "2026-01-01",
  "hasCall": true,
  "preview": {
    "lyricExcerpt": "歌词预览",
    "note": ""
  },
  "lyrics": [
    {
      "start": 0,
      "end": 3.5,
      "ja": {
        "text": "歌词全文",
        "segments": [
          { "text": "歌词", "type": "kanji", "kana": "かし", "romaji": "kashi" },
          { "text": "です", "type": "kana", "romaji": "desu" }
        ]
      },
      "translations": {},
      "calls": [
        {
          "text": "Call 词",
          "align": "start",
          "offset": 0,
          "segments": [
            { "text": "Call", "type": "latin" }
          ]
        }
      ]
    }
  ],
  "media": {
    "audio": {
      "id": "audio-1",
      "label": "练习音源",
      "provider": "audio",
      "src": "./audio/song-id.m4a",
      "cover": "./images/song-id.jpg",
      "timeOffset": 0,
      "note": "本地音频"
    },
    "video": {
      "callLecture": {
        "items": [
          {
            "id": "lecture",
            "label": "Call 讲座",
            "provider": "youtube",
            "youtubeId": "xxxx",
            "si": "",
            "videoStart": 0,
            "timeOffset": 0,
            "duration": 200,
            "note": "映射时间轴"
          }
        ]
      },
      "livePractice": {
        "items": [
          {
            "id": "practice",
            "label": "Live 练习",
            "provider": "youtube",
            "youtubeId": "xxxx",
            "videoStart": 0,
            "timeOffset": 0,
            "note": "不映射"
          }
        ]
      }
    }
  }
}
```

### 字段说明

**顶层**

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识，与文件名对应。 |
| `title` | 曲名。 |
| `titleKana` | 曲名假名，用于排序。 |
| `releaseDate` | 发售日期 `YYYY-MM-DD`。 |
| `hasCall` | 是否在列表页显示。 |
| `preview.lyricExcerpt` | 列表 hover 显示的歌词摘录。 |

**lyrics 每行**

| 字段 | 说明 |
|---|---|
| `start` / `end` | 歌词时间区间（秒），支持小数。 |
| `ja.segments` | 分词。`type` 为 `kanji` / `kana` / `latin`。 |
| `kanji` 段带 `kana`（假名）和 `romaji`（罗马音）。 |
| `compact: true` | 可选，注音字号变小，用于长词。 |
| `calls` | 可选。`align` 为 `start` / `end`，`offset` 是贴到第几个 seg。 |

**media.audio**

| 字段 | 说明 |
|---|---|
| `provider` | 固定 `"audio"`。 |
| `src` | 音频路径，相对站点根目录。 |
| `cover` | 封面图路径。 |
| `timeOffset` | 音频不做偏移，填 `0`。 |

**media.video.callLecture**

| 字段 | 说明 |
|---|---|
| `provider` | 固定 `"youtube"`。 |
| `youtubeId` | YouTube 视频 ID，不要粘贴完整 iframe 地址。 |
| `si` | 可选，YouTube 分享参数。 |
| `videoStart` | 视频起播秒数（整数）。 |
| `timeOffset` | 视频时间与歌词时间的偏移。 |
| `duration` | 歌曲有效时长（秒），用于手动时间轴总长。 |

**media.video.livePractice**

| 字段 | 说明 |
|---|---|
| `provider` | `"youtube"` 或 `"bilibili"`。 |
| `youtubeId` / `bvid` | 按 provider 填其一。 |
| `page` | B 站分 P，可选，默认 1。 |
| `videoStart` / `timeOffset` | 保留字段，但 Live 练习不映射，实际不生效。 |

## 新增歌曲步骤

1. 在 `songs/` 下建 `<song-id>.json`。
2. 音频放 `audio/<song-id>.m4a`，封面放 `images/<song-id>.jpg`。
3. 在 `songs/index.json` 的 `songs` 数组里加 `"<song-id>.json"`。


## 字体

- 界面：Zen Kaku Gothic New / Inter。
- 歌词与曲名：Shippori Mincho（明朝体）。
- Call 词：默认继承界面字体；如需更醒目可单独指定（如 Roboto Condensed 700），日文建议回退到 Noto Sans JP 以保证跨设备一致。

## 已知限制

- B 站官方 iframe 不暴露播放时间 API，因此 B 站版本不做时间轴映射。
- YouTube iframe 的 `start` 参数只接受整数秒，亚秒级定位需在 `onReady` 后调用 `seekTo`。
```

## 主要更新点

- 补上了当前的双屏 / 歌词模式 / 视频放大三种布局。
- 明确了一级（视频/音频）与二级（Call 讲座/Live 练习）分类及映射规则。
- 说明了时间基准（`state.manualTime` 存歌词时间）、`timeOffset` 只对视频生效。
- 记录了自动居中的节流策略（仅歌词切换时滚动、用户操作后暂停 5 秒）。
- 更新了 `media` 数据结构（`audio` 单对象 + `video.callLecture` / `video.livePractice`）。
- 给出了目录结构、新增歌曲步骤、字段表和本地预览方式。
- 补充了音频下载限制、B 站无 API、YouTube 起播取整等已知限制。
