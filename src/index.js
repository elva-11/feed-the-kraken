import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import { GameManager } from './game/GameManager.js';

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000
});

const gameManager = new GameManager(app);

// Command: Start a new game
app.command('/kraken-start', async ({ command, ack, say, client }) => {
  await ack();

  try {
    const channelId = command.channel_id;
    const userId = command.user_id;

    await gameManager.createGame(channelId, userId, client);

  } catch (error) {
    console.error('Error starting game:', error);
    await say(`Error starting game: ${error.message}`);
  }
});

// Command: Join the game
app.command('/kraken-join', async ({ command, ack, say }) => {
  await ack();

  try {
    const channelId = command.channel_id;
    const userId = command.user_id;

    const result = await gameManager.joinGame(channelId, userId);
    await say(result.message);

  } catch (error) {
    console.error('Error joining game:', error);
    await say(`Error joining game: ${error.message}`);
  }
});

// Command: Begin the game (once all players joined)
app.command('/kraken-begin', async ({ command, ack, say, client }) => {
  await ack();

  try {
    const channelId = command.channel_id;
    const userId = command.user_id;

    await gameManager.beginGame(channelId, userId, client);

  } catch (error) {
    console.error('Error beginning game:', error);
    await say(`Error beginning game: ${error.message}`);
  }
});

// Command: View game status
app.command('/kraken-status', async ({ command, ack, say }) => {
  await ack();

  try {
    const channelId = command.channel_id;
    const status = await gameManager.getGameStatus(channelId);
    await say(status);

  } catch (error) {
    console.error('Error getting status:', error);
    await say(`Error getting game status: ${error.message}`);
  }
});

// Handle interactive actions (buttons, select menus, etc.)
app.action(/.*/, async ({ action, ack, body, client }) => {
  await ack();

  try {
    await gameManager.handleAction(action, body, client);
  } catch (error) {
    console.error('Error handling action:', error);
  }
});

// Handle view submissions (modals)
app.view(/.*/, async ({ ack, body, view, client }) => {
  await ack();

  try {
    await gameManager.handleViewSubmission(view, body, client);
  } catch (error) {
    console.error('Error handling view submission:', error);
  }
});

// Start the app
(async () => {
  await app.start();
  console.log('⚡️ Feed the Kraken Slack app is running!');
})();
