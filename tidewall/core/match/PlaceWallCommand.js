// port of model/Match/PlaceWallCommand.cs

/** The first slice's wall-only command shape; MatchModel.stepWalls turns it into a Command.placeWall. New code uses Command. */
export class PlaceWallCommand {
  constructor(slot, seq, shapeId, quarterTurns, anchor, arrival) {
    this.slot = slot; this.seq = seq; this.shapeId = shapeId; this.quarterTurns = quarterTurns; this.anchor = anchor; this.arrival = arrival;
    Object.freeze(this);
  }
}
