type GameStatus = 'WAITING' | 'IN_PROGRESS' | 'COMPLETED';
type GamePhase = 'LOBBY' | 'NIGHT' | 'NAVIGATION_SELECTION' | 'MUTINY' | 'NAVIGATION' | 'VOTING' | 'FEED_KRAKEN';
type PlayerRole = 'SAILOR' | 'PIRATE' | 'CULT_LEADER' | 'CULTIST';
type WinnerType = 'SAILORS' | 'PIRATES' | 'CULT' | null;

interface Player {
  userId: string;
  username: string;
  role: PlayerRole | null;
  isAlive: boolean;
  guns: number;
  characterCard: string | null;
  characterUsed: boolean;
}

interface AddPlayerResult {
  success: boolean;
  message: string;
}

interface WinCondition {
  winner: WinnerType;
  reason: string | null;
}

interface Position {
  x: number;
  y: number;
}

export class GameState {
  channelId: string;
  hostId: string;
  players: Map<string, Player>;
  status: GameStatus;
  currentTurn: number;
  currentPhase: GamePhase;
  captain: string | null;
  lieutenant: string | null;
  navigator: string | null;
  shipPosition: Position;
  cultLeader: string | null;
  createdAt: number;

  constructor(channelId: string, hostId: string) {
    this.channelId = channelId;
    this.hostId = hostId;
    this.players = new Map();
    this.status = 'WAITING';
    this.currentTurn = 0;
    this.currentPhase = 'LOBBY';
    this.captain = null;
    this.lieutenant = null;
    this.navigator = null;
    this.shipPosition = { x: 0, y: 0 };
    this.cultLeader = null;
    this.createdAt = Date.now();
  }

  addPlayer(userId: string, username: string): AddPlayerResult {
    if (this.players.has(userId)) {
      return { success: false, message: 'You are already in the game!' };
    }

    if (this.status !== 'WAITING') {
      return { success: false, message: 'Game has already started!' };
    }

    this.players.set(userId, {
      userId,
      username,
      role: null,
      isAlive: true,
      guns: 3,
      characterCard: null,
      characterUsed: false
    });

    return {
      success: true,
      message: `<@${userId}> has joined the game! (${this.players.size} players)`
    };
  }

  getPlayer(userId: string): Player | undefined {
    return this.players.get(userId);
  }

  getAllPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  getAlivePlayers(): Player[] {
    return this.getAllPlayers().filter(p => p.isAlive);
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  isHost(userId: string): boolean {
    return this.hostId === userId;
  }

  canStart(): boolean {
    return this.players.size >= 5 && this.status === 'WAITING';
  }

  start(): void {
    if (!this.canStart()) {
      throw new Error('Cannot start game - need at least 5 players');
    }

    this.status = 'IN_PROGRESS';
    this.currentPhase = 'NIGHT';
    this.assignRoles();
    this.assignCaptain();
  }

  assignRoles(): void {
    const playerCount = this.players.size;
    const playerArray = Array.from(this.players.values());

    // Shuffle players
    for (let i = playerArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playerArray[i], playerArray[j]] = [playerArray[j], playerArray[i]];
    }

    // Role distribution based on player count
    let pirateCount: number, cultLeaderCount: number, cultistCount: number;

    if (playerCount === 5) {
      pirateCount = 2;
      cultLeaderCount = 1;
      cultistCount = 0;
    } else if (playerCount === 6) {
      pirateCount = 2;
      cultLeaderCount = 1;
      cultistCount = 0;
    } else if (playerCount === 7) {
      pirateCount = 2;
      cultLeaderCount = 1;
      cultistCount = 1;
    } else if (playerCount === 8) {
      pirateCount = 3;
      cultLeaderCount = 1;
      cultistCount = 1;
    } else {
      pirateCount = 3;
      cultLeaderCount = 1;
      cultistCount = 2;
    }

    let index = 0;

    // Assign Cult Leader
    for (let i = 0; i < cultLeaderCount; i++) {
      playerArray[index].role = 'CULT_LEADER';
      this.cultLeader = playerArray[index].userId;
      index++;
    }

    // Assign Pirates
    for (let i = 0; i < pirateCount; i++) {
      playerArray[index].role = 'PIRATE';
      index++;
    }

    // Assign Cultists
    for (let i = 0; i < cultistCount; i++) {
      playerArray[index].role = 'CULTIST';
      index++;
    }

    // Remaining are Sailors
    while (index < playerArray.length) {
      playerArray[index].role = 'SAILOR';
      index++;
    }
  }

