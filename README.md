# jiaffmpeg

> 本项目由 luojia 策划，由 deepseek ai 编写。

luojia 的 ffmpeg 工具库，基于 [`@tedconf/fessonia`](https://www.npmjs.com/package/@tedconf/fessonia) 封装，提供 ffmpeg / ffprobe 的常用能力：

- 检查视频 / 音频编码器是否真正可用
- 执行转码任务（支持进度、成功、失败事件）
- 直接使用 ffprobe 探测媒体信息

## 安装

```bash
npm install jiaffmpeg
```

## 初始化

库内部依赖 ffmpeg / ffprobe 的可执行文件路径。路径来源有两种方式：

### 方式一：环境变量（推荐）

在启动进程前设置环境变量，模块加载时会自动初始化：

```bash
# Windows (PowerShell)
$env:FFMPEG_PATH = "C:\files\programs\ffmpeg\ffmpeg.exe"
$env:FFPROBE_PATH = "C:\files\programs\ffmpeg\ffprobe.exe"

# Linux / macOS
export FFMPEG_PATH=/usr/bin/ffmpeg
export FFPROBE_PATH=/usr/bin/ffprobe
```

> 注意：只有两个环境变量**都**设置了，模块加载时才会自动初始化。若未设置，则保持未初始化状态，需要调用 `initPath()`。

### 方式二：手动调用 `initPath()`

```js
const jiaffmpeg = require('jiaffmpeg');

jiaffmpeg.initPath({
  ffmpeg: 'C:/files/programs/ffmpeg/ffmpeg.exe',
  ffprobe: 'C:/files/programs/ffmpeg/ffprobe.exe'
});
```

`initPath()` 会保存路径并重新初始化内部实例。之后所有依赖 fessonia 的方法（`checkVideoEncoder`、`checkAudioEncoder`、`transcode` 以及导出的类）都会使用最新的实例。

> 若未初始化就调用上述方法，会抛出错误：`fessonia is not initialized, call initPath() first`。

## API

### `ffprobe`

直接透传的 [`ffprobe-client`](https://www.npmjs.com/package/ffprobe-client) 实例，用于探测媒体文件信息。

```js
const jiaffmpeg = require('jiaffmpeg');

const info = await jiaffmpeg.ffprobe('input.mp4');
console.log(info);
```

### `checkVideoEncoder(codec)`

检查指定的**视频**编码器是否真正可用。

- `codec`：视频编码器名称，例如 `libx264`、`libx265`、`h264_nvenc`
- 返回：`Promise<boolean>`，可用返回 `true`，否则返回 `false`

```js
const ok = await jiaffmpeg.checkVideoEncoder('libx264');
console.log('libx264 可用:', ok);
```

### `checkAudioEncoder(codec)`

检查指定的**音频**编码器是否真正可用。

- `codec`：音频编码器名称，例如 `aac`、`mp3`、`libopus`
- 返回：`Promise<boolean>`，可用返回 `true`，否则返回 `false`

```js
const ok = await jiaffmpeg.checkAudioEncoder('aac');
console.log('aac 可用:', ok);
```

### `transcode(inputPath, inputOptions, outputPath, outputOptions, events)`

执行一次转码任务。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `inputPath` | `string` | 输入文件路径 |
| `inputOptions` | `object` \| `Map` | 输入选项（如 `{ f: 'lavfi' }`），对象会自动转换为 `Map` |
| `outputPath` | `string` | 输出文件路径 |
| `outputOptions` | `object` \| `Map` | 输出选项（如 `{ 'c:v': 'libx264' }`），对象会自动转换为 `Map` |
| `events` | `object` | 可选，事件监听器（见下方） |

返回 `Promise`，转码成功时 resolve，失败时 reject。

**事件监听器**（`events` 对象）：

| 事件 | 参数 | 说明 |
| --- | --- | --- |
| `update` | `data` | 转码进度更新 |
| `success` | `data` | 转码成功 |
| `error` | `err` | 转码失败 |
| `spawn` | `{ command }` | 自定义事件，命令真正执行前触发，`command` 为最终生成的 ffmpeg 指令字符串 |

```js
const jiaffmpeg = require('jiaffmpeg');

await jiaffmpeg.transcode(
  'input.mp4',
  {},
  'output.mp4',
  { 'c:v': 'libx264', 'c:a': 'aac', 'preset': 'fast' },
  {
    update: (data) => console.log('进度:', data),
    success: (data) => console.log('成功:', data),
    error: (err) => console.error('失败:', err),
    spawn: ({ command }) => console.log('执行指令:', command)
  }
);
```

选项参数既可以是普通对象，也可以是 `Map`：

```js
const opts = new Map([
  ['c:v', 'libx264'],
  ['preset', 'fast']
]);

await jiaffmpeg.transcode('input.mp4', {}, 'output.mp4', opts);
```

### `videoMeta(filePath)`

探测视频元信息，返回包含视频流 / 音频流分类的标准 ffprobe JSON。

- `filePath`：视频文件路径
- 返回：`Promise<object>`，在原始 ffprobe 结果基础上额外附带 `videoStreams` / `audioStreams` 数组

```js
const meta = await jiaffmpeg.videoMeta('input.mp4');
console.log('时长:', meta.format.duration);
console.log('视频流数量:', meta.videoStreams.length);
```

### `checkImageQuality(image, relaxMode)`

检测图片质量，返回一个代表图片质量的分数（分数越高质量越好）。

- `image`：图片文件路径或图片 `Buffer`
- `relaxMode`：`boolean`，是否放宽质量要求（跳过阈值过滤），默认 `false`
- 返回：`Promise<number>` 质量分数

默认实现根据图片的 `entropy` 和 `sharpness` 加权求和（entropy 占 70%，sharpness 占 30%）。非 `relaxMode` 下，若 `entropy < 4` 或 `sharpness < 0.15` 则分数为 `0`。

```js
const score = await jiaffmpeg.checkImageQuality('frame.jpg');
console.log('图片质量分数:', score);
```

### `extractVideoPreview(filePath, options)`

提取视频预览图，采用三级降级策略，返回图片 `Buffer`。

- `filePath`：视频文件路径
- `options`：可选，`{ checkImageQuality }` 可传入自定义图片质量评分函数（默认使用内置 `checkImageQuality`）
- 返回：`Promise<Buffer>` 预览图 buffer

**三级降级策略：**

1. **第一级**：用 ffmpeg `-ss` 快速 seek 在视频中均匀采样 30 帧（超过 15 分钟的视频跳过开头 5 分钟），按图片质量分数取最大的那个；若分数都为 0 进入第二级
2. **第二级**：视频前 30 秒内每隔 1 秒采样一帧，评分与处理方式同第一级
3. **第三级**：取视频第一帧、中间帧和最后一帧，用 `relaxMode` 评分取分最高者；若全为 0 则取中间帧兜底

```js
const preview = await jiaffmpeg.extractVideoPreview('input.mp4');
// preview 为 Buffer，可直接写入文件或进一步处理
```

### `sampleVideoFrames(filePath, options, handler)`

均匀采样视频帧，用于提取视频中指定时间间隔或帧间隔的图片。

- `filePath`：视频文件路径
- `options`：采样选项
  - `interval`：时间间隔（秒），与 `frameInterval` 二选一，优先于 `frameInterval`
  - `frameInterval`：帧间隔（帧数），需要视频帧率信息
  - `start`：起始时间（秒），默认 `0`
  - `end`：结束时间（秒），默认到视频末尾
- `handler`：接收函数，每提取一帧调用一次，参数为 `(buffer, timeSec)`
- 返回：`Promise<number>` 成功提取的帧数

```js
let count = 0;
const n = await jiaffmpeg.sampleVideoFrames(
  'input.mp4',
  { interval: 1 },
  (buffer, t) => {
    count++;
    console.log(`第 ${t}s 帧，大小 ${buffer.length}B`);
  }
);
console.log('共提取帧数:', n);
```

### 导出的 fessonia 类

`FFmpegCommand`、`FFmpegInput`、`FFmpegOutput` 三个类也会被导出，供需要底层控制的场景使用。它们通过 getter 动态获取，`initPath()` 重新初始化后始终指向最新实例。

```js
const { FFmpegCommand, FFmpegInput, FFmpegOutput } = require('jiaffmpeg');

const cmd = new FFmpegCommand();
cmd.addInput(new FFmpegInput('input.mp4'));
cmd.addOutput(new FFmpegOutput('output.mp4', { 'c:v': 'libx264' }));
await cmd.execute();
```

## 测试

```bash
npm test
```

运行基于 Node.js 内置 `node:test` 的单元测试，覆盖编码器检查、转码及初始化等场景。

## License

MIT
