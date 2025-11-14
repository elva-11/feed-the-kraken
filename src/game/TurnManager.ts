import { GameState } from './GameState.js';
import type { WebClient } from '@slack/web-api';
import type { SlackActionMiddlewareArgs, SlackViewMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';

interface NavigationDirection {
  name: string;
  dx: number;
  dy: number;
}

interface NavigationMovement {
  dx: number;
  dy: number;
}

export class TurnManager {
  game: GameState;
  client: WebClient;
  channelId: string;
  mutinyVotes: Map<string, number>;
  navigationCards: unknown[];
  selectedLieutenant?: string;
  selectedNavigator?: string;
  mutinyEligibleVoters: Set<string>;
  mutinyTimeoutId?: NodeJS.Timeout;

  constructor(gameState: GameState, client: WebClient, channelId: string) {
    this.game = gameState;
    this.client = client;
    this.channelId = channelId;
    this.mutinyVotes = new Map();
    this.navigationCards = [];
    this.mutinyEligibleVoters = new Set();
  }

  async startTurn(): Promise<void> {
    this.game.nextPhase();
    await this.executePhase();
  }

  async executePhase(): Promise<void> {
    switch (this.game.currentPhase) {
      case 'NAVIGATION_SELECTION':
        await this.navigationSelectionPhase();
        break;
      case 'MUTINY':
        await this.mutinyPhase();
        break;
      case 'NAVIGATION':
        await this.navigationPhase();
        break;
      case 'VOTING':
        await this.votingPhase();
        break;
    }
  }

  async navigationSelectionPhase(): Promise<void> {
    const captain = this.game.getPlayer(this.game.captain!);

    const alivePlayers = this.game.getAlivePlayers()
      .filter(p => p.userId !== this.game.captain);

    const playerOptions = alivePlayers.map(p => ({
      text: {
        type: 'plain_text' as const,
        text: p.username || `Player ${p.userId}`
      },
      value: p.userId
    }));

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `*Turn ${this.game.currentTurn} - Navigation Selection*\n\n<@${this.game.captain}> is the Captain!`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Turn ${this.game.currentTurn} - Navigation Selection*\n\n<@${this.game.captain}> is the Captain and must select a Lieutenant and Navigator!`
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Select Lieutenant:*'
          },
          accessory: {
            type: 'static_select',
            placeholder: {
              type: 'plain_text',
              text: 'Choose Lieutenant'
            },
            action_id: 'select_lieutenant',
            options: playerOptions
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Select Navigator:*'
          },
          accessory: {
            type: 'static_select',
            placeholder: {
              type: 'plain_text',
              text: 'Choose Navigator'
            },
            action_id: 'select_navigator',
            options: playerOptions
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Confirm Navigation Team'
              },
              style: 'primary',
              action_id: 'confirm_navigation_team',
              value: this.channelId
            }
          ]
        }
      ]
    });
  }

  async mutinyPhase(): Promise<void> {
    this.mutinyVotes.clear();
    this.mutinyEligibleVoters.clear();

    // Clear any existing timeout
    if (this.mutinyTimeoutId) {
      clearTimeout(this.mutinyTimeoutId);
    }

    const alivePlayers = this.game.getAlivePlayers()
      .filter(p => p.userId !== this.game.captain);

    // Track who is eligible to vote
    alivePlayers.forEach(p => this.mutinyEligibleVoters.add(p.userId));

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `*Mutiny Phase*\n\nAll crew members (except the Captain) may vote for a mutiny!`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Mutiny Phase* ⚔️\n\nAll crew members (except <@${this.game.captain}>) may vote for mutiny!\n\nPlace your guns in secret. Click the button below to vote.\n\n_Votes: 0/${this.mutinyEligibleVoters.size}_`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Cast Mutiny Vote'
              },
              style: 'danger',
              action_id: 'cast_mutiny_vote',
              value: this.channelId
            }
          ]
        }
      ]
    });

    // Set a timeout as fallback (60 seconds)
    this.mutinyTimeoutId = setTimeout(async () => {
      await this.resolveMutiny();
    }, 60000);
  }

  async resolveMutiny(): Promise<void> {
    // Clear the timeout if it exists
    if (this.mutinyTimeoutId) {
      clearTimeout(this.mutinyTimeoutId);
      this.mutinyTimeoutId = undefined;
    }

    // Tally the votes
    let totalGunsUsed = 0;
    const voteDetails: string[] = [];

    for (const [userId, guns] of this.mutinyVotes.entries()) {
      totalGunsUsed += guns;
      if (guns > 0) {
        voteDetails.push(`<@${userId}> used ${guns} gun${guns > 1 ? 's' : ''}`);
      }
    }

    // Players who didn't vote count as 0 guns
    const nonVoters = Array.from(this.mutinyEligibleVoters).filter(
      id => !this.mutinyVotes.has(id)
    );

    // Calculate mutiny threshold (typically half the crew's total guns)
    const totalCrewGuns = Array.from(this.mutinyEligibleVoters)
      .map(id => this.game.getPlayer(id)?.guns || 0)
      .reduce((sum, guns) => sum + guns, 0);

    const mutinyThreshold = Math.floor(totalCrewGuns / 2) + 1;
    const mutinySucceeded = totalGunsUsed >= mutinyThreshold;

    const previousCaptain = this.game.captain;

    // Build result message
    let resultMessage = `*Mutiny Results* ⚔️\n\n`;
    resultMessage += `Total guns used: ${totalGunsUsed}/${totalCrewGuns}\n`;
    resultMessage += `Threshold for success: ${mutinyThreshold}\n\n`;

    if (voteDetails.length > 0) {
      resultMessage += `Votes cast:\n${voteDetails.join('\n')}\n\n`;
    }

    if (nonVoters.length > 0) {
      resultMessage += `_${nonVoters.length} crew member(s) did not vote in time_\n\n`;
    }

    if (mutinySucceeded) {
      resultMessage += `🏴‍☠️ *MUTINY SUCCEEDS!*\n\n`;
      resultMessage += `<@${previousCaptain}> has been overthrown!\n`;

      // Replace the captain with a random crew member
      this.game.rotateCaptain();

      resultMessage += `The new Captain is <@${this.game.captain}>!`;
    } else {
      resultMessage += `✅ *Mutiny fails.*\n\n<@${previousCaptain}> remains Captain.`;
    }

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: resultMessage
    });

    // Move to next phase
    this.game.currentPhase = 'NAVIGATION';
    await this.executePhase();
  }

  async navigationPhase(): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `*Navigation Phase*\n\nThe navigation team (<@${this.game.lieutenant}> and <@${this.game.navigator}>) is steering the ship!`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Navigation Phase* 🧭\n\nLieutenant: <@${this.game.lieutenant}>\nNavigator: <@${this.game.navigator}>\n\nThey are now playing navigation cards to steer the ship...`
          }
        }
      ]
    });

    await this.sendNavigationCards(this.game.lieutenant!);
    await this.sendNavigationCards(this.game.navigator!);
  }

  async sendNavigationCards(userId: string): Promise<void> {
    const directions: NavigationDirection[] = [
      { name: 'North ⬆️', dx: 0, dy: 1 },
      { name: 'South ⬇️', dx: 0, dy: -1 },
      { name: 'East ➡️', dx: 1, dy: 0 },
      { name: 'West ⬅️', dx: -1, dy: 0 },
      { name: 'Northeast ↗️', dx: 1, dy: 1 },
      { name: 'Southeast ↘️', dx: 1, dy: -1 }
    ];

    const buttons = directions.map(dir => ({
      type: 'button' as const,
      text: {
        type: 'plain_text' as const,
        text: dir.name
      },
      action_id: `navigate_${dir.dx}_${dir.dy}`,
      value: JSON.stringify({ dx: dir.dx, dy: dir.dy, channelId: this.channelId })
    }));

    try {
      await this.client.chat.postMessage({
        channel: userId,
        text: 'Choose a navigation direction:',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Choose your navigation card:*\n\nSelect a direction to move the ship:'
            }
          },
          {
            type: 'actions',
            elements: buttons
          }
        ]
      });
    } catch (error) {
      console.error(`Failed to send navigation cards to ${userId}:`, error);
    }
  }

  async votingPhase(): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `*Voting Phase*\n\nTime to discuss and vote!`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Voting Phase* 🗳️\n\nDiscuss what happened and decide on any actions!\n\nCurrent ship position: (${this.game.shipPosition.x}, ${this.game.shipPosition.y})`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'End Turn'
              },
              style: 'primary',
              action_id: 'end_turn',
              value: this.channelId
            }
          ]
        }
      ]
    });
  }

  async handleAction(action: any, body: any, client: WebClient): Promise<void> {
    const userId = body.user.id;

    switch (action.action_id) {
      case 'select_lieutenant':
        this.selectedLieutenant = action.selected_option.value;
        break;

      case 'select_navigator':
        this.selectedNavigator = action.selected_option.value;
        break;

      case 'confirm_navigation_team':
        if (userId !== this.game.captain) {
          await client.chat.postEphemeral({
            channel: this.channelId,
            user: userId,
            text: 'Only the Captain can confirm the navigation team!'
          });
          return;
        }

        if (!this.selectedLieutenant || !this.selectedNavigator) {
          await client.chat.postEphemeral({
            channel: this.channelId,
            user: userId,
            text: 'Please select both Lieutenant and Navigator first!'
          });
          return;
        }

        this.game.setNavigationTeam(this.selectedLieutenant, this.selectedNavigator);

        await client.chat.postMessage({
          channel: this.channelId,
          text: `Navigation team selected!\nLieutenant: <@${this.selectedLieutenant}>\nNavigator: <@${this.selectedNavigator}>`
        });

        this.game.currentPhase = 'MUTINY';
        await this.executePhase();
        break;

      case 'cast_mutiny_vote':
        await this.openMutinyVoteModal(userId, client, body);
        break;

      case 'end_turn':
        const winCondition = this.game.checkWinCondition();
        if (winCondition.winner) {
          await client.chat.postMessage({
            channel: this.channelId,
            text: `*Game Over!*\n\n${winCondition.reason}\n\n*${winCondition.winner}* wins! 🎉`
          });
        } else {
          await this.startTurn();
        }
        break;

      default:
        if (action.action_id.startsWith('navigate_')) {
          const payload = JSON.parse(action.value);
          const movement: NavigationMovement = { dx: payload.dx, dy: payload.dy };
          this.game.moveShip(movement.dx, movement.dy);

          await client.chat.postMessage({
            channel: this.channelId,
            text: `<@${userId}> played a navigation card! New position: (${this.game.shipPosition.x}, ${this.game.shipPosition.y})`
          });

          this.game.currentPhase = 'VOTING';
          await this.executePhase();
        }
        break;
    }
  }

  async openMutinyVoteModal(userId: string, client: WebClient, body: any): Promise<void> {
    const player = this.game.getPlayer(userId);

    if (!player || !player.isAlive) {
      return;
    }

    if (userId === this.game.captain) {
      await client.chat.postEphemeral({
        channel: this.channelId,
        user: userId,
        text: 'The Captain cannot vote in a mutiny!'
      });
      return;
    }

    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'mutiny_vote_modal',
          private_metadata: this.channelId,
          title: {
            type: 'plain_text',
            text: 'Mutiny Vote'
          },
          submit: {
            type: 'plain_text',
            text: 'Submit'
          },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `You have *${player.guns}* guns available.\n\nHow many guns do you want to use for the mutiny?`
              }
            },
            {
              type: 'input',
              block_id: 'guns_input',
              element: {
                type: 'number_input',
                action_id: 'guns_count',
                is_decimal_allowed: false,
                min_value: '0',
                max_value: String(player.guns)
              },
              label: {
                type: 'plain_text',
                text: 'Number of Guns'
              }
            }
          ]
        }
      });
    } catch (error) {
      console.error('Error opening mutiny modal:', error);
    }
  }

  async handleViewSubmission(view: any, body: any, client: WebClient): Promise<void> {
    if (view.callback_id === 'mutiny_vote_modal') {
      const userId = body.user.id;
      const gunsCount = parseInt(view.state.values.guns_input.guns_count.value);

      this.mutinyVotes.set(userId, gunsCount);

      await client.chat.postEphemeral({
        channel: this.channelId,
        user: userId,
        text: `Your mutiny vote has been recorded: ${gunsCount} guns`
      });

      // Check if all eligible voters have voted
      if (this.mutinyVotes.size === this.mutinyEligibleVoters.size) {
        // All votes are in, resolve immediately
        await this.resolveMutiny();
      } else {
        // Update the mutiny phase message with vote count
        await client.chat.postMessage({
          channel: this.channelId,
          text: `_Vote recorded. Votes: ${this.mutinyVotes.size}/${this.mutinyEligibleVoters.size}_`
        });
      }
    }
  }
}
