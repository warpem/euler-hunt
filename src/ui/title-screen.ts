export interface TitleScreenCallbacks {
  onCampaign(): void;
  onFreePlay(): void;
}

export function createTitleScreen(
  container: HTMLElement,
  callbacks: TitleScreenCallbacks,
): void {
  const base = import.meta.env.BASE_URL;
  container.innerHTML = `
    <div style="
      position:relative; min-height:100vh; overflow:hidden;
      display:flex; flex-direction:column; align-items:center; justify-content:start;
      text-align:center; padding-top:8vh;
    ">
      <img src="${base}euler_image.jpg" alt="" style="
        position:absolute; inset:0; width:100%; height:100%;
        object-fit:cover; z-index:0; pointer-events:none;
        image-rendering:pixelated;
      " />
      <div style="position:relative; z-index:1; text-shadow:0 2px 12px rgba(0,0,0,0.7)">
        <h1 style="font-size:48px; margin-bottom:8px; letter-spacing:2px; color:#fff">EULER HUNT</h1>
        <p style="color:rgba(255,255,255,0.8); margin-bottom:40px; font-size:14px">Match the Euler angles of cryo-EM projections</p>
      </div>
      <div style="position:relative; z-index:1; display:flex; flex-direction:column; gap:12px">
        <button id="campaignBtn" style="
          padding:14px 48px; font-size:18px; cursor:pointer;
          background:var(--btn-primary-bg); color:var(--btn-primary-fg);
          border:none; border-radius:8px; font-weight:bold; min-width:200px;
        ">Campaign</button>
        <button id="freePlayBtn" style="
          padding:14px 48px; font-size:18px; cursor:pointer;
          background:rgba(255,255,255,0.15); color:#fff;
          border:1px solid rgba(255,255,255,0.3); border-radius:8px;
          font-weight:bold; min-width:200px; backdrop-filter:blur(4px);
        ">Free Play</button>
      </div>
    </div>
  `;

  document.getElementById('campaignBtn')!.addEventListener('click', callbacks.onCampaign);
  document.getElementById('freePlayBtn')!.addEventListener('click', callbacks.onFreePlay);
}
