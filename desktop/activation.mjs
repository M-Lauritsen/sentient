import { execFile as execFileCallback, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const DISCOVER = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$folders = @(
  [Environment]::GetFolderPath('DesktopDirectory'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Brave Apps'),
  (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Brave Apps')
)
$items = @()
foreach ($folder in ($folders | Select-Object -Unique)) {
  if (-not (Test-Path -LiteralPath $folder -PathType Container)) { continue }
  foreach ($file in (Get-ChildItem -LiteralPath $folder -Filter 'SENTIENT OS*.lnk' -File)) {
    $link = $shell.CreateShortcut($file.FullName)
    $items += @{ target = $link.TargetPath; arguments = $link.Arguments }
    if ($items.Count -gt 16) { throw 'Too many shortcuts' }
  }
}
ConvertTo-Json -InputObject $items -Compress
`;

export function desktopError(code) {
	return Object.assign(new Error(code), { code });
}

export function parseBrowserArguments(args) {
	if (args.length === 0) return 'brave';
	if (args.length === 2 && args[0] === '--browser' && args[1] === 'brave') return 'brave';
	if (args.length === 2 && args[0] === '--browser' && ['edge', 'chrome'].includes(args[1])) {
		throw desktopError('APP_ACTIVATION_UNAVAILABLE');
	}
	throw desktopError('USAGE');
}

export function validateShortcut(shortcut, executableCandidates) {
	if (!shortcut || typeof shortcut.target !== 'string' || typeof shortcut.arguments !== 'string' ||
		shortcut.target.length > 1024 || shortcut.arguments.length > 1024 ||
		!executableCandidates.some((candidate) =>
			path.win32.normalize(candidate).toLowerCase() === path.win32.normalize(shortcut.target).toLowerCase())) {
		throw desktopError('APP_ACTIVATION_UNAVAILABLE');
	}
	// Only the two fields observed in the browser-created shortcut are accepted.
	const profilePattern = '--profile-directory=(?:"(Default|Profile [1-9][0-9]{0,3})"|(Default))';
	const appPattern = '--app-id=([a-p]{32})';
	const profile = shortcut.arguments.match(new RegExp(`(?:^|\\s)${profilePattern}(?=\\s|$)`, 'u'));
	const app = shortcut.arguments.match(new RegExp(`(?:^|\\s)${appPattern}(?=\\s|$)`, 'u'));
	if (!profile || !app || shortcut.arguments.replace(profile[0], '').replace(app[0], '').trim() !== '') {
		throw desktopError('APP_ACTIVATION_UNAVAILABLE');
	}
	return {
		executable: shortcut.target,
		profile: profile[1] ?? profile[2],
		appId: app[1],
		args: [`--profile-directory=${profile[1] ?? profile[2]}`, `--app-id=${app[1]}`],
	};
}

export async function selectActivation(shortcuts, {
	executableCandidates,
	userDataRoot,
	inspect = stat,
}) {
	if (!Array.isArray(shortcuts) || shortcuts.length > 16) throw desktopError('APP_ACTIVATION_UNAVAILABLE');
	const selected = new Map();
	for (const shortcut of shortcuts) {
		// Do not select another browser when the same app is installed in several browsers.
		if (!executableCandidates.some((candidate) =>
			typeof shortcut?.target === 'string' &&
			path.win32.normalize(candidate).toLowerCase() === path.win32.normalize(shortcut.target).toLowerCase())) continue;
		const activation = validateShortcut(shortcut, executableCandidates);
		selected.set(`${activation.executable.toLowerCase()}\0${activation.profile}\0${activation.appId}`, activation);
	}
	if (selected.size !== 1) throw desktopError('APP_ACTIVATION_UNAVAILABLE');
	const activation = selected.values().next().value;
	const checked = async (file, kind, code) => {
		try {
			const info = await inspect(file);
			if (!info[kind]()) throw desktopError(code);
		} catch (error) {
			if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error?.code)) throw desktopError(code);
			throw error;
		}
	};
	await checked(activation.executable, 'isFile', 'BROWSER_UNAVAILABLE');
	await checked(path.win32.join(userDataRoot, activation.profile), 'isDirectory', 'APP_ACTIVATION_UNAVAILABLE');
	await checked(path.win32.join(userDataRoot, activation.profile, 'Web Applications', `_crx_${activation.appId}`),
		'isDirectory', 'APP_ACTIVATION_UNAVAILABLE');
	return activation;
}

export async function discoverActivation({ env = process.env, run = execFile, inspect = stat } = {}) {
	if (!env.LOCALAPPDATA || !env.SystemRoot) throw desktopError('APP_ACTIVATION_UNAVAILABLE');
	const executableCandidates = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]
		.filter(Boolean).map((root) => path.win32.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'chrome_proxy.exe'));
	let shortcuts;
	try {
		const result = await run(path.win32.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
			['-NoProfile', '-NonInteractive', '-Command', DISCOVER],
			{ timeout: 10_000, maxBuffer: 32 * 1024, windowsHide: true, encoding: 'utf8' });
		shortcuts = JSON.parse(result.stdout.replace(/^\uFEFF/u, '').trim());
	} catch {
		throw desktopError('APP_ACTIVATION_UNAVAILABLE');
	}
	return selectActivation(shortcuts, {
		executableCandidates,
		userDataRoot: path.win32.join(env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data'),
		inspect,
	});
}

export function dispatchInstalledApp(activation, { createProcess = spawn, timeoutMs = 10_000 } = {}) {
	return new Promise((resolve, reject) => {
		let child;
		let timer;
		const finish = (error) => {
			clearTimeout(timer);
			child?.removeListener('error', onError);
			child?.removeListener('spawn', onSpawn);
			if (error) reject(error);
			else resolve();
		};
		const onError = () => finish(desktopError('BROWSER_LAUNCH_FAILED'));
		const onSpawn = () => {
			child.unref?.();
			// Browser exit and window closure are deliberately not observed.
			finish();
		};
		try {
			child = createProcess(activation.executable, activation.args, {
				shell: false, detached: false, windowsHide: false, stdio: 'ignore',
			});
			child.once('error', onError);
			child.once('spawn', onSpawn);
			timer = setTimeout(() => finish(desktopError('BROWSER_LAUNCH_FAILED')), timeoutMs);
		} catch {
			finish(desktopError('BROWSER_LAUNCH_FAILED'));
		}
	});
}
