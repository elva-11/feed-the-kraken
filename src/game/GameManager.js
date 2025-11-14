import { GameState } from './GameState.js';
import { TurnManager } from './TurnManager.js';

export class GameManager {
  constructor(app) {
    this.app = app;
    this.games = new Map(); // channelId -> GameState
    this.turnManagers = new Map(); // channelId -> TurnManager
  }

  createGame(channelId, hostId, client) {
    if (this.games.has(channelId)) {
      throw new Error('A game is already in progress in this channel!');
    }

    const game = new GameState(channelId, hostId);
    this.games.set(channelId, game);

    // Add host as first player
    const user = client.users.info({ user: hostId }).then(result => {
      const username = result.user.name;
      game.addPlayer(hostId, username);
    });

    return {
      success: true,
      message: `Feed the Kraken game created! Use \`/kraken-join\` to join the game. Need at least 5 players to start.`
    };
  }

  async joinGame(channelId, userId) {
    const game = this.games.get(channelId);

    if (!game) {
      throw new Error('No game found in this channel. Use `/kraken-start` to create one!');
    }

    return game.addPlayer(userId, 'Player');
  }

  async beginGame(channelId, hostId, client) {
    const game = this.games.get(channelId);

    if (!game) {
      throw new Error('No game found in this channel!');
    }

    if (!game.isHost(hostId)) {
      throw new Error('Only the host can start the game!');
    }

    if (!game.canStart()) {
      throw new Error(`Need at least 5 players to start. Currently have ${game.getPlayerCount()} players.`);
    }

    // Start the game
    game.start();

    // Create turn manager
    const turnManager = new TurnManager(game, client, channelId);
    this.turnManagers.set(channelId, turnManager);

    // Send role assignments via DM
    await this.sendRoleAssignments(game, client);

    // Start the first turn
    await turnManager.startTurn();

    return {
      success: true,
      message: 'Game started! Check your DMs for your role.'
    };
  }

  async sendRoleAssignments(game, client) {
    const players = game.getAllPlayers();

    for (const player of players) {
      try {
        let roleMessage = this.getRoleMessage(player, game);

        await client.chat.postMessage({
          channel: player.userId,
          text: roleMessage
        });
      } catch (error) {
        console.error(`Failed to send role to ${player.userId}:`, error);
      }
    }

    // Send special messages to Pirates (so they know each other)
    const pirates = players.filter(p => p.role === 'PIRATE');
    if (pirates.length > 0) {
      const pirateNames = pirates.map(p => `<@${p.userId}>`).join(', ');
      const pirateMessage = `\n\n*Your fellow Pirates are:* ${pirateNames}\n\nWork together to steer the ship to Crimson Cove (red area)!`;

      for (const pirate of pirates) {
        try {
          await client.chat.postMessage({
            channel: pirate.userId,
            text: pirateMessage
          });
        } catch (error) {
          console.error(`Failed to send pirate list to ${pirate.userId}:`, error);
        }
      }
    }
  }

  getRoleMessage(player, game) {
    const baseMessage = `*Feed the Kraken* 🦑\n\nYour role: *${player.role}*\n\n`;

    switch (player.role) {
      case 'SAILOR':
        return baseMessage +
          `You are a loyal sailor! Your goal is to navigate the ship to *Bluewater Bay* (the blue area).\n\n` +
          `Work with your fellow sailors to identify the pirates and cult members who want to sabotage your journey.`;

      case 'PIRATE':
        return baseMessage +
          `You are a pirate! Your goal is to navigate the ship to *Crimson Cove* (the red area).\n\n` +
          `Work secretly with your fellow pirates. You'll receive a separate message with their identities.`;

      case 'CULT_LEADER':
        return baseMessage +
          `You are the Cult Leader! Your goal is to feed the ship to the *Kraken* (North) or get yourself fed to the Kraken.\n\n` +
          `You can secretly convert other players to cultists. Be careful - only unconverted, unsearched, and unflogged players can be converted.`;

      case 'CULTIST':
        return baseMessage +
          `You are a cultist! Your goal is to help the Cult Leader feed the ship to the *Kraken* (North).\n\n` +
          `The Cult Leader is <@${game.cultLeader}>. Work together in secret!`;

      default:
        return baseMessage + 'Role information not available.';
    }
  }

  async getGameStatus(channelId) {
    const game = this.games.get(channelId);

    if (!game) {
      return 'No game found in this channel. Use `/kraken-start` to create one!';
    }

    return game.getStatusMessage();
  }

  async handleAction(action, body, client) {
    const channelId = body.channel?.id || body.view?.private_metadata;
    const userId = body.user.id;

    const turnManager = this.turnManagers.get(channelId);
    if (!turnManager) {
      return;
    }

    await turnManager.handleAction(action, body, client);
  }

  async handleViewSubmission(view, body, client) {
    const channelId = view.private_metadata;
    const userId = body.user.id;

    const turnManager = this.turnManagers.get(channelId);
    if (!turnManager) {
      return;
    }

    await turnManager.handleViewSubmission(view, body, client);
  }

  getGame(channelId) {
    return this.games.get(channelId);
  }

  endGame(channelId) {
    this.games.delete(channelId);
    this.turnManagers.delete(channelId);
  }
}
