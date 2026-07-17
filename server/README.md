---
title: RL-PVP
emoji: 🎯
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Dust2 · RL-PVP

Public **match server** + lobby board + **spectate** (no HF login).

- **Board / status:** [`/board`](./board)
- **Spectate:** Spectate button on a live lobby (no account)
- **Play:** local Dust2 only (`bash start.sh` + `HF_TOKEN`) — Space rejects anonymous seat claims

APIs: `/api/health`, `/api/lobbies`, `/api/config`  
Match WS: `/ws/match/{mode}/{lobby_id}?user=...&role=play|spectate`
