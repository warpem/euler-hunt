import { createTitleScreen } from './ui/title-screen';
import { createGameScreen } from './ui/game-screen';
import { createScoreScreen } from './ui/score-screen';
import { createFreePlaySetup } from './ui/free-play-setup';
import { createLeaderboardScreen } from './ui/leaderboard-screen';
import { campaignLevels, type LevelConfig } from './game/campaign';
import { initAuth } from './firebase';

// Fire-and-forget auth init (leaderboard features degrade gracefully if it fails)
initAuth();

const app = document.getElementById('app')!;
let currentLevel = 0;

function levelSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

function showTitle() {
  createTitleScreen(app, {
    onCampaign: () => {
      currentLevel = 0;
      startLevel(campaignLevels[currentLevel]);
    },
    onFreePlay: () => {
      createFreePlaySetup(app, {
        onStart: (config) => startLevel(config),
        onBack: showTitle,
      });
    },
    onLeaderboard: () => {
      createLeaderboardScreen(app, { onBack: showTitle });
    },
  });
}

async function startLevel(config: LevelConfig) {
  const isCampaign = campaignLevels.some((l) => l === config);
  try {
    await createGameScreen(app, config, {
      onBack: showTitle,
      onSubmit: (result) => {
        const hasNext = isCampaign && currentLevel < campaignLevels.length - 1;
        const slug = isCampaign ? levelSlug(config.name) : null;

        createScoreScreen(app, result, config.name, hasNext, {
          onNextLevel: () => {
            currentLevel++;
            startLevel(campaignLevels[currentLevel]);
          },
          onBackToTitle: showTitle,
        }, slug);
      },
    }, isCampaign);
  } catch (err) {
    app.innerHTML = `<div style="text-align:center; padding:40px">
      <h2>Error</h2>
      <p style="color:#e44">${err}</p>
      <button onclick="location.reload()" style="
        padding:8px 24px; margin-top:16px; cursor:pointer;
        background:var(--btn-secondary-bg); color:var(--btn-secondary-fg);
        border:none; border-radius:6px;
      ">Reload</button>
    </div>`;
    console.error(err);
  }
}

showTitle();
