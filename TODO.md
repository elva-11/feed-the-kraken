# TODO

## Enhancement/Fixes 1
- ~~When user starts game notify users that that specific user has started a game and joined the game.~~
- ~~Remove sending message to publically channel `you are already in the game.` make only visible to user that is trying to join~~
- Navigation Selection
  - Captain should not be able to select the same person as Lieutenant and Navigator
  - Fix users not being able to see name of users in Navigation Selection, player name should up as `Player`
- Mutiny Phase Enhancements
  - If mutiny succeeds the user with the most guns should get elected, if multiple user has the same amount of gun randomize user that is elected captain.
  - Another mutiny phase always occurs after the new captain chooses roles for lieutenant and navigator.
- On new turn the captain should be the same captain from the previous turn.
- The role select should only be visible for the captain to view `only visible to you`.
```
Select Lieutenant:
Select Navigator:
```

## Enhancements/Fixes 2
- Mutiny Phase only occurs when the lieutenant and navigator has already been previously chosen.
- New Turn
  - On the new turn the captain should not have to select the lieutenant and navigator again, use previous lieutenant and navigator then start a new mutiny phase.
- Navigation Phase
  - Captain and lietenant should only get 2 random directions to choose from. N,S,E,W.
  - Captain, lieutenant, navigator roles should not be able to change choices after making their choice for their actions/selections.

## Enhancements/Fixes 3
- Still showing multiple directions than we want in the 
- Kill discussion phase
- Captain should not have to select roles again on new turn....
- Look into gun count logic.



- **Enhancement**:
  - Move DMs to user from bot to messages inside the channel
  - Implement `/kraken-end`
  - Separate thread for a game.
  - Mutiny timeout.
  - Captain should not be able to mutiny themselves
  - Store in db
  - Fix shitty map