# Pieno Motorsport Experiments

A collection of tools for sim racing data analysis and AI-assisted race engineering, built for Le Mans Ultimate (LMU).

## Repository Structure

- `race-engineer/` — AI race engineer powered by the **Gemini CLI**, with Discord and CLI interfaces.
  - `index.js` — Single entry point (runs Discord bot + interactive CLI together).
  - `core/engine.js` — Shared AI engine (Gemini CLI wrapper, prompt builder).
- `tools/` — Python CLI scripts and Windows utilities.
  - `motec.py` — MoTeC .ld telemetry reader (metadata, channels, data with downsampling).
  - `lmu_setup.py` — LMU .svm setup file parser and writer.
  - `LMU-Setup-Loader.bat` — Windows one-click installer for .svm setup files.
  - `LMU-Telemetry-Installer.bat` — Windows installer for DAMPlugin + MoTeC i2 Pro.
- `telemetry-samples/` — Sample .ld and .ldx MoTeC telemetry files.
- `setup-samples/` — Sample .svm setup files for LMU.

## Setup

### Python Tools

```bash
pip install -r tools/requirements.txt
```

Usage:
```bash
python tools/motec.py metadata <file.ld>
python tools/motec.py channels <file.ld>
python tools/motec.py data <file.ld> <channel_name> [--max-samples 1000]

python tools/lmu_setup.py read <file.svm>
python tools/lmu_setup.py write <file.svm> '<json_data>'
```

### Race Engineer

**Prerequisites:**
- Node.js 18+
- The [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and available in your `PATH`
- A `GOOGLE_API_KEY` environment variable (or Gemini CLI configured with credentials)

**Installation:**
1. `cd race-engineer`
2. `npm install`
3. Copy `.env.example` to `.env` and add your `DISCORD_TOKEN` and `GOOGLE_API_KEY`.

**Start (Discord bot + interactive CLI):**
```bash
npm start

# With telemetry/setup files preloaded for the CLI:
node index.js ../telemetry-samples/*.ld
```

## Security

This repository uses environment variables for sensitive credentials.
- **NEVER** commit your `.env` files to GitHub.
- A `.gitignore` file is provided to help prevent accidental commits of secrets.
- If you find hardcoded tokens, rotate them immediately!
