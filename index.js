const ffprobe = require('ffprobe-client');
const sharp = require('sharp');
const { execFile } = require('child_process');
const fs = require('fs');
const fsP = require('fs/promises');
const os = require('os');
const path = require('path');

// 可执行文件路径，默认从环境变量读取，可通过 initPath 手动设置
let ffmpegPath = process.env.FFMPEG_PATH;
let ffprobePath = process.env.FFPROBE_PATH;

// fessonia 实例，未初始化时为 null
let fessonia = null;

/**
 * 根据当前保存的路径初始化 fessonia 实例
 * @throws {Error} 当 ffmpeg 或 ffprobe 路径未设置时抛出
 */
function initFessonia() {
	if (!ffmpegPath) {
		throw new Error('FFMPEG_PATH must be set via initPath() or FFMPEG_PATH environment variable');
	}
	if (!ffprobePath) {
		throw new Error('FFPROBE_PATH must be set via initPath() or FFPROBE_PATH environment variable');
	}
	fessonia = require('@tedconf/fessonia')({
		ffmpeg_bin: ffmpegPath,
		ffprobe_bin: ffprobePath,
		// debug: true,
		log_warnings: true
	});
}

/**
 * 获取当前有效的 fessonia 实例
 * @returns {object} fessonia 实例
 * @throws {Error} 当实例尚未初始化时抛出
 */
function getFessonia() {
	if (!fessonia) {
		throw new Error('fessonia is not initialized, call initPath() first');
	}
	return fessonia;
}

/**
 * 手动设置 ffmpeg / ffprobe 可执行文件路径并重新初始化
 * @param {object} paths 路径配置
 * @param {string} [paths.ffmpeg] ffmpeg 可执行文件路径
 * @param {string} [paths.ffprobe] ffprobe 可执行文件路径
 */
function initPath(paths = {}) {
	if (paths.ffmpeg) {
		ffmpegPath = paths.ffmpeg;
	}
	if (paths.ffprobe) {
		process.env.FFPROBE_PATH = ffprobePath = paths.ffprobe;
	}
	initFessonia();
}

// 模块加载时，若环境变量已设置路径则自动初始化，否则保持未初始化状态
if (ffmpegPath && ffprobePath) {
	initFessonia();
}

// 全局任务 id 计数器，用于为每个转码命令分配唯一 id
let nextTaskId = 0;

/**
 * 将选项参数规范化为 Map 对象
 * 传入对象时转换为 Map，传入 Map 时原样返回
 * @param {object|Map} options 选项参数
 * @returns {Map<string, *>} Map 对象
 */
function normalizeOptions(options) {
	if (options instanceof Map) {
		return options;
	}
	if (options && typeof options === 'object') {
		return new Map(Object.entries(options));
	}
	return new Map();
}

/**
 * 将选项 Map 展开为 [name, arg] 数组列表
 * 数组值会拆成多个同名参数，例如 'map': ['0:0','0:1'] -> [['map','0:0'],['map','0:1']]
 * @param {object|Map} options 选项参数
 * @returns {Array<[string, *]>} 展开后的 [name, arg] 列表
 */
function expandOptions(options) {
	const map = normalizeOptions(options);
	const expanded = [];
	for (const [name, arg] of map) {
		if (Array.isArray(arg)) {
			for (const item of arg) {
				expanded.push([name, item]);
			}
		} else {
			expanded.push([name, arg]);
		}
	}
	return expanded;
}

/**
 * 将展开后的 [name, arg] 列表添加到 FFmpegInput / FFmpegOutput 上
 * @param {object} entity FFmpegInput 或 FFmpegOutput 实例
 * @param {Array<[string, *]>} expanded 展开后的 [name, arg] 列表
 */
function addExpandedOptions(entity, expanded) {
	for (const [name, arg] of expanded) {
		if (typeof entity.addOptions === 'function') {
			// FFmpegOutput 等支持 addOptions 的对象
			entity.addOptions(new Map([[name, arg]]));
		} else {
			// FFmpegInput 没有 addOptions 方法，直接往 options 数组追加
			const FFmpegOption = entity.constructor._loadFFmpegOption();
			entity.options.push(new FFmpegOption(name, arg));
		}
	}
}

