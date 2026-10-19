const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium } = require('@playwright/test');

const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const compile = (name) => ts.transpileModule(
  fs.readFileSync(path.join(process.cwd(), name), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText;

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.addInitScript(() => {
      window.__audioChecks = { curves: 0, oscillators: 0 };
      const originalCurve = AudioParam.prototype.setValueCurveAtTime;
      AudioParam.prototype.setValueCurveAtTime = function (...args) {
        window.__audioChecks.curves++;
        return originalCurve.apply(this, args);
      };
      const originalOscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function (...args) {
        window.__audioChecks.oscillators++;
        return originalOscillator.apply(this, args);
      };
    });
    await page.goto(baseURL, { waitUntil: 'networkidle' });

    const rendered = await page.evaluate(async ({ scheduleCode }) => {
      const api = {};
      new Function('exports', scheduleCode)(api);
      const results = [];
      function makeStage(beatHz, durationSec = 5, mode = 'cosine_glide') {
        return { id: `test-${beatHz}`, name: 'Test', band: 'BETA', carrierHz: 220, beatHz, durationSec, transitionType: mode, intent: 'Regression' };
      }
      async function render(stages, sampleRate, loop = false, mode = 'stereo', fixed = false) {
        const curves = api.buildFrequencyCurves(stages, 0, true);
        const seconds = fixed ? 0.4 : curves.duration + (loop ? 1 : 0);
        const context = new OfflineAudioContext(2, Math.round(seconds * sampleRate), sampleRate);
        const left = context.createOscillator();
        const right = context.createOscillator();
        const leftGain = context.createGain();
        const rightGain = context.createGain();
        const merger = context.createChannelMerger(2);
        leftGain.gain.value = mode === 'right' ? 0 : 0.2;
        rightGain.gain.value = mode === 'left' ? 0 : 0.2;
        left.frequency.setValueCurveAtTime(curves.left, 0, curves.duration);
        right.frequency.setValueCurveAtTime(curves.right, 0, curves.duration);
        if (loop) {
          const final = api.sampleSequence(stages, curves.duration, true);
          const next = api.buildFrequencyCurves(stages, 0, true, final);
          left.frequency.setValueCurveAtTime(next.left, curves.duration, next.duration);
          right.frequency.setValueCurveAtTime(next.right, curves.duration, next.duration);
        }
        left.connect(leftGain);
        right.connect(rightGain);
        leftGain.connect(merger, 0, 0);
        rightGain.connect(merger, 0, 1);
        merger.connect(context.destination);
        left.start(0);
        right.start(0);
        const buffer = await context.startRendering();
        let maxJump = 0;
        let peak = 0;
        let silentPeak = 0;
        for (let channel = 0; channel < 2; channel++) {
          const samples = buffer.getChannelData(channel);
          for (let index = 1; index < samples.length; index++) {
            if (!Number.isFinite(samples[index])) throw new Error('Non-finite rendered sample');
            peak = Math.max(peak, Math.abs(samples[index]));
            maxJump = Math.max(maxJump, Math.abs(samples[index] - samples[index - 1]));
            if ((mode === 'left' && channel === 1) || (mode === 'right' && channel === 0)) {
              silentPeak = Math.max(silentPeak, Math.abs(samples[index]));
            }
          }
        }
        return { sampleRate, beat: stages[0].beatHz, mode, loop, peak, maxJump, silentPeak };
      }
      for (const rate of [44100, 48000]) {
        for (const beat of [5, 6, 7, 8, 13, 15, 18, 20, 25, 30, 32, 34, 35, 40]) {
          results.push(await render([makeStage(beat)], rate, false, 'stereo', true));
        }
        const stages = [makeStage(20, 5, 'linear_ramp'), makeStage(6, 5, 'cosine_glide'), makeStage(34, 5, 'step')];
        results.push(await render(stages, rate, true));
        results.push(await render([makeStage(20)], rate, false, 'left', true));
        results.push(await render([makeStage(20)], rate, false, 'right', true));
      }
      const wav = api.makeReferenceWav(220, 20, 'left', 1);
      const data = new DataView(await wav.arrayBuffer());
      let rightPeak = 0;
      let leftPeak = 0;
      for (let at = 44; at < data.byteLength; at += 4) {
        leftPeak = Math.max(leftPeak, Math.abs(data.getInt16(at, true)));
        rightPeak = Math.max(rightPeak, Math.abs(data.getInt16(at + 2, true)));
      }
      return { results, wav: { bytes: data.byteLength, channels: data.getUint16(22, true), sampleRate: data.getUint32(24, true), leftPeak, rightPeak } };
    }, { scheduleCode: compile('src/lib/audio-schedule.ts') });

    for (const result of rendered.results) {
      assert(result.peak <= 0.201, `Unexpected peak ${JSON.stringify(result)}`);
      // At these carriers, a 0.2-amplitude sine cannot naturally jump by 0.015/sample.
      assert(result.maxJump < 0.015, `Sample discontinuity ${JSON.stringify(result)}`);
      assert.equal(result.silentPeak, 0, `Channel leakage ${JSON.stringify(result)}`);
    }
    assert.equal(rendered.wav.rightPeak, 0);
    assert.equal(rendered.wav.channels, 2);
    assert.equal(rendered.wav.sampleRate, 48000);
    assert(rendered.wav.leftPeak > 0 && rendered.wav.leftPeak < 4000);
    console.log(`PASS: ${rendered.results.length} native offline audio cases across 44.1/48 kHz; stereo isolation; quiet reference WAV.`);
    console.log(`Maximum sample difference: ${Math.max(...rendered.results.map((result) => result.maxJump)).toFixed(7)} at a 0.2 peak.`);

    await page.getByRole('button', { name: 'β Beta', exact: true }).first().click();
    const beatInput = page.getByRole('spinbutton', { name: 'Movement 1 beat frequency Δf in hertz' });
    await beatInput.fill('18.37');
    await beatInput.press('Enter');
    assert.equal(await beatInput.inputValue(), '18.37', 'Typed binaural frequency was not retained');
    assert.equal(await page.getByRole('slider', { name: 'Movement 1 Beat Frequency Slider' }).inputValue(), '18.37', 'Beat slider did not sync with numeric entry');

    const carrierInput = page.getByRole('spinbutton', { name: 'Movement 1 left carrier frequency f L in hertz' });
    await carrierInput.fill('223.5');
    await carrierInput.press('Enter');
    assert.equal(await carrierInput.inputValue(), '223.5', 'Typed carrier frequency was not retained');
    assert.equal(await page.getByRole('slider', { name: 'Movement 1 Carrier Frequency Slider' }).inputValue(), '223.5', 'Carrier slider did not sync with numeric entry');

    const durationInput = page.getByRole('spinbutton', { name: 'Movement 1 duration in seconds' });
    await durationInput.fill('97');
    await durationInput.press('Enter');
    assert.equal(await durationInput.inputValue(), '97', 'Typed movement duration was not retained');
    assert.equal(await page.getByText('1:37', { exact: true }).count(), 1, 'Duration mm:ss readout did not update');
    assert.equal(await page.getByRole('slider', { name: 'Movement 1 Duration Slider' }).inputValue(), '97', 'Duration slider did not sync with numeric entry');
    console.log('PASS: direct decimal Hz and exact seconds entry stay synchronized with sliders and mm:ss.');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.waitForTimeout(800);
    const initialAutomation = await page.evaluate(() => ({ ...window.__audioChecks }));
    await page.waitForTimeout(700);
    assert.deepEqual(await page.evaluate(() => ({ ...window.__audioChecks })), initialAutomation, 'UI updates rescheduled audio outside the lookahead scheduler');
    console.log('PASS: UI clock updates do not recreate oscillators or reschedule frequency curves.');

    const waveSection = page.locator('section').filter({ has: page.getByRole('heading', { name: /Live 3-Channel Oscilloscope/ }) });
    await waveSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await waveSection.screenshot({ path: '/tmp/clearing-wave-garden-desktop.png' });
    await page.locator('summary').filter({ hasText: 'Sound Lab' }).click();
    const hold = page.getByRole('button', { name: 'Hold this beat', exact: true });
    await hold.click();
    await page.waitForTimeout(150);
    const seekSlider = page.getByRole('slider', { name: 'Seek through binaural beat frequency trajectory' });
    const heldPosition = await seekSlider.getAttribute('aria-valuenow');
    await page.waitForTimeout(400);
    assert.equal(await seekSlider.getAttribute('aria-valuenow'), heldPosition, 'Held beat advanced the clock');
    await page.getByRole('button', { name: 'Left only', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Left only', exact: true }).getAttribute('aria-pressed'), 'true');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download 8-second reference WAV', exact: true }).click();
    const download = await downloadEvent;
    assert(download.suggestedFilename().endsWith('-left.wav'));
    await page.getByRole('button', { name: 'Stereo', exact: true }).click();
    await page.getByRole('button', { name: 'Try audio only', exact: true }).click();
    assert.equal(await page.locator('canvas').count(), 0, 'Audio-only still renders canvases');
    assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Re-enable visualizers', exact: true }).click();
    await page.getByRole('button', { name: 'Beat held · Resume journey', exact: true }).click();
    await page.waitForTimeout(200);
    await seekSlider.focus();
    const beforeSeek = Number(await seekSlider.getAttribute('aria-valuenow'));
    await seekSlider.press('ArrowRight');
    await page.waitForTimeout(150);
    const afterSeek = Number(await seekSlider.getAttribute('aria-valuenow'));
    assert(afterSeek >= beforeSeek + 4 && afterSeek <= beforeSeek + 6, 'Seek shortcut was double-handled');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForTimeout(150);
    const frozen = await page.locator('canvas').first().evaluate(canvas => canvas.toDataURL());
    await page.waitForTimeout(200);
    assert.equal(await page.locator('canvas').first().evaluate(canvas => canvas.toDataURL()), frozen, 'Paused scope did not freeze');
    console.log('PASS: Hold, channel monitor, reference download, audio-only mode, keyboard seek and paused captures.');

    // Regression for the reported crash: a user-authored 29-movement,
    // 1,725-second symphony must not schedule one giant overlapping curve.
    await page.getByRole('button', { name: 'New Blank', exact: true }).click();
    const addMovement = page.getByRole('button', { name: 'Add Movement', exact: true });
    for (let index = 0; index < 27; index++) {
      await addMovement.click();
      await page.waitForTimeout(5);
    }
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.waitForTimeout(1200);
    assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).count(), 1, 'Long custom symphony did not remain in playback');
    assert.deepEqual(browserErrors, [], `Long custom symphony produced browser errors: ${browserErrors.join(', ')}`);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    console.log('PASS: generated 29-movement, 1,725-second custom symphony plays without curve overlap.');

    await page.setViewportSize({ width: 390, height: 844 });
    await waveSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    assert.equal(overflow, false, 'Mobile layout overflows viewport');
    await waveSection.screenshot({ path: '/tmp/clearing-wave-garden-mobile.png' });
    assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(', ')}`);
    console.log('PASS: Desktop/mobile scope layout and no browser runtime errors.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
