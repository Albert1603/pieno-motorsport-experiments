# Pieno Motorsport Experiments

A collection of experiments, tools, and MCP servers for sim racing and motorsport data analysis.

## Repository Structure

- `discord-bot/`: A Node.js based Discord bot that interacts with the **Gemini CLI** to act as a Virtual Race Engineer.
- `mcp-servers/`
  - `motec/`: Model Context Protocol (MCP) server for MoTeC telemetry analysis.
  - `lmu-setup/`: MCP server for Le Mans Ultimate (LMU) setup file parsing and manipulation.
- `setup-samples/`: Sample `.svm` setup files for LMU.
- `telemetry-samples/`: Sample `.ld` and `.ldx` MoTeC telemetry files.
- `tools/`: Windows batch scripts and utility files for installation and launching.

## Installation and Setup

### Discord Bot
1. `cd discord-bot`
2. `npm install`
3. Copy `.env.example` to `.env` and add your `DISCORD_TOKEN`.
4. Start with `node index.js` or `npm start`.

### Prerequisites
The bot requires the **Gemini CLI** to be installed in your environment. It uses the CLI's tool-execution capabilities to analyze telemetry and setup files.

### MCP Servers
To use the MCP servers with your favorite LLM interface (like Gemini CLI or Claude Desktop):
1. Navigate to the server directory (e.g., `mcp-servers/motec`).
2. Run `npm install`.
3. Configure your client to point to the server's `index.js`.

## Security

This repository uses environment variables for sensitive credentials.
- **NEVER** commit your `.env` files to GitHub.
- A `.gitignore` file is provided to help prevent accidental commits of secrets.
- If you find hardcoded tokens, rotate them immediately!