async function transcode(inputPath, inputOptions, outputPath, outputOptions, events, dryRun = false) {
	const { FFmpegCommand, FFmpegInput, FFmpegOutput } = getFessonia();
	const cmd = new FFmpegCommand();
	// 为命令分配全局唯一 id
	cmd.taskId = nextTaskId++;
	// 若传入了事件监听器，则绑定到命令对应的事件上
	if (events && typeof events.update === 'function') {
		cmd.on('update', events.update);//事件参数(data)
	}
	if (events && typeof events.success === 'function') {
		cmd.on('success', events.success);//事件参数(data)
	}
	if (events && typeof events.error === 'function') {
		cmd.on('error', events.error);//事件参数(err)
	}
	return new Promise((resolve, reject) => {
		const ffin = new FFmpegInput(inputPath);
		const ffout = new FFmpegOutput(outputPath);
		// 展开数组值，支持重复名称参数（如多个 -map）
		addExpandedOptions(ffin, expandOptions(inputOptions));
		addExpandedOptions(ffout, expandOptions(outputOptions));
		cmd.addInput(ffin);
		cmd.addOutput(ffout);
		if (events && typeof events.spawn === 'function') {
			events.spawn({ command: cmd.toString() });//自定义事件，通知外部最终执行的指令
		}
		if (dryRun) {
			// dryRun 模式：只给出最终命令，不实际运行
			resolve({ dryRun: true, command: cmd.toString() });
			return;
		}
		cmd.on('success', resolve);
		cmd.on('error', reject);
		cmd.spawn();
	});
}

/**
 * 检查视频编码器是否真正可用
 * @param {string} codec 视频编码器名称，例如 'libx264'
 * @returns {Promise<boolean>} 编码器可用返回 true，否则返回 false
 */
async function checkVideoEncoder(codec) {
	const { FFmpegCommand, FFmpegInput, FFmpegOutput } = getFessonia();
	const input = new FFmpegInput('nullsrc=s=16x16:d=0.1', { f: 'lavfi' });
	const output = new FFmpegOutput('-', {
		'c:v': codec,
		'frames:v': 1,
		f: 'null'
	});
	const command = new FFmpegCommand();
	command.addInput(input);
	command.addOutput(output);
	try {
		await command.execute();
		return true;
	} catch (err) {
		return false;
	}
}

/**
 * 检查音频编码器是否真正可用
 * @param {string} codec 音频编码器名称，例如 'aac'
 * @returns {Promise<boolean>} 编码器可用返回 true，否则返回 false
 */
async function checkAudioEncoder(codec) {
	const { FFmpegCommand, FFmpegInput, FFmpegOutput } = getFessonia();
	const input = new FFmpegInput('anullsrc=r=44100:cl=mono', { f: 'lavfi' });
	const output = new FFmpegOutput('-', {
		'c:a': codec,
		t: 0.1,
		f: 'null'
	});
	const command = new FFmpegCommand();
	command.addInput(input);
	command.addOutput(output);
	try {
		await command.execute();
		return true;
	} catch (err) {
		return false;
	}
}

/**
	* 探测视频元信息，返回包含视频流 / 音频流分类的标准 ffprobe JSON
	* @param {string} filePath 视频文件路径
	* @returns {Promise<object>} 包含 videoStreams / audioStreams 的元信息对象
	*/
async function videoMeta(filePath) {
	const data = await ffprobe(filePath);
	const videoStreams = [], audioStreams = [];
	for (const s of data.streams) {
		if (s.codec_type === 'video' && s.width && s.height) {
			videoStreams.push(s);
		} else if (s.codec_type === 'audio') {
			audioStreams.push(s);
		}
	}
	return {
		...data,
		videoStreams,
		audioStreams,
	};
}

/**
	* 生成临时文件路径
	* @param {string} ext 文件扩展名（不带点）
	* @returns {string} 临时文件绝对路径
	*/
function genTmpFilePath(ext) {
	return path.resolve(os.tmpdir(), 'jiaffmpeg', `${Date.now()}-${Math.random().toFixed(5)}.${ext}`);
}

