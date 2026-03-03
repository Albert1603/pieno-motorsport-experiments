#!/usr/bin/env node
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} = require("@modelcontextprotocol/sdk/types.js");
const path = require('path');
const fs = require('fs');

function parseSvm(content) {
  const result = {};
  let currentSection = 'HEADER';
  result[currentSection] = {};

  const lines = content.split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('//')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.substring(1, line.length - 1);
      result[currentSection] = {};
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex !== -1) {
      const key = line.substring(0, eqIndex).trim();
      let rest = line.substring(eqIndex + 1).trim();
      
      let value = rest;
      let comment = '';
      
      const commentIndex = rest.indexOf('//');
      if (commentIndex !== -1) {
        value = rest.substring(0, commentIndex).trim();
        comment = rest.substring(commentIndex + 2).trim();
      }

      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }

      result[currentSection][key] = {
        value: isNaN(value) || value === '' ? value : parseFloat(value),
        displayValue: comment || value
      };
    }
  }
  return result;
}

function stringifySvm(obj) {
  let output = '';
  
  // Header first
  if (obj.HEADER) {
    for (const [key, data] of Object.entries(obj.HEADER)) {
      const val = typeof data.value === 'string' && key.includes('Class') ? `"${data.value}"` : data.value;
      output += `${key}=${val}\n`;
    }
  }

  for (const [section, entries] of Object.entries(obj)) {
    if (section === 'HEADER') continue;
    output += `\n[${section}]\n`;
    for (const [key, data] of Object.entries(entries)) {
      let line = `${key}=${data.value}`;
      if (data.displayValue && data.displayValue !== data.value.toString()) {
        line += `//${data.displayValue}`;
      }
      output += `${line}\n`;
    }
  }
  return output;
}

class LmuSetupServer {
  constructor() {
    this.server = new Server(
      { name: "lmu-setup-reader", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    this.setupToolHandlers();
    this.server.onerror = (error) => console.error("[MCP Error]", error);
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "read_setup",
          description: "Leggi e parsa un file di setup LMU (.svm) in formato JSON",
          inputSchema: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "Percorso assoluto del file .svm" }
            },
            required: ["filePath"]
          }
        },
        {
          name: "write_setup",
          description: "Scrive un oggetto JSON di setup in un file .svm",
          inputSchema: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "Percorso dove salvare il file" },
              setupData: { type: "object", description: "L'oggetto JSON del setup" }
            },
            required: ["filePath", "setupData"]
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "read_setup":
            const content = fs.readFileSync(args.filePath, 'utf8');
            return { content: [{ type: "text", text: JSON.stringify(parseSvm(content), null, 2) }] };

          case "write_setup":
            const svmText = stringifySvm(args.setupData);
            fs.writeFileSync(args.filePath, svmText, 'utf8');
            return { content: [{ type: "text", text: `Setup salvato con successo in ${args.filePath}` }] };

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Tool sconosciuto: ${name}`);
        }
      } catch (error) {
        return { content: [{ type: "text", text: `Errore: ${error.message}` }], isError: true };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new LmuSetupServer();
server.run();
