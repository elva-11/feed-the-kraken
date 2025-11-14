# Feed the Kraken - Slack Bot

A Slack Socket Mode application that brings the social deduction board game "Feed the Kraken" to your Slack workspace.

## Game Overview

Feed the Kraken is a hidden role deduction game where players are secretly assigned to different factions:
- **Loyal Sailors**: Navigate the ship to Bluewater Bay (blue area)
- **Pirates**: Steer the ship to Crimson Cove (red area)
- **Cult**: Feed the ship to the Kraken (North)

## Setup Instructions

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Choose "From scratch" and give it a name (e.g., "Feed the Kraken")
3. Select your workspace

### 2. Enable Socket Mode

1. Go to **Settings** > **Socket Mode**
2. Enable Socket Mode
3. Generate an app-level token with `connections:write` scope
4. Save this token (starts with `xapp-`)

### 3. Configure Bot Permissions

1. Go to **OAuth & Permissions**
2. Add the following Bot Token Scopes:
   - `chat:write`
   - `chat:write.public`
   - `commands`
   - `users:read`
   - `channels:read`
   - `groups:read`
   - `im:write`

3. Install the app to your workspace
4. Save the Bot User OAuth Token (starts with `xoxb-`)

### 4. Create Slash Commands

Go to **Slash Commands** and create the following:

- `/kraken-start` - Start a new game
- `/kraken-join` - Join an existing game
- `/kraken-begin` - Begin the game (host only)
- `/kraken-status` - View current game status

### 5. Enable Interactivity

1. Go to **Interactivity & Shortcuts**
2. Turn on Interactivity
3. Since we're using Socket Mode, you don't need a Request URL

### 6. Install Dependencies

```bash
npm install
```

### 7. Configure Environment Variables

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Fill in your tokens in `.env`:
```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
```

### 8. Run the Application

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## How to Play

### Starting a Game

1. In any channel, use `/kraken-start` to create a new game
2. Other players use `/kraken-join` to join
3. Need at least 5 players to start
4. The host uses `/kraken-begin` to start the game

### Game Flow

1. **Role Assignment**: Each player receives their secret role via DM
   - Sailors work together (don't know each other)
   - Pirates know each other
   - Cult Leader can convert players to cultists

2. **Turn Structure**:
   - **Navigation Selection**: Captain selects Lieutenant and Navigator
   - **Mutiny Phase**: Crew members can vote to mutiny
   - **Navigation**: Navigation team plays cards to move the ship
   - **Voting/Discussion**: Players discuss and decide on actions

3. **Winning**:
   - Sailors win if ship reaches Bluewater Bay
   - Pirates win if ship reaches Crimson Cove
   - Cult wins if ship reaches the Kraken or Cult Leader is fed to Kraken

### Commands During Game

- `/kraken-status` - View current game state and ship position

## Game Features Implemented

- ✅ Role assignment (Sailors, Pirates, Cult Leader, Cultists)
- ✅ Secret role distribution via DMs
- ✅ Turn-based gameplay with phases
- ✅ Captain selection and rotation
- ✅ Navigation team selection
- ✅ Mutiny voting system
- ✅ Ship movement and position tracking
- ✅ Win condition checking
- ✅ Interactive Slack UI with buttons and modals

## Customization

You can customize the game by editing:

- `src/game/GameState.js` - Game rules, role distribution, win conditions
- `src/game/TurnManager.js` - Turn phases and gameplay mechanics
- `src/game/GameManager.js` - Game lifecycle and messaging

## Future Enhancements

- Navigation card deck system
- Character abilities
- Feed the Kraken voting
- Cabin search mechanics
- Cult conversion system
- Game board visualization
- Timed phases
- Game history and statistics

## License

MIT
