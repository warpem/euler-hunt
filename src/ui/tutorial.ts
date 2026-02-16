const STORAGE_KEY = 'euler-hunt-tutorial-done';

interface TutorialStep {
  elementId: string;
  text: string;
}

const STEPS: TutorialStep[] = [
  {
    elementId: 'targetCanvas',
    text: 'This is the target projection. Your goal is to find the Euler angles that produce a matching image.',
  },
  {
    elementId: 'topDisc',
    text: 'Click or drag on the hemisphere discs to choose a viewing direction (rotation and tilt angles).',
  },
  {
    elementId: 'playerCanvas',
    text: 'Your projection updates live as you pick angles. Compare it to the target!',
  },
  {
    elementId: 'psiRing',
    text: 'Use the psi ring to adjust in-plane rotation. The NCC in the center shows how well you match \u2014 higher is better.',
  },
  {
    elementId: 'topDisc',
    text: 'Explored cells are color-coded by match quality: blue (poor) \u2192 red (great). The color range is updated dynamically as you explore.',
  },
  {
    elementId: 'subdivideBtn',
    text: 'Once you\'re done, click Subdivide to refine the grid and use higher-frequency image details for more precise control. At the finest level, click Submit to see your score!',
  },
];

let overlay: HTMLDivElement | null = null;
let spotlight: HTMLDivElement | null = null;
let bubble: HTMLDivElement | null = null;
let currentStep = 0;
let resizeHandler: (() => void) | null = null;

export function isFirstPlay(): boolean {
  return !localStorage.getItem(STORAGE_KEY);
}

export function markTutorialDone(): void {
  localStorage.setItem(STORAGE_KEY, '1');
}

function cleanup(): void {
  if (overlay) { overlay.remove(); overlay = null; }
  if (spotlight) { spotlight.remove(); spotlight = null; }
  if (bubble) { bubble.remove(); bubble = null; }
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
}

function positionStep(): void {
  const step = STEPS[currentStep];
  const el = document.getElementById(step.elementId);
  if (!el || !spotlight || !bubble) return;

  const rect = el.getBoundingClientRect();
  const pad = 6;

  // Spotlight
  spotlight.style.top = `${rect.top - pad}px`;
  spotlight.style.left = `${rect.left - pad}px`;
  spotlight.style.width = `${rect.width + pad * 2}px`;
  spotlight.style.height = `${rect.height + pad * 2}px`;

  // Bubble content
  const isLast = currentStep === STEPS.length - 1;
  bubble.innerHTML = `
    <div style="font-size:14px; line-height:1.5; margin-bottom:12px">${step.text}</div>
    <div style="display:flex; align-items:center; justify-content:space-between">
      <span style="font-size:12px; color:#888">${currentStep + 1}/${STEPS.length}</span>
      <div style="display:flex; gap:12px; align-items:center">
        ${!isLast ? '<button id="tutSkip" style="background:none; border:none; color:#888; font-size:13px; cursor:pointer; padding:4px">Skip</button>' : ''}
        <button id="tutNext" style="
          padding:6px 18px; font-size:13px; cursor:pointer;
          background:var(--btn-primary-bg); color:var(--btn-primary-fg);
          border:none; border-radius:4px; font-weight:bold;
        ">${isLast ? 'Got it!' : 'Next'}</button>
      </div>
    </div>
  `;

  // Position bubble below or above the spotlight
  const bubbleW = 300;
  const margin = 12;
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeBelow = spaceBelow > 160;

  bubble.style.width = `${bubbleW}px`;

  // Horizontal: center on element, clamp to viewport
  let left = rect.left + rect.width / 2 - bubbleW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - bubbleW - 8));
  bubble.style.left = `${left}px`;

  if (placeBelow) {
    bubble.style.top = `${rect.bottom + pad + margin}px`;
    bubble.style.bottom = 'auto';
  } else {
    bubble.style.bottom = `${window.innerHeight - rect.top + pad + margin}px`;
    bubble.style.top = 'auto';
  }

  // Wire buttons
  document.getElementById('tutNext')?.addEventListener('click', () => {
    if (isLast) {
      markTutorialDone();
      cleanup();
    } else {
      currentStep++;
      positionStep();
    }
  });
  document.getElementById('tutSkip')?.addEventListener('click', () => {
    markTutorialDone();
    cleanup();
  });
}

export function startTutorial(): void {
  cleanup();
  currentStep = 0;

  // Overlay (blocks clicks on game)
  overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; z-index:10000; pointer-events:auto;';
  // Click overlay itself to dismiss (but not bubble/spotlight)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      markTutorialDone();
      cleanup();
    }
  });
  document.body.appendChild(overlay);

  // Spotlight (creates the dimming effect with box-shadow)
  spotlight = document.createElement('div');
  spotlight.style.cssText = `
    position:fixed; z-index:10001; pointer-events:none;
    border-radius:8px;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.55), 0 0 12px 2px rgba(34,170,102,0.4);
  `;
  document.body.appendChild(spotlight);

  // Speech bubble
  bubble = document.createElement('div');
  bubble.style.cssText = `
    position:fixed; z-index:10002;
    background:var(--surface, #fff); color:var(--fg, #1d1d1f);
    border-radius:8px; padding:16px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    max-width: 90vw;
  `;
  // Prevent overlay click-to-dismiss when clicking bubble
  bubble.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(bubble);

  resizeHandler = () => positionStep();
  window.addEventListener('resize', resizeHandler);

  positionStep();
}
