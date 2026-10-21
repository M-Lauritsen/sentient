import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseBrowserArguments, validateShortcut, selectActivation, dispatchInstalledApp } from '../desktop/activation.mjs';

const executable = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\chrome_proxy.exe';
const appId = 'abcdefghijklmnopabcdefghijklmnop';
const shortcut = (profile = 'Default') => ({
	target: executable, arguments: `--profile-directory="${profile}" --app-id=${appId}`,
});
const options = {
	executableCandidates: [executable],
	userDataRoot: 'C:\\Synthetic Data\\Brave',
	inspect: async () => ({ isFile: () => true, isDirectory: () => true }),
};

test('Brave-only CLI defaults explicitly and never silently substitutes browsers', () => {
	assert.equal(parseBrowserArguments([]), 'brave');
	assert.equal(parseBrowserArguments(['--browser', 'brave']), 'brave');
	for (const browser of ['chrome', 'edge']) {
		assert.throws(() => parseBrowserArguments(['--browser', browser]), { code: 'APP_ACTIVATION_UNAVAILABLE' });
	}
	for (const args of [['--port', '0'], ['--browser'], ['--browser', 'brave', 'extra']]) {
		assert.throws(() => parseBrowserArguments(args), { code: 'USAGE' });
	}
});

test('browser-created shortcut fields produce a shell-free argument array with spaces preserved', () => {
	const activation = validateShortcut(shortcut('Profile 2'), [executable]);
	assert.equal(activation.executable, executable);
	assert.deepEqual(activation.args, ['--profile-directory=Profile 2', `--app-id=${appId}`]);
});

test('activation rejects arbitrary commands, duplicate fields, app URLs and unsafe profiles', () => {
	for (const argumentsText of [
		`--profile-directory=Default --app-id=${appId} --app=http://127.0.0.1:43187/`,
		`--profile-directory=Default --app-id=${appId} & calc.exe`,
		`--profile-directory=.. --app-id=${appId}`,
		`--profile-directory=Default --app-id=${appId} --app-id=${appId}`,
		`--profile-directory=Default --app-id=invalid`,
	]) {
		assert.throws(() => validateShortcut({ target: executable, arguments: argumentsText }, [executable]),
			{ code: 'APP_ACTIVATION_UNAVAILABLE' });
	}
	assert.throws(() => validateShortcut({ ...shortcut(), target: 'C:\\other\\chrome_proxy.exe' }, [executable]),
		{ code: 'APP_ACTIVATION_UNAVAILABLE' });
});

test('selection deduplicates identical links but fails closed for missing or ambiguous profiles', async () => {
	assert.equal((await selectActivation([shortcut(), shortcut()], options)).profile, 'Default');
	await assert.rejects(selectActivation([], options), { code: 'APP_ACTIVATION_UNAVAILABLE' });
	await assert.rejects(selectActivation([shortcut(), shortcut('Profile 2')], options), { code: 'APP_ACTIVATION_UNAVAILABLE' });
});

test('missing browser, profile and installed-app markers fail before dispatch without leaking paths', async () => {
	for (const [missing, expected] of [
		[executable, 'BROWSER_UNAVAILABLE'],
		['C:\\Synthetic Data\\Brave\\Default', 'APP_ACTIVATION_UNAVAILABLE'],
		[`C:\\Synthetic Data\\Brave\\Default\\Web Applications\\_crx_${appId}`, 'APP_ACTIVATION_UNAVAILABLE'],
	]) {
		await assert.rejects(selectActivation([shortcut()], {
			...options,
			inspect: async (file) => {
				if (file === missing) throw Object.assign(new Error(`private ${missing}`), { code: 'ENOENT' });
				return options.inspect(file);
			},
		}), (error) => error.code === expected && !error.message.includes('private'));
	}
});

test('dispatch preserves explicit executable and argv and never kills or waits for browser closure', async () => {
	const activation = validateShortcut(shortcut('Profile 2'), [executable]);
	let captured;
	const child = new EventEmitter();
	child.unref = () => {};
	child.kill = () => assert.fail('must not kill a browser');
	await dispatchInstalledApp(activation, {
		createProcess: (file, args, processOptions) => {
			captured = { file, args, processOptions };
			queueMicrotask(() => child.emit('spawn'));
			return child;
		},
	});
	assert.equal(captured.file, executable);
	assert.deepEqual(captured.args, ['--profile-directory=Profile 2', `--app-id=${appId}`]);
	assert.equal(captured.processOptions.shell, false);
	assert.equal(child.listenerCount('exit'), 0);
	assert.equal(child.listenerCount('spawn'), 0);
});

test('failed or stalled dispatch has a bounded sanitized error', async () => {
	for (const event of ['error', null]) {
		await assert.rejects(dispatchInstalledApp(validateShortcut(shortcut(), [executable]), {
			timeoutMs: 10,
			createProcess: () => {
				const child = new EventEmitter();
				if (event) queueMicrotask(() => child.emit(event, new Error('private path')));
				return child;
			},
		}), { code: 'BROWSER_LAUNCH_FAILED', message: 'BROWSER_LAUNCH_FAILED' });
	}
});
