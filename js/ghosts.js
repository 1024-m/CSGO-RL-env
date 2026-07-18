import * as THREE from 'three';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from './combat.js';

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function makeCapsuleMesh(color = 0x3aa0ff) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - PLAYER_RADIUS * 2, 4, 8),
    new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      metalness: 0.1,
      roughness: 0.7,
    }),
  );
  body.position.y = PLAYER_HEIGHT * 0.5;
  body.castShadow = true;
  g.add(body);
  g.userData.body = body;
  return g;
}

export class GhostManager {
  constructor(scene) {
    this.scene = scene;
    this.ghosts = new Map();
    this._prototype = null;
    this._armsFactory = null;
    this._tmp = new THREE.Vector3();
  }

  setPrototype(model) {
    if (!model) return;
    this._prototype = model.clone(true);
    for (const g of this.ghosts.values()) this._upgradeMesh(g);
  }

  /** () => { root, slots, setWeapon, dispose } | null */
  setArmsFactory(factory) {
    this._armsFactory = factory;
    for (const g of this.ghosts.values()) this._attachArms(g);
  }

  refreshArms() {
    if (!this._armsFactory) return;
    for (const g of this.ghosts.values()) this._attachArms(g);
  }

  _makeMesh(side) {
    if (this._prototype) {
      const mesh = new THREE.Group();
      const body = this._prototype.clone(true);
      mesh.add(body);
      mesh.userData.body = body;
      mesh.userData.isCharacter = true;
      return mesh;
    }
    const color = side === 'Y' || side === 'teamB' || side === 'B' ? 0xe85d4c : 0x3aa0ff;
    return makeCapsuleMesh(color);
  }

  _attachArms(g) {
    if (!g || !this._armsFactory) return;
    if (g.arms) {
      g.arms.dispose?.();
      g.arms = null;
    }
    const arms = this._armsFactory();
    if (!arms) return;
    g.mesh.add(arms.root);
    g.arms = arms;
    arms.setWeapon(g.weapon || 'machinegun');
  }

  _upgradeMesh(g) {
    if (!this._prototype || !g?.mesh) return;
    if (g.mesh.userData?.isCharacter) return;
    const next = this._makeMesh(g.side);
    next.userData.isCharacter = true;
    next.position.copy(g.mesh.position);
    next.rotation.y = g.yaw || 0;
    next.visible = g.alive !== false && !g.scope;
    this.scene.remove(g.mesh);
    this.scene.add(next);
    g.mesh = next;
    this._attachArms(g);
  }

  syncPlayers(players, selfName) {
    const keep = new Set();
    for (const p of players || []) {
      if (!p.username || p.username === selfName) continue;
      keep.add(p.username);
      if (!this.ghosts.has(p.username)) {
        const mesh = this._makeMesh(p.side);
        if (this._prototype) mesh.userData.isCharacter = true;
        this.scene.add(mesh);
        const g = {
          mesh,
          target: new THREE.Vector3(),
          pos: new THREE.Vector3(),
          yaw: 0, // body yaw (character facing)
          pitch: 0,
          camYaw: 0,
          targetYaw: 0, // body
          targetCamYaw: 0,
          targetPitch: 0,
          hp: 100,
          alive: true,
          weapon: 'machinegun',
          ammo: '',
          scope: false,
          flame: false,
          firing: false,
          reloading: false,
          side: p.side || 'ffa',
          seat: p.seat || '',
          avatarUrl: p.avatarUrl || `https://huggingface.co/avatars/${encodeURIComponent(p.username)}`,
          arms: null,
          swingQueued: false,
        };
        this.ghosts.set(p.username, g);
        this._attachArms(g);
      } else {
        const g = this.ghosts.get(p.username);
        g.side = p.side || g.side;
        g.seat = p.seat || g.seat;
        if (p.avatarUrl) g.avatarUrl = p.avatarUrl;
        this._upgradeMesh(g);
      }
    }
    for (const [name, g] of this.ghosts) {
      if (!keep.has(name)) {
        g.arms?.dispose?.();
        this.scene.remove(g.mesh);
        this.ghosts.delete(name);
      }
    }
  }

