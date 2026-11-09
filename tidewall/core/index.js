// The core's one entry point: the rules model, ported from the private C# model and held to it tick for tick by
// test/parity/run.mjs. Plain ES modules; no DOM; runs in the browser and in Node 18+.

export { Cell } from './cell.js';
export { SeededRandom } from './random.js';
export { Terrain, Occupant, Castle, GridModel, Fnv64 } from './grid.js';
export { PieceShape, PieceCatalog } from './pieces.js';

export { CellMath } from './rules/CellMath.js';
export { PlacementResult, PlacementRules } from './rules/PlacementRules.js';
export { PathResult, PathRules } from './rules/PathRules.js';
export { EnclosureRules, Territory } from './rules/EnclosureRules.js';
export { GameRules, BombRules, ItemKind, ItemNames, RoundKind, RoundSpec, RoundTable } from './rules/GameRules.js';
export { GameType, Battlefield, Difficulty, GameOptions, Campaign } from './rules/Campaign.js';
export { MapCheck } from './rules/MapCheck.js';

export { CommandKind, Command } from './match/Commands.js';
export { PlaceWallCommand } from './match/PlaceWallCommand.js';
export { PieceDealer, Streams } from './match/PieceDealer.js';
export { Phase, GunKind, ShipKind, PlayerModel, CannonModel, ShipModel, GruntModel, ShotModel, BombModel, TrapModel } from './match/Entities.js';
export { BombWorld } from './match/Bombs.js';
export * from './match/Events.js';
export { MatchModel } from './match/MatchModel.js';

// ---- CONTROL's exports go below this line ----
// CONTROL exports
export { PlaybackQueue } from './controller/PlaybackQueue.js';
export { PadInput, PlaceKind, Ghost, MatchController } from './controller/MatchController.js';
export { MenuInput, Screen, MenuActionKind, MenuAction, MenuModel, HighScoreTable } from './controller/MenuModel.js';
export { PlayerHud, HudViewModel } from './controller/HudViewModel.js';
export { PieceMap, WallOutline } from './controller/WallOutline.js';
export { CastleBot } from './bots/CastleBot.js';
export { Synth } from './audio/Synth.js';
// end CONTROL exports
