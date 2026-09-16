# Call词记录网站 MVP

这是一个零依赖静态 MVP，可以直接打开 `index.html` 预览，也可以推到 GitHub Pages 托管。

## 当前功能

- 歌曲列表，只展示有 Call 词的歌曲
- 按发售时间或曲名升降序排序
- 鼠标悬停歌曲卡片显示发售日期、歌词摘录和备注
- 歌曲详情页展示日文歌词、中文译文和 Call 词
- 日文歌词始终显示，假名和罗马音用独立 switch 开关控制，可同时开启
- 中文歌词字段暂不展示，数据结构中预留 `translations` 作为后续扩展
- 支持 Call 罗马音开关
- 支持 Call讲座 / Live练习 等视频版本切换
- YouTube iframe 嵌入默认不自动播放
- 练习版可用 `syncMode: "detached"` 切断歌词时间轴关联
- 第一版使用手动同步滑杆模拟歌词进度
- 下拉选择使用自定义 UI，不再使用浏览器原生 select

## 数据维护

示例数据目前在 `app.js` 的 `songs` 数组中。正式内容可以先继续按这个结构添加，后续再拆分为每首歌独立 JSON 文件。

YouTube 视频只需要填写 `youtubeId`，不要直接粘贴带 `autoplay=1` 的 iframe 地址。页面会统一生成不自动播放的 embed 地址。
