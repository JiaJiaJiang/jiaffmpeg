const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('./index.js');

// ffmpeg / ffprobe 路径，优先使用环境变量，否则使用默认路径
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'C:/files/programs/ffmpeg/ffmpeg.exe';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'C:/files/programs/ffmpeg/ffprobe.exe';

const TEST_OUTPUT = path.join(__dirname, 'test_out.mp4');

before(() => {
	lib.initPath({ ffmpeg: FFMPEG_PATH, ffprobe: FFPROBE_PATH });
});

after(() => {
	// 清理测试产生的临时文件
	if (fs.existsSync(TEST_OUTPUT)) {
		fs.unlinkSync(TEST_OUTPUT);
	}
});

test('initPath 后 fessonia 类 getter 可用', () => {
	assert.strictEqual(typeof lib.FFmpegCommand, 'function');
	assert.strictEqual(typeof lib.FFmpegInput, 'function');
	assert.strictEqual(typeof lib.FFmpegOutput, 'function');
});

test('checkVideoEncoder 对可用编码器返回 true', async () => {
	assert.strictEqual(await lib.checkVideoEncoder('libx264'), true);
});

test('checkVideoEncoder 对不可用编码器返回 false', async () => {
	assert.strictEqual(await lib.checkVideoEncoder('nonexistent_vcodec'), false);
});

test('checkAudioEncoder 对可用编码器返回 true', async () => {
	assert.strictEqual(await lib.checkAudioEncoder('aac'), true);
});

test('checkAudioEncoder 对不可用编码器返回 false', async () => {
	assert.strictEqual(await lib.checkAudioEncoder('nonexistent_acodec'), false);
});

test('transcode 成功转码并触发事件', async () => {
	let spawnCalled = false;
	let successCalled = false;
	let updateCalled = false;

	await lib.transcode(
		'testsrc=duration=1:size=64x64:rate=10',
		{ f: 'lavfi' },
		TEST_OUTPUT,
		{ 'c:v': 'libx264', y: null },
		{
			update: () => { updateCalled = true; },
			spawn: () => { spawnCalled = true; },
			success: () => { successCalled = true; }
		}
	);

	assert.strictEqual(spawnCalled, true, 'spawn 自定义事件应被触发');
	assert.strictEqual(successCalled, true, 'success 事件应被触发');
	assert.strictEqual(fs.existsSync(TEST_OUTPUT), true, '转码输出文件应存在');
});

test('transcode 支持 Map 类型的 options', async () => {
	const inputOptions = new Map([['f', 'lavfi']]);
	const outputOptions = new Map([['c:v', 'libx264'], ['y', null]]);

	await lib.transcode(
		'testsrc=duration=1:size=64x64:rate=10',
		inputOptions,
		TEST_OUTPUT,
		outputOptions
	);

	assert.strictEqual(fs.existsSync(TEST_OUTPUT), true, '转码输出文件应存在');
});

test('未初始化时调用 fessonia 功能应报错', async () => {
	// 保存原始环境变量，临时清空以模拟未初始化状态
	const origFfmpeg = process.env.FFMPEG_PATH;
	const origFfprobe = process.env.FFPROBE_PATH;
	delete process.env.FFMPEG_PATH;
	delete process.env.FFPROBE_PATH;

	// 清除模块缓存，重新加载一个未初始化的模块实例
	const modulePath = require.resolve('./index.js');
	delete require.cache[modulePath];
	const cleanLib = require('./index.js');

	// 未初始化时，getter 同步抛错
	assert.throws(() => cleanLib.FFmpegCommand, /not initialized/);
	// checkVideoEncoder 是 async 方法，错误在 Promise 中，使用 assert.rejects
	await assert.rejects(cleanLib.checkVideoEncoder('libx264'), /not initialized/);

	// 恢复环境变量并清除缓存，避免影响后续测试
	if (origFfmpeg !== undefined) {
		process.env.FFMPEG_PATH = origFfmpeg;
	}
	if (origFfprobe !== undefined) {
		process.env.FFPROBE_PATH = origFfprobe;
	}
	delete require.cache[modulePath];
	require('./index.js');
});
