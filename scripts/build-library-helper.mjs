import { buildLibraryHelper } from '../copilot/library-native.mjs';

try {
  await buildLibraryHelper();
  console.log('Windows Library helper built from maintained source (local build only).');
} catch (error) {
  console.error(error.code || 'HELPER_BUILD_FAILED');
  if (error.diagnostics) console.error(error.diagnostics);
  process.exitCode = 1;
}
