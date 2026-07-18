/** Read-only follow-cam spectator. No movement, weapons, or seats. */

export class SpectatorController {
  constructor({ ghosts, onStatus, onExit, onTargetChange }) {
    this.ghosts = ghosts;
    this.onStatus = onStatus || (() => {});
    this.onExit = onExit || (() => {});
    this.onTargetChange = onTargetChange || (() => {});
    this.active = false;
    this.index = 0;
    this._onKey = this._onKey.bind(this);
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.index = 0;
    window.addEventListener('keydown', this._onKey, true);
    this.refreshStatus();
    this.onTargetChange(this.currentName(), this.currentGhost());
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('keydown', this._onKey, true);
  }

  /** @returns {string[]} */
  targets() {
    // Include dead players so spectate can stay on them through respawn.
    const names = [];
    this.ghosts.forEach((name) => {
      names.push(name);
    });
    names.sort();
    return names;
  }

  currentName() {
    const t = this.targets();
    if (!t.length) return null;
    if (this.index < 0 || this.index >= t.length) this.index = 0;
    return t[this.index];
  }

  currentGhost() {
    const name = this.currentName();
    if (!name) return null;
    return this.ghosts.ghosts.get(name) || null;
  }

  cycle(dir) {
    const t = this.targets();
    if (!t.length) {
      this.index = 0;
      this.refreshStatus();
      this.onTargetChange(null, null);
      return;
    }
    this.index = (this.index + dir + t.length * 50) % t.length;
    this.refreshStatus();
    this.onTargetChange(this.currentName(), this.currentGhost());
  }

  refreshStatus() {
    const name = this.currentName();
    const n = this.targets().length;
    this.onStatus(
      name
        ? `Spectating · Esc back`
        : 'Spectating · waiting for players · Esc back',
    );
    this.onTargetChange(name, this.currentGhost());
  }

  _onKey(event) {
    if (!this.active) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.onExit();
      return;
    }
    if (event.code === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      this.cycle(-1);
      return;
    }
    if (event.code === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      this.cycle(1);
    }
  }
}
