// port of runtime/U2ue.Runtime/PlaybackQueue.cs
//
// The consumer that turns an INSTANT model into a watchable game: the model decides a whole tick at once and appends events to an
// ordered, append-only list; this queue shows that list one event at a time, and only when the presenter has finished showing the
// last one. So the model never waits, a slow view simply plays slower, and nothing stacks.
//
// A presenter (C# IPresenter<TEvent>) is any object with an `isIdle` property (false while something it started is still animating)
// and a `present(e)` method (start showing one event).

export class PlaybackQueue {
  constructor(presenter) {
    if (presenter === null || presenter === undefined) throw new TypeError('PlaybackQueue: presenter is required');
    this._presenter = presenter;
    this._pending = [];
    this._next = 0;
  }

  /** Events accepted but not yet shown. Zero means the view has caught up with the model. */
  get backlog() { return this._pending.length - this._next; }

  /** Events shown so far. */
  get shown() { return this._next; }

  /** True when every event has been shown AND the presenter has finished showing it - the one condition under which a player may
   *  act (acting into an animation not yet seen is fighting a board that is not on screen). */
  get isCaughtUp() { return this.backlog === 0 && this._presenter.isIdle; }

  /** Take the model's WHOLE history; only what is new is queued, so a host may hand it over every frame. A history that SHRINKS is
   *  refused: the model's event list only grows, so a shorter one is a different model or a reset. */
  accept(history) {
    if (history === null || history === undefined) throw new TypeError('PlaybackQueue.accept: history is required');
    if (history.length < this._pending.length)
      throw new Error('the model\'s event history shrank from ' + this._pending.length + ' to ' + history.length
        + ' events - a history only grows; a shorter one is a different model or a reset, so this queue refuses it '
        + '(make a new queue for a new model)');
    for (let i = this._pending.length; i < history.length; i++) this._pending.push(history[i]);
  }

  /** Show at most one event, and only when the presenter is idle. True when something was shown. */
  tick() {
    if (this._next >= this._pending.length || !this._presenter.isIdle) return false;
    const e = this._pending[this._next];
    this._next++;
    this._presenter.present(e);
    return true;
  }

  /** Show everything now, in order, with no pacing - for headless runs and tests, where nothing watches. */
  drainImmediately() {
    while (this._next < this._pending.length) {
      const e = this._pending[this._next];
      this._next++;
      this._presenter.present(e);
    }
  }
}
