// Stages a synthetic garment photo + care label into the /scan page's real <input type=file>
// elements (same onChange path as a user picking files), then clicks Scan.
// Run: wmux browser eval "$(cat .claude/skills/verify/scripts/stage-scan.js)"
(async () => {
  const draw = (w, h, paint) => new Promise((res) => {
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    paint(c.getContext('2d'));
    c.toBlob(res, 'image/jpeg', 0.92);
  });
  const label = await draw(800, 500, (g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 800, 500);
    g.fillStyle = '#000'; g.font = 'bold 48px Arial';
    ['LEVI STRAUSS & CO', '100% COTTON', 'MADE IN BANGLADESH', 'MACHINE WASH COLD'].forEach((t, i) => g.fillText(t, 40, 100 + i * 100));
  });
  const garment = await draw(600, 600, (g) => { g.fillStyle = '#1f3b73'; g.fillRect(0, 0, 600, 600); });
  const inputs = document.querySelectorAll('input[type=file]');
  if (inputs.length < 2) return 'FAIL: expected 2 file inputs on /scan, found ' + inputs.length;
  const put = (input, blob, name) => {
    const dt = new DataTransfer();
    dt.items.add(new File([blob], name, { type: 'image/jpeg' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  put(inputs[0], garment, 'garment.jpg');
  put(inputs[1], label, 'tag.jpg');
  await new Promise((r) => setTimeout(r, 1500)); // component downsizes to data URLs asynchronously
  const scan = [...document.querySelectorAll('button')].find((b) => /^Scan( |$)/.test(b.textContent.trim()));
  if (!scan) return 'FAIL: no Scan button';
  scan.click();
  return 'OK: staged garment.jpg + tag.jpg, clicked Scan';
})()
