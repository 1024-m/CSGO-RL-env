import { GhostManager } from './ghosts.js';
import { LocalCombat, damageFor, grenadeDamageAt, DAMAGE, inFlameCone, meleeHit } from './combat.js';

const STATE_HZ = 45;
const STATE_INTERVAL = 1 / STATE_HZ;
const LOBBY_POLL_MS = 1000;
const HEARTBEAT_MS = 3000;

function wsUrl(spaceUrl, mode, lobbyId, username, role = 'play') {
  const base = (spaceUrl || window.location.origin).replace(/\/$/, '');
  const u = new URL(base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = `/ws/match/${encodeURIComponent(mode)}/${encodeURIComponent(lobbyId)}`;
  u.search = `user=${encodeURIComponent(username)}&role=${encodeURIComponent(role)}`;
  return u.toString();
}

export class NetClient {
  constructor({ scene, onStatus, onMatchStart, onMatchEnd, onLobbyUpdate, onMatchConnectionLost }) {
    this.scene = scene;
    this.onStatus = onStatus || (() => {});
    this.onMatchStart = onMatchStart || (() => {});
    this.onMatchEnd = onMatchEnd || (() => {});
    this.onLobbyUpdate = onLobbyUpdate || (() => {});
    this.onMatchConnectionLost = onMatchConnectionLost || (() => {});

    this.username = null;
    this.avatarUrl = null;
    this.spaceUrl = null;
    this.playAllowed = true;
    this.mode = null; // sandbox | 1v1 | 4v4
    this.lobbyId = null;
    this.seat = null;
    this.side = null;
    this.matchId = null;
    this.inMatch = false;
    this.ws = null;
    this.ghosts = new GhostManager(scene);
    this.combat = new LocalCombat();
    this.board = null;
    this._pollTimer = null;
    this._hbTimer = null;
    this._stateAcc = 0;
    this._flameAcc = 0;
    this._spawnIndex = 0;
    this.players = [];
    this.teamAlive = { teamA: true, teamB: true };
    this.spectating = false;

    this.combat.onDeath = (from) => {
      if (this.spectating) return;
      this.send({ type: 'state', pos: this._lastPos, rot: this._lastRot, hp: 0, alive: false, weapon: this._weapon });
      this._checkTeamWipe();
    };
  }

  async initLocal() {
    const cfg = await fetch('/api/config').then((r) => r.json());
    // spaceUrl = match WS host when Space is up. Lobby HTTP is always same-origin.
    this.spaceUrl = cfg.spaceUrl || '';
    this.username = cfg.username || null;
    this.host = cfg.host || 'local';
    // Space is spectate-only. Never treat missing playAllowed as "allow".
    this.playAllowed = cfg.host === 'space' ? false : cfg.playAllowed !== false;
    this.avatarUrl = cfg.avatarUrl || (this.username && !String(this.username).startsWith('guest-')
      ? `https://huggingface.co/avatars/${encodeURIComponent(this.username)}`
      : null);
    if (!this.username) {
      return { ok: false, error: cfg.authError || 'No player identity' };
    }
    // Local play must be a real HF user — never a guest-* cookie identity.
    if (this.host === 'local' && String(this.username).startsWith('guest-')) {
      return { ok: false, error: 'Local play requires HF_TOKEN (guest ids are spectate-only on Space)' };
    }
    if (this.playAllowed && cfg.hasToken === false && this.host !== 'space') {
      return { ok: false, error: cfg.authError || 'Set HF_TOKEN in .env.local' };
    }
    return {
      ok: true,
      username: this.username,
      avatarUrl: this.avatarUrl,
      spaceUrl: this.spaceUrl || window.location.origin,
      playAllowed: this.playAllowed,
      host: this.host,
    };
  }

  _lobbyBase() {
    // Claims / lobby poll always hit same origin (local proxies to Space with HF token).
    return '';
  }

  async _fetchLobbies() {
    const res = await fetch(`${this._lobbyBase()}/api/lobbies`);
    if (!res.ok) throw new Error(`Lobby server ${res.status}`);
    const board = await res.json();
    if (!board?.duel && !board?.sandbox) throw new Error('Bad lobby payload');
    return board;
  }

  startLobbyPoll(mode) {
    this.mode = mode;
    this.stopLobbyPoll();
    const tick = async () => {
      try {
        const board = await this._fetchLobbies();
        this.board = board;
        this.onLobbyUpdate(board, mode, null);
      } catch (err) {
        this.onStatus(`Lobby poll failed: ${err.message}`);
        this.onLobbyUpdate(null, mode, err.message || String(err));
      }
    };
    tick();
    this._pollTimer = setInterval(tick, LOBBY_POLL_MS);
    this._hbTimer = setInterval(() => {
      if (!this.username) return;
      const base = this._lobbyBase();
      fetch(`${base}/api/lobbies/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.username }),
      }).catch(() => {});
    }, HEARTBEAT_MS);
  }

  stopLobbyPoll() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._hbTimer) clearInterval(this._hbTimer);
    this._pollTimer = null;
    this._hbTimer = null;
  }

  async claim(mode, lobbyId, seat) {
    if (!this.playAllowed) throw new Error('Play disabled here — spectate only');
    // Always same-origin — local host proxies to Space with HF_TOKEN.
    const res = await fetch(`/api/lobbies/${encodeURIComponent(mode)}/${encodeURIComponent(lobbyId)}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        seat,
        avatarUrl: this.avatarUrl || null,
      }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`claim failed (${res.status})`);
    }
    if (!res.ok || !data.ok) throw new Error(data.error || `claim failed (${res.status})`);
    this.mode = mode;
    this.lobbyId = lobbyId;
    this.seat = seat;
    this.side = seatSide(seat);
    this.matchId = data.matchId || null;
    return data;
  }

  async leaveLobby() {
    this.disconnectMatch();
    if (!this.username) return;
    const base = this._lobbyBase();
    await fetch(`${base}/api/lobbies/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username }),
    }).catch(() => {});
    this.lobbyId = null;
    this.seat = null;
  }

  connectMatch() {
    if (!this.playAllowed || this.host === 'space') {
      this.onStatus('Play disabled here — spectate only');
      return;
    }
    if (!this.lobbyId || !this.mode) return;
    this._openMatchWs('play');
  }

  /** Watch a live / starting lobby without taking a seat. */
  connectSpectate(mode, lobbyId) {
    if (!mode || !lobbyId || !this.username) return;
    this.mode = mode;
    this.lobbyId = lobbyId;
    this.seat = null;
    this.side = 'ffa';
    this.spectating = true;
    this._openMatchWs('spectate');
  }

  _openMatchWs(role) {
    // Space host can never open a play socket from the browser.
    if (this.host === 'space' || !this.playAllowed) role = 'spectate';
    this.disconnectMatch(false);
    this.spectating = role === 'spectate';
    const url = wsUrl(this.spaceUrl, this.mode, this.lobbyId, this.username, role);
    this.onStatus(this.spectating ? 'Connecting as spectator…' : 'Connecting to match…');
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.onStatus(this.spectating ? 'Waiting for match (spectate)…' : 'Waiting for match start…');
      this.send({ type: 'ready', username: this.username });
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this._onMessage(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      const wasInMatch = this.inMatch;
      const wasSpectating = this.spectating;
      this.ws = null;
      this.inMatch = false;
      this.onStatus('Match connection closed');
      // Don't leave the user on a black gameplay canvas with an empty lobby.
      if (wasInMatch || wasSpectating) {
        this.onMatchConnectionLost({ wasInMatch, wasSpectating });
      }
    };

    ws.onerror = () => {
      this.onStatus('Match WebSocket error');
    };
  }

  disconnectMatch(clearGhosts = true) {
    const ws = this.ws;
    this.ws = null; // prevent onclose from treating intentional close as a drop
    this.inMatch = false;
    this.matchId = null;
    this.spectating = false;
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    if (clearGhosts) this.ghosts.clear();
  }

  send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.spectating && msg?.type && msg.type !== 'ping' && msg.type !== 'ready') return;
    this.ws.send(JSON.stringify(msg));
  }

  _onMessage(msg) {
    const type = msg.type;
    if (type === 'waiting') {
      this.onStatus('In lobby — waiting for match start…');
      return;
    }
    if (type === 'error') {
      this.onStatus(msg.error || 'Server error');
      // Fatal seat/match errors — drop the socket so UI can recover.
      if (/seat|seated|rejoin|lobby reset|match did not start/i.test(msg.error || '')) {
        try {
          this.ws?.close();
        } catch {
          // ignore
        }
      }
      return;
    }
    if (type === 'match_start') {
      this.inMatch = true;
      this.matchId = msg.matchId;
      this.players = msg.players || [];
      // Space / playAllowed=false is always spectate, even if server omits the flag.
      this.spectating =
        !!msg.spectating || this.spectating || !this.playAllowed || this.host === 'space';
      this.seat = this.spectating ? null : (msg.seat || this.seat);
      this.side = this.spectating ? 'ffa' : seatSide(this.seat);
      // Spectators see everyone (no self username to hide)
      const hideSelf = this.spectating ? null : this.username;
      this.ghosts.syncPlayers(this.players, hideSelf);
      this.combat.reset();
      this._spawnIndex = this.spectating ? 0 : spawnIndexFor(this.seat, this.mode, this.players);
      this.onMatchStart({
        mode: msg.mode || this.mode,
        seat: this.seat,
        side: this.side,
        players: this.players,
        spawnIndex: this._spawnIndex,
        spectating: this.spectating,
      });
      this.onStatus(this.spectating ? `Spectating ${this.mode} · ${this.lobbyId}` : `Match live — ${this.mode}`);
      return;
    }
    if (type === 'player_joined' || type === 'player_left') {
      this.players = msg.players || this.players;
      this.ghosts.syncPlayers(this.players, this.username);
      return;
    }
    if (type === 'state' && msg.from) {
      this.ghosts.applyState(msg.from, msg);
      return;
    }
    if (type === 'hit') {
      if (msg.target === this.username && !this.spectating) {
        this.combat.applyDamage(msg.damage || 0, msg.from);
        return;
      }
      // Spectate: vignette when the followed player is hit (HP also arrives via state).
      if (this.spectating && msg.target && this.onSpectateHit) {
        this.onSpectateHit(msg);
      }
      return;
    }
    if (type === 'fire' && msg.from && this.onRemoteFire) {
      // Drop combat FX while that player is reloading (all weapons, not just flame).
      if (this.ghosts.ghosts.get(msg.from)?.reloading) return;
      this.onRemoteFire(msg);
      return;
    }
    if (type === 'flame' && msg.from && this.onRemoteFlame) {
      if (this.ghosts.ghosts.get(msg.from)?.reloading) return;
      this.onRemoteFlame(msg);
      return;
    }
    if (type === 'grenade_throw' && msg.from && this.onRemoteGrenadeThrow) {
      if (this.ghosts.ghosts.get(msg.from)?.reloading) return;
      this.onRemoteGrenadeThrow(msg);
      return;
    }
    if (type === 'grenade_explode' && msg.from && this.onRemoteGrenadeExplode) {
      this.onRemoteGrenadeExplode(msg);
      return;
    }
    if (type === 'melee' && msg.from && this.onRemoteMelee) {
      if (this.ghosts.ghosts.get(msg.from)?.reloading) return;
      this.onRemoteMelee(msg);
      return;
    }
    if (type === 'match_end') {
      this.onMatchEnd(msg);
      this.onStatus(`Match over — ${msg.winner || 'draw'}`);
    }
  }

  /** Call each frame while in match */
  update(delta, player, weaponId, extras = {}) {
    if (!this.inMatch || !player) return;
    this.combat.update(performance.now() * 0.001);
    this.ghosts.update(delta);
    if (this.spectating) return;

    this._stateAcc += delta;
    if (this._stateAcc >= STATE_INTERVAL) {
      this._stateAcc = 0;
      const feet = player.position;
      this._lastPos = [feet.x, feet.y, feet.z];
      // [cameraYaw, cameraPitch, characterYaw] — body can diverge while strafing
      this._lastRot = [player.cameraYaw, player.cameraPitch, player.characterYaw];
      this._weapon = weaponId;
      const reloading = !!extras.reloading;
      const firing = !reloading && !!extras.firing;
      this.send({
        type: 'state',
        pos: this._lastPos,
        rot: this._lastRot,
        hp: this.combat.hp,
        alive: this.combat.alive,
        weapon: weaponId,
        ammo: extras.ammo || '',
        scope: !!extras.scope,
        reloading,
        firing,
        flame: firing && weaponId === 'flamethrower',
        avatarUrl: this.avatarUrl || undefined,
        action: player.isMoving?.() ? 'move' : 'idle',
      });
    }
  }

  // ── Combat helpers used by WeaponSystem ───────────────────────────

  tryHitscan(weaponId, origin, dir, { scoped = false } = {}) {
    if (!this.inMatch || this.spectating || !this.combat.alive) return null;
    const hit = this.ghosts.raycast(origin, dir, 80);
    const payload = {
      type: 'fire',
      weapon: weaponId,
      origin: [origin.x, origin.y, origin.z],
      dir: [dir.x, dir.y, dir.z],
      scoped: !!scoped,
    };
    if (!hit) {
      this.send(payload);
      return null;
    }
    const dmg = damageFor(weaponId, hit.zone);
    this.send({
      ...payload,
      hitUser: hit.username,
      zone: hit.zone,
      damage: dmg,
    });
    this.send({
      type: 'hit',
      target: hit.username,
      zone: hit.zone,
      damage: dmg,
      weapon: weaponId,
    });
    return hit;
  }

  tryFlameTick(origin, forward, delta) {
    if (!this.inMatch || this.spectating || !this.combat.alive) return;
    this._flameAcc += delta;
    if (this._flameAcc < 0.1) return;
    this._flameAcc = 0;
    const hits = [];
    this.ghosts.forEach((username, g) => {
      if (!g.mesh.visible) return;
      if (inFlameCone(origin, forward, g.pos)) {
        const dmg = damageFor('flamethrower', 'body');
        hits.push({ user: username, damage: dmg });
        this.send({ type: 'hit', target: username, zone: 'body', damage: dmg, weapon: 'flamethrower' });
      }
    });
    this.send({
      type: 'flame',
      origin: [origin.x, origin.y, origin.z],
      dir: [forward.x, forward.y, forward.z],
      hitUsers: hits,
    });
  }

  notifyGrenadeThrow(origin, vel, fuse, kind = 'he') {
    if (!this.inMatch || this.spectating) return;
    this.send({
      type: 'grenade_throw',
      origin: [origin.x, origin.y, origin.z],
      vel: [vel.x, vel.y, vel.z],
      fuse,
      kind,
    });
  }

  resolveGrenadeExplosion(pos) {
    if (!this.inMatch || this.spectating || !this.combat.alive) return;
    const radius = DAMAGE.grenade.radius;
    this.send({
      type: 'grenade_explode',
      pos: [pos.x, pos.y, pos.z],
      radius,
    });
    // Damage ghosts
    this.ghosts.forEach((username, g) => {
      const d = g.pos.distanceTo(pos);
      const dmg = grenadeDamageAt(d);
      if (dmg > 0) {
        this.send({ type: 'hit', target: username, zone: 'body', damage: dmg, weapon: 'grenade' });
      }
    });
    // Self damage
    if (this._lastPos) {
      const dx = this._lastPos[0] - pos.x;
      const dy = this._lastPos[1] - pos.y;
      const dz = this._lastPos[2] - pos.z;
      const d = Math.hypot(dx, dy, dz);
      const selfDmg = grenadeDamageAt(d);
      if (selfDmg > 0) this.combat.applyDamage(selfDmg, this.username);
    }
  }

  tryMelee(origin, forward) {
    if (!this.inMatch || this.spectating || !this.combat.alive) return;
    let best = null;
    this.ghosts.forEach((username, g) => {
      if (!g.mesh.visible) return;
      const hit = meleeHit(origin, forward, g.pos);
      if (!hit) return;
      if (!best || hit.dist < best.dist) best = { username, zone: hit.zone, dist: hit.dist };
    });
    if (!best) {
      this.send({
        type: 'melee',
        origin: [origin.x, origin.y, origin.z],
        dir: [forward.x, forward.y, forward.z],
      });
      return;
    }
    const dmg = damageFor('melee', best.zone);
    this.send({
      type: 'melee',
      origin: [origin.x, origin.y, origin.z],
      dir: [forward.x, forward.y, forward.z],
      hitUser: best.username,
      zone: best.zone,
      damage: dmg,
    });
    this.send({ type: 'hit', target: best.username, zone: best.zone, damage: dmg, weapon: 'melee' });
  }

  _checkTeamWipe() {
    if (this.spectating || this.mode === 'sandbox') return;
    // Soft check: announce if we think our side is wiped — peers also track
    // Full authority is weak; send match_end when local sees all enemies dead via state
    let enemyAlive = false;
    let allyAlive = this.combat.alive;
    this.ghosts.forEach((_u, g) => {
      const enemy = isEnemy(this.side, g.side, this.mode);
      if (g.hp > 0 && g.mesh.visible) {
        if (enemy) enemyAlive = true;
        else allyAlive = true;
      }
    });
    if (!enemyAlive && this.mode === '1v1') {
      this.send({ type: 'match_end', winner: this.side, winnerUser: this.username });
      this.onMatchEnd({ winner: this.side, winnerUser: this.username });
    }
    if (this.mode === '4v4' && !enemyAlive) {
      this.send({ type: 'match_end', winner: this.side });
      this.onMatchEnd({ winner: this.side });
    }
  }
}

function seatSide(seat) {
  if (!seat) return 'ffa';
  const s = String(seat);
  if (s.startsWith('X-')) return 'X';
  if (s.startsWith('Y-')) return 'Y';
  // legacy seats (old Space / cached clients)
  if (s === 'A' || s === 'B') return s;
  if (s.startsWith('teamA')) return 'teamA';
  if (s.startsWith('teamB')) return 'teamB';
  return 'ffa';
}

function isEnemy(mySide, theirSide, mode) {
  if (mode === 'sandbox') return true;
  if (mode === '1v1') return theirSide !== mySide;
  return theirSide !== mySide;
}

/** Deterministic spawn slot from seat. */
export function spawnIndexFor(seat, mode, players) {
  if (mode === '1v1') {
    return seat === 'Y-1' || seat === 'B' ? 1 : 0;
  }
  if (mode === '4v4') {
    const m = String(seat).match(/^(?:team)?([ABXY])-(\d)$/i);
    if (!m) return 0;
    const letter = m[1].toUpperCase();
    const side = letter === 'Y' || letter === 'B' ? 4 : 0;
    const n = Number(m[2]);
    // X-1..X-4 / Y-1..Y-4 (1-based); legacy teamA-0..3 (0-based)
    const slot = n >= 1 && /[XY]/i.test(letter) ? n - 1 : n;
    return side + Math.max(0, Math.min(3, slot));
  }
  // sandbox: index among players
  const names = (players || []).map((p) => p.username).sort();
  const idx = Math.max(0, names.indexOf(players?.find((p) => p.seat === seat)?.username));
  return idx % 8;
}

/** Map-relative spawn offsets (applied in main after base spawn). */
export const SPAWN_OFFSETS = [
  { x: 0, z: 0 },
  { x: 12, z: 12 },
  { x: -12, z: 12 },
  { x: 12, z: -12 },
  { x: -12, z: -12 },
  { x: 18, z: 0 },
  { x: -18, z: 0 },
  { x: 0, z: 18 },
];
