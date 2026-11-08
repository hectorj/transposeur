/**
 * Test-only content script, never shipped.
 *
 * geckodriver refuses to execute scripts in privileged moz-extension pages, so
 * the Firefox tests cannot drive the popup. Instead the staged test manifest
 * registers content.js statically alongside this bridge, which relays calls
 * from the page context (where WebDriver can reach) into the content script
 * sandbox (where window.__pitchShifter lives).
 *
 * Only JSON strings cross the boundary, which sidesteps Xray/cloneInto rules.
 */
document.addEventListener('pitch-shifter-test', async (event) => {
  const { id, method, arg } = JSON.parse(event.detail);
  let payload;
  try {
    if (method === 'ping') {
      document.dispatchEvent(
        new CustomEvent('pitch-shifter-test-result', {
          detail: JSON.stringify({ id, ok: true, result: { hook: typeof window.__pitchShifter } }),
        })
      );
      return;
    }
    const result = await window.__pitchShifter[method](arg);
    payload = { id, ok: true, result };
  } catch (e) {
    payload = { id, ok: false, error: String(e?.message || e) };
  }
  document.dispatchEvent(
    new CustomEvent('pitch-shifter-test-result', { detail: JSON.stringify(payload) })
  );
});
