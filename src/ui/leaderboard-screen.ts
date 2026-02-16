import { campaignLevels } from '../game/campaign';
import { getLeaderboard, getUid, type LeaderboardEntry } from '../firebase';

export interface LeaderboardScreenCallbacks {
  onBack(): void;
}

function levelSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

function renderTable(entries: LeaderboardEntry[], myUid: string | null): string {
  if (entries.length === 0) {
    return '<p style="color:var(--muted); font-size:13px; margin-top:12px">No scores yet.</p>';
  }
  const rows = entries.map((e, i) => {
    const isMe = e.uid === myUid;
    const bg = isMe ? 'background:rgba(34,170,102,0.15);' : '';
    const bold = isMe ? 'font-weight:bold;' : '';
    return `<tr style="${bg}${bold}">
      <td style="padding:6px 12px; text-align:center">${i + 1}</td>
      <td style="padding:6px 12px; text-align:left">${e.name}</td>
      <td style="padding:6px 12px; text-align:right; font-family:monospace">${e.resolution.toFixed(3)} \u00c5</td>
    </tr>`;
  }).join('');

  return `
    <table style="border-collapse:collapse; width:100%; max-width:400px; font-size:14px; margin-top:12px">
      <thead>
        <tr style="border-bottom:1px solid var(--border); color:var(--muted); font-size:12px">
          <th style="padding:6px 12px; text-align:center">#</th>
          <th style="padding:6px 12px; text-align:left">Name</th>
          <th style="padding:6px 12px; text-align:right">Resolution</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function createLeaderboardScreen(
  container: HTMLElement,
  callbacks: LeaderboardScreenCallbacks,
): void {
  const tabs = campaignLevels.map((l, i) => `
    <button class="lb-tab" data-index="${i}" style="
      padding:8px 16px; font-size:13px; cursor:pointer;
      background:var(--btn-secondary-bg); color:var(--btn-secondary-fg);
      border:1px solid var(--border); border-radius:4px; font-weight:bold;
    ">${l.name}</button>
  `).join('');

  container.innerHTML = `
    <div style="
      display:flex; flex-direction:column; align-items:center;
      min-height:80vh; padding:24px 16px; text-align:center;
    ">
      <h2 style="margin-bottom:16px">Leaderboard</h2>
      <div id="lbTabs" style="display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-bottom:8px">
        ${tabs}
      </div>
      <div id="lbContent" style="width:100%; display:flex; flex-direction:column; align-items:center">
        <div class="spinner" style="margin-top:24px"></div>
      </div>
      <button id="lbBackBtn" style="
        padding:12px 36px; font-size:16px; cursor:pointer; margin-top:24px;
        background:var(--btn-secondary-bg); color:var(--btn-secondary-fg);
        border:none; border-radius:6px; font-weight:bold;
      ">Back to Menu</button>
    </div>
  `;

  const tabContainer = document.getElementById('lbTabs')!;
  const content = document.getElementById('lbContent')!;
  const allTabs = tabContainer.querySelectorAll<HTMLButtonElement>('.lb-tab');
  let activeIndex = 0;

  function setActiveTab(index: number) {
    activeIndex = index;
    allTabs.forEach((btn, i) => {
      if (i === index) {
        btn.style.background = 'var(--btn-primary-bg)';
        btn.style.color = 'var(--btn-primary-fg)';
        btn.style.borderColor = 'var(--btn-primary-bg)';
      } else {
        btn.style.background = 'var(--btn-secondary-bg)';
        btn.style.color = 'var(--btn-secondary-fg)';
        btn.style.borderColor = 'var(--border)';
      }
    });
  }

  async function loadLevel(index: number) {
    setActiveTab(index);
    content.innerHTML = '<div class="spinner" style="margin-top:24px"></div>';
    try {
      const slug = levelSlug(campaignLevels[index].name);
      const entries = await getLeaderboard(slug);
      content.innerHTML = renderTable(entries, getUid());
    } catch {
      content.innerHTML = '<p style="color:#e44; font-size:13px; margin-top:12px">Failed to load scores.</p>';
    }
  }

  allTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index!, 10);
      if (idx !== activeIndex) loadLevel(idx);
    });
  });

  document.getElementById('lbBackBtn')!.addEventListener('click', callbacks.onBack);

  // Load first level
  loadLevel(0);
}
