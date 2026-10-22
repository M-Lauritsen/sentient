import { serveOwnedChild } from '../../desktop/server-child.mjs';
import path from 'node:path';

serveOwnedChild({
	serverOptions: {
		activityRoot: process.env.SENTIENT_FIXTURE_ROOT,
		libraryRoot: process.env.SENTIENT_FIXTURE_ROOT,
		librarySettingsPath: path.join(process.env.SENTIENT_FIXTURE_ROOT, 'settings.json'),
		port: Number(process.env.SENTIENT_FIXTURE_PORT ?? 0),
		pollIntervalMs: 0,
	},
	lifecycleOptions: {
		limits: {
			initialGraceMs: Number(process.env.SENTIENT_FIXTURE_INITIAL_MS ?? 3000),
			leaseTtlMs: 500, emptyGraceMs: 60,
		},
	},
});