  applyState(username, msg) {
    const g = this.ghosts.get(username);
    if (!g || !msg.pos) return;
    g.target.set(msg.pos[0], msg.pos[1], msg.pos[2]);
    if (msg.rot) {
      // rot: [cameraYaw, cameraPitch, characterYaw?]
      g.targetCamYaw = msg.rot[0] || 0;
      if (typeof msg.rot[1] === 'number') g.targetPitch = msg.rot[1];
      g.targetYaw = typeof msg.rot[2] === 'number' ? msg.rot[2] : g.targetCamYaw;
    }
    if (typeof msg.hp === 'number') g.hp = msg.hp;
    g.alive = msg.alive !== false;
    if (msg.weapon) {
      g.weapon = msg.weapon;
      g.arms?.setWeapon(msg.weapon);
    }
    if (typeof msg.ammo === 'string') g.ammo = msg.ammo;
    if (typeof msg.scope === 'boolean') g.scope = msg.scope;
    if (typeof msg.reloading === 'boolean') g.reloading = msg.reloading;
    if (typeof msg.firing === 'boolean') g.firing = msg.firing;
    // flame kept for back-compat; prefer firing for all weapons
    if (typeof msg.flame === 'boolean') g.flame = msg.flame;
    if (g.reloading) {
      g.firing = false;
      g.flame = false;
    } else if (typeof msg.firing === 'boolean') {
      g.flame = g.flame || (g.firing && g.weapon === 'flamethrower');
    }
    if (typeof msg.avatarUrl === 'string' && msg.avatarUrl) g.avatarUrl = msg.avatarUrl;
    // Alive+scoped hides body (same as local). Dead stays visible for spectate.
    g.mesh.visible = g.alive ? !g.scope : true;
  }

  remove(username) {
    const g = this.ghosts.get(username);
    if (!g) return;
    g.arms?.dispose?.();
    this.scene.remove(g.mesh);
    this.ghosts.delete(username);
  }

  clear() {
    for (const [, g] of this.ghosts) {
      g.arms?.dispose?.();
      this.scene.remove(g.mesh);
    }
    this.ghosts.clear();
  }

  queueSwing(username) {
    const g = this.ghosts.get(username);
    if (!g) return;
    g.swingQueued = true;
    if (g.weapon !== 'melee') g.weapon = 'melee';
    g.arms?.setWeapon('melee');
    g.arms?.startSwing?.();
  }

  update(delta) {
    const lp = 1 - Math.pow(0.001, delta);
    const tPos = Math.min(1, lp * 22);
    const tRot = Math.min(1, lp * 28);
    for (const g of this.ghosts.values()) {
      g.pos.lerp(g.target, tPos);
      g.yaw = lerpAngle(g.yaw, g.targetYaw, tRot);
      g.camYaw = lerpAngle(g.camYaw ?? g.yaw, g.targetCamYaw ?? g.targetYaw, tRot);
      g.pitch = THREE.MathUtils.lerp(g.pitch, g.targetPitch, tRot);
      g.mesh.position.copy(g.pos);
      // Body faces characterYaw (matches local character.rotation.y)
      g.mesh.rotation.y = g.yaw;
      if (g.arms) {
        g.arms.setWeapon(g.weapon || 'machinegun');
        if (g.swingQueued) {
          g.arms.startSwing?.();
          g.swingQueued = false;
        }
        g.arms.update?.(delta);
      }
      // Dead: keep corpse pose visible briefly for spectate (dim via opacity not available on gltf easily)
      if (!g.alive) g.mesh.visible = true;
      else g.mesh.visible = !g.scope;
    }
  }

  raycast(origin, dir, maxDist = 80) {
    let best = null;
    for (const [username, g] of this.ghosts) {
      if (!g.alive) continue;
      const feet = g.pos;
      const hit = capsuleRay(origin, dir, feet, maxDist);
      if (!hit) continue;
      if (!best || hit.dist < best.dist) {
        best = { username, zone: hit.zone, dist: hit.dist, feet: feet.clone() };
      }
    }
    return best;
  }

  forEach(fn) {
    for (const [username, g] of this.ghosts) fn(username, g);
  }
}

function capsuleRay(origin, dir, feet, maxDist) {
  const R = PLAYER_RADIUS;
  const H = PLAYER_HEIGHT;
  const ox = origin.x - feet.x;
  const oz = origin.z - feet.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const c = ox * ox + oz * oz - R * R;
  let t0 = 0;
  let t1 = maxDist;
  if (a < 1e-8) {
    if (c > 0) return null;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    t0 = (-b - s) / (2 * a);
    t1 = (-b + s) / (2 * a);
    if (t1 < 0 || t0 > maxDist) return null;
    t0 = Math.max(0, t0);
  }
  for (let i = 0; i < 10; i += 1) {
    const t = t0 + ((t1 - t0) * i) / 9;
    const y = origin.y + dir.y * t;
    if (y >= feet.y && y <= feet.y + H) {
      const rel = (y - feet.y) / H;
      return { dist: t, zone: rel >= 0.78 ? 'head' : 'body' };
    }
  }
  return null;
}