  assignCaptain(): void {
    const alivePlayers = this.getAlivePlayers();
    if (alivePlayers.length > 0) {
      const randomIndex = Math.floor(Math.random() * alivePlayers.length);
      this.captain = alivePlayers[randomIndex].userId;
    }
  }

  rotateCaptain(): void {
    const alivePlayers = this.getAlivePlayers();
    const currentIndex = alivePlayers.findIndex(p => p.userId === this.captain);
    const nextIndex = (currentIndex + 1) % alivePlayers.length;
    this.captain = alivePlayers[nextIndex].userId;
  }

  setNavigationTeam(lieutenantId: string, navigatorId: string): void {
    this.lieutenant = lieutenantId;
    this.navigator = navigatorId;
  }

  eliminatePlayer(userId: string): void {
    const player = this.getPlayer(userId);
    if (player) {
      player.isAlive = false;

      if (this.captain === userId) {
        this.rotateCaptain();
      }
    }
  }

  checkWinCondition(): WinCondition {
    if (this.shipPosition.x >= 10 && this.shipPosition.y >= 5) {
      return { winner: 'SAILORS', reason: 'The ship reached Bluewater Bay!' };
    }

    if (this.shipPosition.x >= 10 && this.shipPosition.y <= -5) {
      return { winner: 'PIRATES', reason: 'The ship reached Crimson Cove!' };
    }

    if (this.shipPosition.y >= 10) {
      return { winner: 'CULT', reason: 'The ship was fed to the Kraken!' };
    }

    return { winner: null, reason: null };
  }

  moveShip(dx: number, dy: number): void {
    this.shipPosition.x += dx;
    this.shipPosition.y += dy;
  }

  nextPhase(): void {
    const phaseOrder: GamePhase[] = [
      'NAVIGATION_SELECTION',
      'MUTINY',
      'NAVIGATION',
      'VOTING'
    ];

    const currentIndex = phaseOrder.indexOf(this.currentPhase);

    if (currentIndex === -1 || currentIndex === phaseOrder.length - 1) {
      this.currentTurn++;
      this.currentPhase = 'NAVIGATION_SELECTION';
      this.rotateCaptain();
    } else {
      this.currentPhase = phaseOrder[currentIndex + 1];
    }
  }

  getStatusMessage(): string {
    const playerList = this.getAllPlayers()
      .map(p => `• <@${p.userId}> ${p.isAlive ? '' : '(eliminated)'}`)
      .join('\n');

    if (this.status === 'WAITING') {
      return `*Feed the Kraken - Waiting for Players*\n\nPlayers (${this.players.size}):\n${playerList}\n\nUse \`/kraken-join\` to join!\nHost: <@${this.hostId}> can use \`/kraken-begin\` to start (min 5 players)`;
    }

    const captain = this.getPlayer(this.captain!);
    const winCondition = this.checkWinCondition();

    if (winCondition.winner) {
      return `*Game Over!*\n\n${winCondition.reason}\n*${winCondition.winner}* wins!`;
    }

    return `*Feed the Kraken - Turn ${this.currentTurn}*\n\n` +
      `*Phase:* ${this.currentPhase}\n` +
      `*Captain:* <@${this.captain}>\n` +
      `*Ship Position:* (${this.shipPosition.x}, ${this.shipPosition.y})\n\n` +
      `Players:\n${playerList}`;
  }
}
