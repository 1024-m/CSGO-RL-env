---
title: RL-PVP
emoji: 🎯
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

Public **match server** for Dust2 Explorer (not the game client).

Play / spectate from the local game (`bash start.sh` → `http://localhost:8080`).
This Space page is the live lobby board.

- Health: `/api/health`
- Lobbies: `/api/lobbies`
- Match WS: `/ws/match/{mode}/{lobby_id}?user=...&role=play|spectate`
