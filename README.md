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

### `evalFrameRate(rateStr)`

解析 ffprobe 的帧率字符串，如 `"30000/1001"` → `29.97`。

- `rateStr`：帧率字符串
- 返回：`number` 帧率数值，无法解析时返回 `0`

```js
const fps = jiaffmpeg.evalFrameRate('30000/1001');
console.log(fps); // 29.97
```

### `calcDataDensity(stream)`

计算视频流数据密度（`bit_rate / (fps * width * height)`），用于判断视频是否需要压缩。

- `stream`：视频流信息对象
- 返回：`number` 数据密度，无法计算时返回 `0`

```js
const density = jiaffmpeg.calcDataDensity(videoStream);
console.log('数据密度:', density);
```

### `getLargestVideoStream(streams)`

获取视频中最大的视频流（按宽高乘积比较）。

- `streams`：流数组
- 返回：`object|null` 最大的视频流，无视频流时返回 `null`

```js
const largest = jiaffmpeg.getLargestVideoStream(info.streams);
```

### `getFirstAudioStream(streams)`

获取第一个音频流。

- `streams`：流数组
- 返回：`object|null` 第一个音频流，无音频流时返回 `null`

```js
const audio = jiaffmpeg.getFirstAudioStream(info.streams);
```

### `selectVideoEncoder(codecType, candidatesMap)`

按候选编码器顺序选择可用的视频编码器，返回第一个可用的；都不可用返回 `null`。

- `codecType`：目标编码类型 `'h265'` 或 `'h264'`
- `candidatesMap`：可选，候选编码器映射，默认 h265/h264 各含 nvenc、qsv、amf、libx 顺序
- 返回：`Promise<string|null>` 可用的编码器名称

```js
const encoder = await jiaffmpeg.selectVideoEncoder('h265');
console.log('可用编码器:', encoder); // 如 'hevc_nvenc'
```

### `buildOutputOptions(videoStream, audioStream, videoEncoder, videoOpts, audioOpts, useHardware)`

构建转码输出选项，**根据编码器类型自动适配参数**（nvenc / amf / qsv / libx 各编码器支持的参数不同）。

- `videoStream`：视频流
- `audioStream`：音频流（可为 `null`）
- `videoEncoder`：视频编码器名称
- `videoOpts`：视频转码参数对象
  - `quantizationQuality`：量化质量（libx 用 `crf`，nvenc 用 `constqp+qp`，amf 用 `cqp+qp_i/qp_p`，qsv 用 `global_quality`）
  - `qualityGap`：质量差距（允许的最差质量值）
  - `profile`：编码 profile（如 `main`）
  - `minKeyframeInterval`：关键帧间隔
  - `sceneChangeThreshold`：场景变化阈值（仅软件编码器）
  - `fpsMode`：帧率模式
  - `hardwareDecoder`：是否使用硬件解码
- `audioOpts`：音频转码参数对象（`targetCodec`、`quality`、`bitrate`）
- `useHardware`：是否使用硬件编码
- 返回：`Map<string, *>` 输出选项

```js
const opts = jiaffmpeg.buildOutputOptions(
  videoStream, audioStream, 'hevc_nvenc',
  { quantizationQuality: 23, qualityGap: 13, profile: 'main' },
  { targetCodec: 'aac', quality: 1 },
  true
);
```

### `transcodeVideo(src, dest, videoStream, audioStream, videoEncoder, videoOpts, audioOpts, useHardware, onProgress)`

执行视频转码（自动构建输出选项并映射视频/音频流）。

- `src`：源文件路径
- `dest`：目标文件路径
- `videoStream`：视频流
- `audioStream`：音频流（可为 `null`）
- `videoEncoder`：视频编码器名称
- `videoOpts`：视频转码参数（见 `buildOutputOptions`）
- `audioOpts`：音频转码参数
- `useHardware`：是否使用硬件编码
- `onProgress`：可选，进度回调 `(data) => {}`
- 返回：`Promise<object>` 转码结果

```js
await jiaffmpeg.transcodeVideo(
  'input.mp4', 'output.mp4',
  videoStream, audioStream, 'hevc_nvenc',
  { quantizationQuality: 23 }, { targetCodec: 'aac' },
  true,
  (data) => console.log('进度:', data)
);
```

### `probeMedia(filePath)`

用 ffprobe 解析媒体文件，返回标准 ffprobe JSON。无法解析时抛出异常（可用于扫描时判断文件是否有效）。

- `filePath`：媒体文件路径
- 返回：`Promise<object>` ffprobe 结果

```js
try {
  const info = await jiaffmpeg.probeMedia('input.mp4');
  console.log('解析成功');
} catch (e) {
  console.log('无法解析，跳过处理');
}
```

### `verifyTranscodedFile(filePath)`

校验转码目标文件：能被 ffprobe 正确解析，且至少有一个音频或视频轨道。

- `filePath`：目标文件路径
- 返回：`Promise<boolean>` 校验通过返回 `true`，否则返回 `false`
- 注意：若找不到 ffprobe 二进制（`err.code === 'ENOENT'`），会**抛出错误**（环境问题），而不是返回 `false`，以便调用方区分"环境问题"和"文件无效"

```js
try {
  const valid = await jiaffmpeg.verifyTranscodedFile('output.mp4');
  if (!valid) {
    console.log('转码结果无效');
  }
} catch (e) {
  if (e.code === 'ENOENT') {
    console.log('找不到 ffprobe 二进制，请检查配置');
  }
}
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
