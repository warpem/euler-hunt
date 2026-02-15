import { createTitleScreen } from './ui/title-screen';
import { createGameScreen } from './ui/game-screen';
import { createScoreScreen } from './ui/score-screen';
import { createFreePlaySetup } from './ui/free-play-setup';
import { campaignLevels, type LevelConfig } from './game/campaign';

const app = document.getElementById('app')!;
let currentLevel = 0;

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
  });
}

async function startLevel(config: LevelConfig) {
  try {
    await createGameScreen(app, config, {
      onSubmit: (result) => {
        const isCampaign = campaignLevels.some((l) => l === config);
        const hasNext = isCampaign && currentLevel < campaignLevels.length - 1;

        createScoreScreen(app, result, config.name, hasNext, {
          onNextLevel: () => {
            currentLevel++;
            startLevel(campaignLevels[currentLevel]);
          },
          onBackToTitle: showTitle,
        });
      },
    });
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
