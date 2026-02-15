export interface TitleScreenCallbacks {
  onCampaign(): void;
  onFreePlay(): void;
}

export function createTitleScreen(
  container: HTMLElement,
  callbacks: TitleScreenCallbacks,
): void {
  container.innerHTML = `
    <div style="
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      min-height:80vh; text-align:center;
    ">
      <h1 style="font-size:48px; margin-bottom:8px; letter-spacing:2px">EULER HUNT</h1>
      <p style="color:var(--muted); margin-bottom:40px; font-size:14px">Match the Euler angles of cryo-EM projections</p>
      <div style="display:flex; flex-direction:column; gap:12px">
        <button id="campaignBtn" style="
          padding:14px 48px; font-size:18px; cursor:pointer;
          background:var(--btn-primary-bg); color:var(--btn-primary-fg);
          border:none; border-radius:8px; font-weight:bold; min-width:200px;
        ">Campaign</button>
        <button id="freePlayBtn" style="
          padding:14px 48px; font-size:18px; cursor:pointer;
          background:var(--btn-secondary-bg); color:var(--btn-secondary-fg);
          border:none; border-radius:8px; font-weight:bold; min-width:200px;
        ">Free Play</button>
      </div>
    </div>
  `;

  document.getElementById('campaignBtn')!.addEventListener('click', callbacks.onCampaign);
  document.getElementById('freePlayBtn')!.addEventListener('click', callbacks.onFreePlay);
}
