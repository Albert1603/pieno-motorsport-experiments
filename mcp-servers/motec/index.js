#!/usr/bin/env node
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} = require("@modelcontextprotocol/sdk/types.js");
const { LdData } = require('@rflafla/motec-ld-reader');
const path = require('path');
const fs = require('fs');

class MotecServer {
  constructor() {
    this.server = new Server(
      {
        name: "motec-reader",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "read_metadata",
          description: "Read session metadata from a MoTeC .ld file (driver, venue, vehicle, date)",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .ld file",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "list_channels",
          description: "List all available telemetry channels in a MoTeC .ld file",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .ld file",
              },
            },
            required: ["filePath"],
          },
        },
        {
          name: "get_channel_data",
          description: "Get data points for a specific channel. Optionally downsample to reduce output size.",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the .ld file",
              },
              channelName: {
                type: "string",
                description: "Name of the channel to read",
              },
              maxSamples: {
                type: "number",
                description: "Maximum number of samples to return (default 1000). Data will be downsampled if it exceeds this.",
              },
            },
            required: ["filePath", "channelName"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const absolutePath = path.isAbsolute(args.filePath) 
          ? args.filePath 
          : path.join(process.cwd(), args.filePath);

        if (!fs.existsSync(absolutePath)) {
            throw new McpError(ErrorCode.InvalidParams, `File not found: ${args.filePath}`);
        }

        const data = LdData.fromFile(absolutePath);

        switch (name) {
          case "read_metadata":
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    driver: data.head.driver,
                    vehicle: data.head.vehicleId,
                    venue: data.head.venue,
                    datetime: data.head.datetime,
                    shortComment: data.head.shortComment,
                    channelCount: data.channelCount,
                    event: data.head.event ? {
                        name: data.head.event.name,
                        session: data.head.event.session,
                        comment: data.head.event.comment
                    } : null
                  }, null, 2),
                },
              ],
            };

          case "list_channels":
            const channels = data.channels.map(c => ({
                name: c.name,
                shortName: c.shortName,
                unit: c.unit,
                frequency: c.freq,
                dataLength: c.dataLen
            }));
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(channels, null, 2),
                },
              ],
            };

          case "get_channel_data":
            const channel = data.getChannel(args.channelName);
            if (!channel) {
                throw new McpError(ErrorCode.InvalidParams, `Channel not found: ${args.channelName}`);
            }

            let values = channel.data;
            const maxSamples = args.maxSamples || 1000;

            if (values.length > maxSamples) {
                const step = Math.ceil(values.length / maxSamples);
                const downsampled = [];
                for (let i = 0; i < values.length; i += step) {
                    downsampled.push(values[i]);
                }
                values = downsampled;
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    name: channel.name,
                    unit: channel.unit,
                    frequency: channel.freq,
                    originalLength: channel.dataLen,
                    sampleCount: values.length,
                    data: values
                  }, null, 2),
                },
              ],
            };

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) throw error;
        return {
          content: [
            {
              type: "text",
              text: `Error processing MoTeC file: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Motec MCP server running on stdio");
  }
}

const server = new MotecServer();
server.run();
