export function createViewport({ window, document, camera, renderer, composer, bloom, getReducedMotion }) {
  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    updateFramingTarget();
    framingWidth = 0;
  });

  // While the Appearance panel covers the right of a wide window, shift the
  // projection so the brain stays centred in the uncovered area.
  const visualSettingsDialog = document.getElementById('visual-settings-dialog');
  const FRAMING_MIN_WIDTH = 900;
  const FRAMING_EASE = 6;
  let framingOpen = false;
  let framingTarget = 0;
  let framingOffset = 0;
  let framingApplied = 0;
  let framingWidth = 0;
  let framingHeight = 0;

  function updateFramingTarget() {
    framingTarget = 0;
    if (!framingOpen || window.innerWidth < FRAMING_MIN_WIDTH) return;
    const panelWidth = visualSettingsDialog.getBoundingClientRect().width;
    if (panelWidth > 0 && panelWidth < window.innerWidth * 0.75) framingTarget = panelWidth / 2;
  }

  function updateSceneFraming(dt) {
    if (getReducedMotion()) framingOffset = framingTarget;
    else framingOffset += (framingTarget - framingOffset) * Math.min(1, dt * FRAMING_EASE);
    if (Math.abs(framingTarget - framingOffset) < 0.5) framingOffset = framingTarget;
    const w = window.innerWidth, h = window.innerHeight;
    if (framingOffset === framingApplied && w === framingWidth && h === framingHeight) return;
    framingApplied = framingOffset;
    framingWidth = w;
    framingHeight = h;
    if (framingOffset === 0) camera.clearViewOffset();
    else camera.setViewOffset(w, h, framingOffset, 0, w, h);
  }

  function setAppearanceOpen(open) {
    framingOpen = open;
    updateFramingTarget();
  }

  return {
    updateSceneFraming, setAppearanceOpen,
  };
}
