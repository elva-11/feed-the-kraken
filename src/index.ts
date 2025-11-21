import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import { GameManager } from './game/GameManager.js';

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: parseInt(process.env.PORT || '3000', 10)
});

const gameManager = new GameManager(app);

// Command: Start a new game
app.command('/kraken-start', async ({ command, ack, say, client }) => {
  await ack();

  try {
    const channelId = command.channel_id;
    const userId = command.user_id;

    const result = await gameManager.createGame(channelId, userId, client);
    // Notify channel that the user has started and joined the game
    await say(`<@${userId}> has started a new game and joined! Use \`/kraken-join\` to join the game. Need at least 5 players to start.`);

  } catch (error) {
    console.error('Error starting game:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await say(`Error starting game: ${errorMessage}`);
  }
});

// Command: Join the game
app.command('/kraken-join', async ({ command, ack, say, client }) => {
  await ack();

  try {
    const channelId = command.channel_id;
    const userId = command.user_id;

    const result = await gameManager.joinGame(channelId, userId, client);

    // If the user is already in the game or other errors, send ephemeral message
    if (!result.success) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: result.message
      });
    } else {
      // Success: send public message
      await say(result.message);
    }

  } catch (error) {
    console.error('Error joining game:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await say(`Error joining game: ${errorMessage}`);
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await say(`Error beginning game: ${errorMessage}`);
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await say(`Error getting game status: ${errorMessage}`);
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
