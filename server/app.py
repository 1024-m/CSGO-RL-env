"""HF Space entry: FastAPI lobby/WS (Docker Space — sole uvicorn on :7860)."""

from __future__ import annotations

import os

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from lobbies import board
from relay import handle_match_ws


class ClaimBody(BaseModel):
    username: str = Field(..., min_length=1)
    seat: str = Field(..., min_length=1)


class LeaveBody(BaseModel):
    username: str = Field(..., min_length=1)


class HeartbeatBody(BaseModel):
    username: str = Field(..., min_length=1)


BOARD_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>RL-PVP · Lobby board</title>
  <style>
    :root {
      --bg0: #0c0a08;
      --bg1: #161210;
      --line: #3a322a;
      --text: #ece6df;
      --muted: #9a9086;
      --accent: #d8d0c6;
      --live: #5dce8a;
      --open: #c4b5a0;
      --team-x: #c44b3c;
      --team-x-bg: #3a1814;
      --team-y: #3b7ec4;
      --team-y-bg: #142433;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", "Helvetica Neue", sans-serif;
      color: var(--text);
      background:
        radial-gradient(ellipse at 50% 0%, rgba(70, 50, 30, 0.35), transparent 55%),
        linear-gradient(180deg, #1a1510 0%, var(--bg0) 100%);
    }
    .wrap { max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
    h1 {
      margin: 0;
      font-size: clamp(1.8rem, 4vw, 2.6rem);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-weight: 800;
    }
    .lead { color: var(--muted); margin: 0.6rem 0 1.25rem; max-width: 40rem; line-height: 1.45; }
    .banner {
      border: 1px solid var(--line);
      background: rgba(12, 10, 8, 0.85);
      padding: 0.9rem 1rem;
      margin-bottom: 1.25rem;
      line-height: 1.45;
    }
    .banner strong { color: #fff; }
    .tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .tab {
      border: 2px solid #5a5048;
      background: transparent;
      color: var(--text);
      padding: 0.45rem 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .tab.active { border-color: var(--accent); background: #1a1510; }
    .list { display: flex; flex-direction: column; gap: 0.65rem; }
    .card {
      border: 1px solid var(--line);
      background: #100e0c;
      padding: 0.75rem 0.85rem;
    }
    .head { display: flex; justify-content: space-between; gap: 0.75rem; align-items: baseline; margin-bottom: 0.55rem; }
    .id { font-weight: 700; letter-spacing: 0.04em; }
    .meta { color: var(--muted); font-size: 0.85rem; }
    .meta .live { color: var(--live); }
    .meta .open { color: var(--open); }
    .seats-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.15rem;
    }
    .team {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      max-width: 46%;
    }
    .team.x { justify-content: flex-start; }
    .team.y { justify-content: flex-end; }
    .seat {
      min-width: 2rem;
      text-align: center;
      border: 1px solid #5a5048;
      background: #1a1510;
      color: #ece6df;
      font-size: 0.78rem;
      font-weight: 700;
      padding: 0.35rem 0.5rem;
    }
    .seat.team-x { border-color: var(--team-x); background: var(--team-x-bg); color: #ffd4ce; }
    .seat.team-y { border-color: var(--team-y); background: var(--team-y-bg); color: #cfe4ff; }
    .seat.filled { opacity: 0.9; }
    .seat .who { display: block; font-size: 0.62rem; font-weight: 500; opacity: 0.85; }
    .seats-flat { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .hint { margin-top: 0.55rem; font-size: 0.78rem; color: var(--muted); }
    .err { color: #ff8e8e; }
    footer { margin-top: 1.5rem; color: var(--muted); font-size: 0.8rem; }
    code { color: #d2b48c; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Dust2 · RL-PVP</h1>
    <p class="lead">Public match server. This page is the live lobby board — not the game.</p>
    <div class="banner">
      <strong>Play / spectate:</strong> run Dust2 Explorer locally
      (<code>bash start.sh</code> → <code>http://localhost:8080</code>),
      pick Sandbox / 1v1 / 4v4, claim a seat to play, or hit <strong>Spectate</strong> on a live lobby.
      <br/>Red = side X · Blue = side Y (labels are seat numbers only).
    </div>
    <div class="tabs">
      <button type="button" class="tab active" data-mode="sandbox">Sandbox</button>
      <button type="button" class="tab" data-mode="1v1">1v1</button>
      <button type="button" class="tab" data-mode="4v4">4v4</button>
    </div>
    <div id="list" class="list">Loading lobbies…</div>
    <footer>Auto-refreshes every 2s · <code>/api/lobbies</code> · <code>/api/health</code></footer>
  </div>
  <script>
    const KEY = { sandbox: 'sandbox', '1v1': 'duel', '4v4': 'squad' };
    let mode = 'sandbox';
    const list = document.getElementById('list');
    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
        render(window.__board);
      });
    });
    function parseSeat(key) {
      const m = String(key).match(/^([XYS])-(\\d+)$/i);
      if (!m) return { team: null, n: key, cls: '' };
      const t = m[1].toUpperCase();
      return {
        team: t === 'S' ? null : t,
        n: m[2],
        cls: t === 'X' ? 'team-x' : t === 'Y' ? 'team-y' : '',
      };
    }
    function seatChip(key, user) {
      const p = parseSeat(key);
      const label = p.team ? p.n : key.replace(/^S-/, '');
      const who = user ? `<span class="who">${user}</span>` : '';
      return `<span class="seat ${p.cls}${user ? ' filled' : ''}">${label}${who}</span>`;
    }
    function seatsHtml(seats) {
      const entries = Object.entries(seats || {});
      const xs = entries.filter(([k]) => /^X-/i.test(k));
      const ys = entries.filter(([k]) => /^Y-/i.test(k));
      if (xs.length || ys.length) {
        return `<div class="seats-row">
          <div class="team x">${xs.map(([k, v]) => seatChip(k, v)).join('')}</div>
          <div class="team y">${ys.map(([k, v]) => seatChip(k, v)).join('')}</div>
        </div>`;
      }
      return `<div class="seats-flat">${entries.map(([k, v]) => seatChip(k, v)).join('')}</div>`;
    }
    function render(board) {
      if (!board) return;
      const lobbies = board[KEY[mode]] || [];
      if (!lobbies.length) {
        list.innerHTML = '<div class="card err">No lobbies in this mode.</div>';
        return;
      }
      list.innerHTML = lobbies.map((L) => {
        const st = L.status === 'live' || L.status === 'starting'
          ? `<span class="live">${L.status}</span>`
          : `<span class="open">${L.status}</span>`;
        const spec = (L.status === 'live' || L.status === 'starting')
          ? '<div class="hint">Live — open the local game → this mode → Spectate on this lobby.</div>'
          : '<div class="hint">Open — claim a seat in the local game to play.</div>';
        return `<div class="card">
          <div class="head">
            <span class="id">${L.id}</span>
            <span class="meta">${L.filled}/${L.capacity} · ${st}</span>
          </div>
          ${seatsHtml(L.seats)}
          ${spec}
        </div>`;
      }).join('');
    }
    async function tick() {
      try {
        const r = await fetch('/api/lobbies');
        if (!r.ok) throw new Error(r.status);
        window.__board = await r.json();
        render(window.__board);
      } catch (e) {
        list.innerHTML = `<div class="card err">Lobby API unreachable (${e.message || e})</div>`;
      }
    }
    tick();
    setInterval(tick, 2000);
  </script>
</body>
</html>
"""


def create_app() -> FastAPI:
    api = FastAPI()
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @api.get("/", response_class=HTMLResponse)
    def home():
        return BOARD_HTML

    @api.get("/api/health")
    def health():
        return {"ok": True}

    @api.get("/api/lobbies")
    def get_lobbies():
        return board.snapshot()

    @api.post("/api/lobbies/{mode}/{lobby_id}/claim")
    def claim_seat(mode: str, lobby_id: str, body: ClaimBody):
        result = board.claim(mode, lobby_id, body.username, body.seat)
        return JSONResponse(result, status_code=200 if result.get("ok") else 400)

    @api.post("/api/lobbies/leave")
    def leave_lobby(body: LeaveBody):
        return board.leave(body.username)

    @api.post("/api/lobbies/heartbeat")
    def heartbeat(body: HeartbeatBody):
        board.heartbeat(body.username)
        return {"ok": True}

    @api.websocket("/ws/match/{mode}/{lobby_id}")
    async def match_ws(
        ws: WebSocket,
        mode: str,
        lobby_id: str,
        user: str = "",
        role: str = "play",
    ):
        await handle_match_ws(ws, mode, lobby_id, user, role=role)

    return api


app = create_app()


def main() -> None:
    port = int(os.environ.get("PORT") or "7860")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