/**
	* 用 ffprobe 获取前 N 个关键帧的精确时间戳（秒）
	* 这里直接用 child_process 调用 ffprobe CLI，因为 ffprobe-client 不支持 -show_entries packet 级别过滤
	* @param {string} filePath 视频文件路径
	* @param {number} [limit=10] 最多返回的关键帧数量
	* @param {number} [startTime=0] 起始时间（秒），只返回该时间点之后的关键帧
	* @returns {Promise<number[]>} 关键帧时间戳数组（秒）
	*/
function getKeyframeTimestamps(filePath, limit = 10, startTime = 0) {
	return new Promise((resolve, reject) => {
		execFile(ffprobePath || 'ffprobe', [
			'-v', 'error',
			'-select_streams', 'v:0',
			'-show_entries', 'packet=pts_time,flags',
			'-of', 'csv=p=0',
			filePath
		], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
			if (err) { reject(err); return; }
			const timestamps = [];
			for (const line of stdout.trim().split('\n')) {
				if (!line) continue;
				const parts = line.split(',');
				if (parts.length >= 2 && parts[1].includes('K')) {
					const t = parseFloat(parts[0]);
					if (t < startTime) continue;
					timestamps.push(t);
					if (timestamps.length >= limit) break;
				}
			}
			resolve(timestamps);
		});
	});
}

/**
	* 从指定时间点提取单帧，直接返回图片 buffer（不落盘）
	* 通过 ffmpeg 输出到 stdout（image2pipe / mjpeg）实现
	* @param {string} filePath 视频文件路径
	* @param {number} timeSec 时间点（秒）
	* @returns {Promise<Buffer|null>} 图片 buffer，失败返回 null
	*/
