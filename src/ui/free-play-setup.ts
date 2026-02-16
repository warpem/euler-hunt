import type { LevelConfig } from '../game/campaign';

export interface FreePlayCallbacks {
  onStart(config: LevelConfig): void;
  onBack(): void;
}

export function createFreePlaySetup(
  container: HTMLElement,
  callbacks: FreePlayCallbacks,
): void {
  container.innerHTML = `
    <div style="
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      min-height:80vh; text-align:center;
    ">
      <h2 style="margin-bottom:24px">Free Play Setup</h2>
      <div style="display:flex; flex-direction:column; gap:12px; text-align:left; min-width:300px">
        <label>
          MRC File:
          <input type="file" id="mrcFile" accept=".mrc" style="display:block; margin-top:4px">
        </label>
        <label>
          Symmetry:
          <select id="symmetry" style="
            display:block; margin-top:4px; padding:6px; width:100%;
            background:var(--input-bg); color:var(--fg); border:1px solid var(--input-border);
            border-radius:4px;
          ">
            <option value="C1">C1 (no symmetry)</option>
            <option value="C2">C2</option>
            <option value="C3">C3</option>
            <option value="C4">C4</option>
            <option value="C6">C6</option>
            <option value="D2">D2</option>
            <option value="D3">D3</option>
            <option value="D7">D7</option>
            <option value="T">T (tetrahedral)</option>
            <option value="O" selected>O (octahedral)</option>
            <option value="I">I (icosahedral)</option>
          </select>
        </label>
        <label style="display:flex; align-items:center; gap:8px">
          <input type="checkbox" id="ctfToggle" checked>
          CTF — Defocus: <span id="defocusVal">2.0</span> \u03bcm
        </label>
        <input type="range" id="defocus" min="0.5" max="5" step="0.1" value="2.0"
          style="display:block; width:100%">
        <label style="display:flex; align-items:center; gap:8px">
          <input type="checkbox" id="noiseToggle" checked>
          Noise — SNR: <span id="snrVal">0.1</span>
        </label>
        <input type="range" id="snr" min="0.01" max="1" step="0.01" value="0.1"
          style="display:block; width:100%">
        <label style="display:flex; align-items:center; gap:8px">
          <input type="checkbox" id="fadeToggle">
          Memory Fade — Half-life: <span id="fadeVal">3.0</span>s
        </label>
        <input type="range" id="fadeSlider" min="0.5" max="10" step="0.5" value="3" disabled
          style="display:block; width:100%; opacity:0.35">
      </div>
      <div style="display:flex; gap:12px; margin-top:24px">
        <button id="startBtn" style="
          padding:12px 36px; font-size:16px; cursor:pointer;
          background:var(--btn-primary-bg); color:var(--btn-primary-fg);
          border:none; border-radius:6px; font-weight:bold;
        ">Start</button>
        <button id="backBtn" style="
          padding:12px 36px; font-size:16px; cursor:pointer;
          background:var(--btn-secondary-bg); color:var(--btn-secondary-fg);
          border:none; border-radius:6px; font-weight:bold;
        ">Back</button>
      </div>
      <p id="fpStatus" style="color:#e44; font-size:13px; min-height:20px"></p>
    </div>
  `;

  const mrcFile = document.getElementById('mrcFile') as HTMLInputElement;
  const symmetry = document.getElementById('symmetry') as HTMLSelectElement;
  const snrSlider = document.getElementById('snr') as HTMLInputElement;
  const defocusSlider = document.getElementById('defocus') as HTMLInputElement;
  const ctfToggle = document.getElementById('ctfToggle') as HTMLInputElement;
  const noiseToggle = document.getElementById('noiseToggle') as HTMLInputElement;
  const snrVal = document.getElementById('snrVal')!;
  const defocusVal = document.getElementById('defocusVal')!;
  const statusEl = document.getElementById('fpStatus')!;

  const fadeToggle = document.getElementById('fadeToggle') as HTMLInputElement;
  const fadeSlider = document.getElementById('fadeSlider') as HTMLInputElement;
  const fadeVal = document.getElementById('fadeVal')!;

  snrSlider.addEventListener('input', () => { snrVal.textContent = snrSlider.value; });
  defocusSlider.addEventListener('input', () => { defocusVal.textContent = defocusSlider.value; });
  fadeSlider.addEventListener('input', () => { fadeVal.textContent = fadeSlider.value; });

  ctfToggle.addEventListener('change', () => {
    defocusSlider.disabled = !ctfToggle.checked;
    defocusSlider.style.opacity = ctfToggle.checked ? '1' : '0.35';
  });
  noiseToggle.addEventListener('change', () => {
    snrSlider.disabled = !noiseToggle.checked;
    snrSlider.style.opacity = noiseToggle.checked ? '1' : '0.35';
  });
  fadeToggle.addEventListener('change', () => {
    fadeSlider.disabled = !fadeToggle.checked;
    fadeSlider.style.opacity = fadeToggle.checked ? '1' : '0.35';
  });

  document.getElementById('startBtn')!.addEventListener('click', () => {
    const file = mrcFile.files?.[0];
    if (!file) {
      statusEl.textContent = 'Please select an MRC file.';
      return;
    }

    const url = URL.createObjectURL(file);

    const config: LevelConfig = {
      name: file.name.replace('.mrc', ''),
      symmetry: symmetry.value,
      defocus: ctfToggle.checked ? parseFloat(defocusSlider.value) : null,
      snr: noiseToggle.checked ? parseFloat(snrSlider.value) : null,
      fadeHalfLife: fadeToggle.checked ? parseFloat(fadeSlider.value) : null,
      mapUrl: url,
    };

    callbacks.onStart(config);
  });

  document.getElementById('backBtn')!.addEventListener('click', callbacks.onBack);
}
