# Pieno Motorsport Experiments

Sim racing tools and AI race engineer for Le Mans Ultimate (LMU).

## Project Structure

- `discord-bot/` — Node.js Discord bot that uses the Gemini CLI as a virtual race engineer
- `tools/` — Python CLI scripts for telemetry and setup file parsing
  - `motec.py` — MoTeC .ld telemetry reader (metadata, channels, data with downsampling)
  - `lmu_setup.py` — LMU .svm setup file parser (read/write)
  - `ldparser.py` — Vendored MoTeC binary parser (from github.com/gotzl/ldparser)
  - `requirements.txt` — Python dependencies (numpy)
  - `LMU-Setup-Loader.bat` — Windows script to install .svm setups into LMU
  - `LMU-Telemetry-Installer.bat` — Windows script to install DAMPlugin + MoTeC i2
- `telemetry-samples/` — Sample .ld/.ldx MoTeC telemetry files
- `setup-samples/` — Sample .svm setup files (gitignored, may be empty)

## Key Commands

```bash
# Telemetry
python tools/motec.py metadata <file.ld>
python tools/motec.py channels <file.ld>
python tools/motec.py data <file.ld> <channel> [--max-samples N]

# Setup files
python tools/lmu_setup.py read <file.svm>
python tools/lmu_setup.py write <file.svm> '<json>'

# Discord bot
cd discord-bot && npm start
```

## Conventions

- The Discord bot calls `gemini -y --output-format json` via stdin (no shell)
- Python tools output JSON to stdout, errors to stderr
- .svm files use INI-style format with `[SECTION]`, `key=value//comment`
- Telemetry data can be large — always use `--max-samples` to downsample