function extractFrameAt(filePath, timeSec) {
	return new Promise((resolve) => {
		execFile(ffmpegPath || 'ffmpeg', [
			'-ss', String(timeSec),
			'-i', filePath,
			'-frames:v', '1',
			'-f', 'image2pipe',
			'-vcodec', 'mjpeg',
			'-'
		], { maxBuffer: 50 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => {
			if (err || !stdout || !stdout.length) {
				resolve(null);
				return;
			}
			resolve(stdout);
		});
	});
}

/**
 * 以指定并发数执行异步任务，返回按输入顺序排列的结果
 * @param {Array<*>} items 输入项
 * @param {number} concurrency 最大并发数
 * @param {Function} mapper 异步处理函数，接收 (item, index)，返回 Promise
 * @returns {Promise<Array<*>>} 结果数组（与 items 顺序一致）
 */
async function mapLimit(items, concurrency, mapper) {
	const results = new Array(items.length);
	let nextIndex = 0;
	async function worker() {
		while (nextIndex < items.length) {
			const i = nextIndex++;
			results[i] = await mapper(items[i], i);
		}
	}
	const workers = [];
	const n = Math.min(concurrency, items.length);
	for (let w = 0; w < n; w++) {
		workers.push(worker());
	}
	await Promise.all(workers);
	return results;
}

/**
	* 安全删除临时文件
	* @param {string} f 文件路径
	*/
async function safeUnlink(f) {
	try { await fsP.unlink(f); } catch (_) {/*  */ }
}

/**
	* 检测图片质量，返回一个代表图片质量的分数（分数越高质量越好）
	* 默认实现：根据图片的 entropy 和 sharpness 加权求和（entropy 80% + sharpness 20%）
	* 非 relaxMode 下，entropy < 4 或 sharpness < 0.3 时分数为 0
	* @param {string|Buffer} image 图片文件路径或图片 buffer
	* @param {boolean} [relaxMode=false] 是否放宽质量要求（跳过阈值过滤）
	* @returns {Promise<number>} 图片质量分数
	*/
async function checkImageQuality(image, relaxMode = false) {
	try {
		const sharpObj = sharp(image);
		const stats = await sharpObj.stats();
		const { entropy, sharpness } = stats;
		console.log({ entropy, sharpness });
		if (!relaxMode && (entropy < 5 || sharpness < Math.max(0.12, (Math.min(7, entropy) / 7 * 0.22)))) {
			return 0;
		}
		return entropy * 0.6 + sharpness * 0.4;
	} catch (_) {
		return 0;
	}
}

/**
	* 提取视频预览图（三级降级策略）
	* 第一级：提取前 30 个关键帧，按图片质量分数取最大的那个；若分数都为 0 进入第二级
	* 第二级：视频前 30 秒内每隔 1 秒采样一帧，评分与处理方式同第一级
	* 第三级：取视频第一帧、中间帧和最后一帧，用 relaxMode 评分取分最高者；若全为 0 则取中间帧兜底
	* @param {string} filePath 视频文件路径
	* @param {object} [options] 选项
	* @param {Function} [options.checkImageQuality] 图片质量评分函数，默认使用内置实现
	* @returns {Promise<Buffer>} 预览图 buffer
	*/
async function extractVideoPreview(filePath, options = {}) {
	const scoreFn = options.checkImageQuality || checkImageQuality;
	const tmpFiles = [];
	const t0 = Date.now();
	const log = (msg) => console.log(`[Preview][+${((Date.now() - t0) / 1000).toFixed(2)}s] ${msg}`);

	// 帧提取并发数
	const CONCURRENCY = 4;

	try {
		// ========== 第一级：根据视频文件大小分流 ==========
		// 小文件(<100MB)：用 ffprobe 枚举关键帧（快且关键帧质量好）
		// 大文件(>=100MB)：用 ffmpeg -ss 快速 seek 均匀采样（避免 ffprobe 全量 packet 扫描）
		log('L1: 开始 videoMeta');
		const meta = await videoMeta(filePath);
		const duration = parseFloat(meta.format?.duration) || 0;
		log(`L1: videoMeta 完成, duration=${duration}s`);

		// 获取文件大小（字节）
		const fileSize = (await fsP.stat(filePath)).size;
		const SMALL_FILE_LIMIT = 100 * 1024 * 1024; // 100MB
		log(`L1: 文件大小 ${(fileSize / 1024 / 1024).toFixed(1)}MB`);

		let l1Times;
		if (fileSize < SMALL_FILE_LIMIT) {
			// 小文件：枚举关键帧；若为长视频(>15分钟)也跳过开头 5 分钟
			const kfStart = duration > 15 * 60 ? 5 * 60 : 0;
			log(`L1: 小文件，使用关键帧枚举 (start=${kfStart}s)`);
			l1Times = await getKeyframeTimestamps(filePath, 30, kfStart);
			log(`L1: 关键帧枚举完成, ${l1Times.length} keyframes`);
		} else {
			// 大文件：跳过开头 5 分钟（片头/广告/黑屏），用 -ss 快速 seek 均匀采样
			const start = 5 * 60;
			const sampleCount = 30;
			const step = Math.max(1, (duration - start) / sampleCount);
			l1Times = Array.from({ length: sampleCount }, (_, i) => start + i * step);
			log(`L1: 大文件，-ss 快速 seek 采样 ${l1Times.length} 帧 (start=${start}s, step=${step.toFixed(1)}s)`);
		}

		// 顺序采样 + 早停：遇到第一个分数不为 0 的帧就直接返回
		// （避免并行采样所有帧，通常只需 1-2 帧即可得到结果，大幅提速）
		for (const t of l1Times) {
			const frame = await extractFrameAt(filePath, t);
			if (!frame) continue;
			const score = await scoreFn(frame, false);
			console.log(`[Preview] L1@${t.toFixed(1)}s score=${score.toFixed(3)}`);
			if (score > 0) {
				log(`L1: 命中合格帧，提前返回`);
				return frame;
			}
		}
		log(`L1: 所有采样帧分数均为 0`);

		// ========== 第二级：前 30 秒内每秒采样（顺序 + 早停） ==========
		console.log('[Preview] L2: sample every 1s in first 30s');
		const l2Times = Array.from({ length: 30 }, (_, i) => i);
		for (const t of l2Times) {
			const frame = await extractFrameAt(filePath, t);
			if (!frame) continue;
			const score = await scoreFn(frame, false);
			console.log(`[Preview] L2@${t}s score=${score.toFixed(3)}`);
			if (score > 0) {
				log(`L2: 命中合格帧，提前返回`);
				return frame;
			}
		}
		log(`L2: 所有采样帧分数均为 0`);

		// ========== 第三级：首帧 / 中间帧 / 末帧 relaxMode 评分（4 并发） ==========
		console.log('[Preview] L3: first/middle/last frame with relaxMode');
		const candidates = [0, duration / 2, Math.max(0, duration - 0.1)];
		const l3Results = await mapLimit(candidates, CONCURRENCY, async (t) => {
			const frame = await extractFrameAt(filePath, t);
			if (!frame) return null;
			const score = await scoreFn(frame, true);
			console.log(`[Preview] L3@${t.toFixed(3)}s score=${score.toFixed(3)}`);
			return { buffer: frame, score };
		});

		best = l3Results.reduce((acc, r) => {
			if (r && r.score > acc.score) return r;
			return acc;
		}, { buffer: null, score: -1 });
		// 若所有分数都为 0，则取中间帧作为兜底
		if (!best.buffer) {
			best.buffer = await extractFrameAt(filePath, duration / 2);
		}

		if (!best.buffer) {
			throw new Error('未找到合适的样图:' + filePath);
		}
		return best.buffer;

	} finally {
		await Promise.all(tmpFiles.map(safeUnlink));
	}
}

/**
	* 均匀采样视频帧，用于提取视频中指定时间间隔或帧间隔的图片
	* 支持通过接收函数处理提取的图片（图片以 buffer 形式传入）
	* @param {string} filePath 视频文件路径
	* @param {object} [options] 采样选项
	* @param {number} [options.interval] 时间间隔（秒），与 frameInterval 二选一，优先于 frameInterval
	* @param {number} [options.frameInterval] 帧间隔（帧数），需要视频帧率信息
	* @param {number} [options.start=0] 起始时间（秒）
	* @param {number} [options.end] 结束时间（秒），默认到视频末尾
	* @param {Function} [handler] 接收函数，每提取一帧调用一次，参数为 (buffer, timeSec)
	* @returns {Promise<number>} 成功提取的帧数
	*/
async function sampleVideoFrames(filePath, options = {}, handler) {
	const meta = await videoMeta(filePath);
	const duration = parseFloat(meta.format?.duration) || 0;
	if (duration <= 0) throw new Error('无法获取视频时长:' + filePath);

	let step;
	if (options.interval) {
		step = options.interval;
	} else if (options.frameInterval) {
		const fps = parseFloat(meta.videoStreams[0]?.avg_frame_rate?.split('/')[0]) || 0;
		if (!fps) throw new Error('无法获取视频帧率:' + filePath);
		step = options.frameInterval / fps;
	} else {
		throw new Error('必须指定 interval 或 frameInterval');
	}

	const start = options.start || 0;
	const end = options.end != null ? Math.min(options.end, duration) : duration;
	let count = 0;
	for (let t = start; t < end; t += step) {
		const frame = await extractFrameAt(filePath, t);
		if (!frame) continue;
		count++;
		if (typeof handler === 'function') {
			await handler(frame, t);
		}
	}
	return count;
}

module.exports = {
	ffprobe,
	initPath,
	checkVideoEncoder,
	checkAudioEncoder,
	transcode,
	videoMeta,
	getKeyframeTimestamps,
	checkImageQuality,
	extractVideoPreview,
	sampleVideoFrames
};

// 通过 getter 动态导出 fessonia 的类，保证 initPath 重新初始化后始终指向最新实例
Object.defineProperty(module.exports, 'FFmpegCommand', {
	enumerable: true,
	get() {
		return getFessonia().FFmpegCommand;
	}
});
Object.defineProperty(module.exports, 'FFmpegInput', {
	enumerable: true,
	get() {
		return getFessonia().FFmpegInput;
	}
});
Object.defineProperty(module.exports, 'FFmpegOutput', {
	enumerable: true,
	get() {
		return getFessonia().FFmpegOutput;
	}
});
