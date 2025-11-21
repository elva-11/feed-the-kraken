import { GameState } from './GameState.js';
import type { WebClient } from '@slack/web-api';

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
  captainNavigationChoice?: NavigationMovement;
  lieutenantNavigationChoice?: NavigationMovement;
  captainChoiceLocked: boolean;
  lieutenantChoiceLocked: boolean;
  navigatorChoiceLocked: boolean;
  lastMutinySucceeded: boolean;

  constructor(gameState: GameState, client: WebClient, channelId: string) {
    this.game = gameState;
    this.client = client;
    this.channelId = channelId;
    this.mutinyVotes = new Map();
    this.navigationCards = [];
    this.mutinyEligibleVoters = new Set();
    this.captainChoiceLocked = false;
    this.lieutenantChoiceLocked = false;
    this.navigatorChoiceLocked = false;
    this.lastMutinySucceeded = false;
  }

  async startTurn(): Promise<void> {
    const wasVotingPhase = this.game.currentPhase === 'VOTING';

    this.game.nextPhase();

    // If we just finished a turn and lieutenant/navigator are already set, skip to MUTINY
    if (wasVotingPhase && this.game.lieutenant && this.game.navigator && this.game.currentPhase === 'NAVIGATION_SELECTION') {
      this.game.currentPhase = 'MUTINY';
    }

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
    const alivePlayers = this.game.getAlivePlayers()
      .filter(p => p.userId !== this.game.captain);

    const playerOptions = alivePlayers.map(p => ({
      text: {
        type: 'plain_text' as const,
        text: p.username || `Player ${p.userId}`
      },
      value: p.userId
    }));

    // Post public announcement
    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `*Turn ${this.game.currentTurn} - Navigation Selection*\n\n<@${this.game.captain}> is the Captain and must select a Lieutenant and Navigator!`
    });

    // Send role selection interface only to the captain (ephemeral)
    await this.client.chat.postEphemeral({
      channel: this.channelId,
      user: this.game.captain!,
      text: `Select Lieutenant and Navigator (only visible to you)`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Select your navigation team* (only visible to you)`
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

      // Elect new captain based on who has the most guns (randomize if tie)
      this.game.electCaptainByGuns();

      resultMessage += `The new Captain is <@${this.game.captain}>! (Elected based on gun count)\n\n`;
      resultMessage += `The new Captain must now select a Lieutenant and Navigator!`;

      // Track that mutiny succeeded so we can trigger another mutiny after role selection
      this.lastMutinySucceeded = true;

      // Go back to NAVIGATION_SELECTION phase for new captain to choose roles
      this.game.currentPhase = 'NAVIGATION_SELECTION';
    } else {
      resultMessage += `✅ *Mutiny fails.*\n\n<@${previousCaptain}> remains Captain.`;

      // Move to next phase normally
      this.game.currentPhase = 'NAVIGATION';
      this.lastMutinySucceeded = false;
    }

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: resultMessage
    });

    await this.executePhase();
  }

  async navigationPhase(): Promise<void> {
    // Reset navigation choices and locks
    this.captainNavigationChoice = undefined;
    this.lieutenantNavigationChoice = undefined;
    this.captainChoiceLocked = false;
    this.lieutenantChoiceLocked = false;
    this.navigatorChoiceLocked = false;

    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `*Navigation Phase*\n\nThe Captain and Lieutenant will each choose a direction, then the Navigator picks one!`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Navigation Phase* 🧭\n\nCaptain: <@${this.game.captain}>\nLieutenant: <@${this.game.lieutenant}>\nNavigator: <@${this.game.navigator}>\n\n${this.game.getShipVisualization()}\n\nThe Captain and Lieutenant are choosing navigation options...`
          }
        }
      ]
    });

    await this.sendNavigationChoiceCards(this.game.captain!, 'captain');
    await this.sendNavigationChoiceCards(this.game.lieutenant!, 'lieutenant');
  }

  async sendNavigationChoiceCards(userId: string, role: 'captain' | 'lieutenant'): Promise<void> {
    // Only use cardinal directions (N, S, E, W)
    const allDirections: NavigationDirection[] = [
      { name: 'North ⬆️', dx: 0, dy: 1 },
      { name: 'South ⬇️', dx: 0, dy: -1 },
      { name: 'East ➡️', dx: 1, dy: 0 },
      { name: 'West ⬅️', dx: -1, dy: 0 }
    ];

    // Randomly select 2 directions
    const shuffled = [...allDirections].sort(() => Math.random() - 0.5);
    const directions = shuffled.slice(0, 2);

    const buttons = directions.map(dir => ({
      type: 'button' as const,
      text: {
        type: 'plain_text' as const,
        text: dir.name
      },
      action_id: `nav_choice_${role}_${dir.dx}_${dir.dy}`,
      value: JSON.stringify({ dx: dir.dx, dy: dir.dy, channelId: this.channelId, role })
    }));

    try {
      await this.client.chat.postMessage({
        channel: userId,
        text: 'Choose a navigation direction option:',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Choose a navigation option for the Navigator:*\n\n${this.game.getShipVisualization()}\n\nSelect a direction:`
            }
          },
          {
            type: 'actions',
            elements: buttons
          }
        ]
      });
    } catch (error) {
      console.error(`Failed to send navigation choice cards to ${userId}:`, error);
    }
  }

  async sendNavigatorFinalChoice(): Promise<void> {
    if (!this.captainNavigationChoice || !this.lieutenantNavigationChoice) {
      console.error('Missing navigation choices');
      return;
    }

    const choices = [
      {
        movement: this.captainNavigationChoice,
        name: this.getDirectionName(this.captainNavigationChoice),
        from: 'Captain',
        role: 'captain'
      },
      {
        movement: this.lieutenantNavigationChoice,
        name: this.getDirectionName(this.lieutenantNavigationChoice),
        from: 'Lieutenant',
        role: 'lieutenant'
      }
    ];

    const buttons = choices.map(choice => ({
      type: 'button' as const,
      text: {
        type: 'plain_text' as const,
        text: `${choice.name} (from ${choice.from})`
      },
      action_id: `navigate_final_${choice.role}_${choice.movement.dx}_${choice.movement.dy}`,
      value: JSON.stringify({ dx: choice.movement.dx, dy: choice.movement.dy, channelId: this.channelId })
    }));

    try {
      await this.client.chat.postMessage({
        channel: this.game.navigator!,
        text: 'Choose which direction to navigate:',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Choose one of the two navigation options:*\n\n${this.game.getShipVisualization()}`
            }
          },
          {
            type: 'actions',
            elements: buttons
          }
        ]
      });

      await this.client.chat.postMessage({
        channel: this.channelId,
        text: `The Captain and Lieutenant have chosen their directions. Waiting for <@${this.game.navigator}> to make the final choice...`
      });
    } catch (error) {
      console.error(`Failed to send final navigation choice to navigator:`, error);
    }
  }

  getDirectionName(movement: NavigationMovement): string {
    const { dx, dy } = movement;
    if (dx === 0 && dy === 1) return 'North ⬆️';
    if (dx === 0 && dy === -1) return 'South ⬇️';
    if (dx === 1 && dy === 0) return 'East ➡️';
    if (dx === -1 && dy === 0) return 'West ⬅️';
    if (dx === 1 && dy === 1) return 'Northeast ↗️';
    if (dx === 1 && dy === -1) return 'Southeast ↘️';
    return `(${dx}, ${dy})`;
  }

  async votingPhase(): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channelId,
      text: `*Discussion Phase*\n\nDiscuss what happened!`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Discussion Phase* 🗳️\n\nDiscuss what happened and decide on any actions!\n\n${this.game.getShipVisualization()}`
          }
        }
      ]
    });

    // Automatically end turn after 30 seconds
    setTimeout(async () => {
      await this.endTurn();
    }, 30000);
  }

  async endTurn(): Promise<void> {
    const winCondition = this.game.checkWinCondition();
    if (winCondition.winner) {
      await this.client.chat.postMessage({
        channel: this.channelId,
        text: `*Game Over!*\n\n${winCondition.reason}\n\n*${winCondition.winner}* wins! 🎉\n\n${this.game.getShipVisualization()}`
      });
    } else {
      await this.startTurn();
    }
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

        // Validate that Lieutenant and Navigator are not the same person
        if (this.selectedLieutenant === this.selectedNavigator) {
          await client.chat.postEphemeral({
            channel: this.channelId,
            user: userId,
            text: 'Lieutenant and Navigator must be different people! Please make different selections.'
          });
          return;
        }

        this.game.setNavigationTeam(this.selectedLieutenant, this.selectedNavigator);

        await client.chat.postMessage({
          channel: this.channelId,
          text: `Navigation team selected!\nLieutenant: <@${this.selectedLieutenant}>\nNavigator: <@${this.selectedNavigator}>`
        });

        // If the last mutiny succeeded, trigger another mutiny phase
        // Otherwise, proceed normally to mutiny phase
        this.game.currentPhase = 'MUTINY';

        // Reset the flag after using it
        if (this.lastMutinySucceeded) {
          this.lastMutinySucceeded = false;
        }

        await this.executePhase();
        break;

      case 'cast_mutiny_vote':
        await this.openMutinyVoteModal(userId, client, body);
        break;

      case 'end_turn':
        await this.endTurn();
        break;

      default:
        // Handle captain/lieutenant navigation choices
        if (action.action_id.startsWith('nav_choice_captain_')) {
          if (this.captainChoiceLocked) {
            await client.chat.postEphemeral({
              channel: userId,
              user: userId,
              text: 'You have already made your choice and cannot change it!'
            });
            return;
          }

          if (userId !== this.game.captain) {
            await client.chat.postEphemeral({
              channel: this.channelId,
              user: userId,
              text: 'Only the Captain can choose this!'
            });
            return;
          }

          const payload = JSON.parse(action.value);
          this.captainNavigationChoice = { dx: payload.dx, dy: payload.dy };
          this.captainChoiceLocked = true;

          await client.chat.postEphemeral({
            channel: userId,
            user: userId,
            text: `Your choice has been recorded: ${this.getDirectionName(this.captainNavigationChoice)}`
          });

          // Check if both choices are in
          if (this.lieutenantNavigationChoice) {
            await this.sendNavigatorFinalChoice();
          }
        } else if (action.action_id.startsWith('nav_choice_lieutenant_')) {
          if (this.lieutenantChoiceLocked) {
            await client.chat.postEphemeral({
              channel: userId,
              user: userId,
              text: 'You have already made your choice and cannot change it!'
            });
            return;
          }

          if (userId !== this.game.lieutenant) {
            await client.chat.postEphemeral({
              channel: this.channelId,
              user: userId,
              text: 'Only the Lieutenant can choose this!'
            });
            return;
          }

          const payload = JSON.parse(action.value);
          this.lieutenantNavigationChoice = { dx: payload.dx, dy: payload.dy };
          this.lieutenantChoiceLocked = true;

          await client.chat.postEphemeral({
            channel: userId,
            user: userId,
            text: `Your choice has been recorded: ${this.getDirectionName(this.lieutenantNavigationChoice)}`
          });

          // Check if both choices are in
          if (this.captainNavigationChoice) {
            await this.sendNavigatorFinalChoice();
          }
        } else if (action.action_id.startsWith('navigate_final_')) {
          // Navigator's final choice
          if (this.navigatorChoiceLocked) {
            await client.chat.postEphemeral({
              channel: userId,
              user: userId,
              text: 'You have already made your choice and cannot change it!'
            });
            return;
          }

          if (userId !== this.game.navigator) {
            await client.chat.postEphemeral({
              channel: this.channelId,
              user: userId,
              text: 'Only the Navigator can choose this!'
            });
            return;
          }

          const payload = JSON.parse(action.value);
          const movement: NavigationMovement = { dx: payload.dx, dy: payload.dy };
          this.navigatorChoiceLocked = true;
          this.game.moveShip(movement.dx, movement.dy);

          await client.chat.postMessage({
            channel: this.channelId,
            text: `<@${userId}> (Navigator) chose ${this.getDirectionName(movement)}!\n\n${this.game.getShipVisualization()}`
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
