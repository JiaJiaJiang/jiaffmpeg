const ffprobe = require('ffprobe-client');

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
		ffprobePath = paths.ffprobe;
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

async function transcode(inputPath, inputOptions, outputPath, outputOptions, events) {
	const { FFmpegCommand, FFmpegInput, FFmpegOutput } = getFessonia();
	const inputOptionsMap = normalizeOptions(inputOptions);
	const outputOptionsMap = normalizeOptions(outputOptions);
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
		const ffin = new FFmpegInput(inputPath, inputOptionsMap);
		const ffout = new FFmpegOutput(outputPath, outputOptionsMap);
		cmd.addInput(ffin);
		cmd.addOutput(ffout);
		if (events && typeof events.spawn === 'function') {
			events.spawn({ command: cmd.toString() });//自定义事件，通知外部最终执行的指令
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

module.exports = {
	ffprobe,
	initPath,
	checkVideoEncoder,
	checkAudioEncoder,
	transcode
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
