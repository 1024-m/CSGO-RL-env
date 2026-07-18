# Start

**Any OS** (recommended):

```bash
python3 start.py
```

(On Windows you can also use `py -3 start.py` or `python start.py`.)

Or:

| OS | Command |
|----|---------|
| macOS / Linux | `bash start.sh` |
| Windows | double-click `start.bat` or run `start.bat` |

Needs Python 3 installed and on PATH. macOS often has `python3` only (no `python`).

```bash
# copy .env.example → .env.local, then set your token
# (.env.local is gitignored — clones do NOT get your secrets)
HF_TOKEN=hf_xxxxxxxx
HF_SPACE_URL=https://1024m-rl-pvp.hf.space
PORT=8080
```

**Online 1v1:** both players need `HF_SPACE_URL` pointing at the same Space. Token alone = each laptop runs its own local lobby; you will not see each other.
