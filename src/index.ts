#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fetch } from "undici";
import { EINK_DEVICE_WIDTH, EINK_DEVICE_HEIGHT } from "./react-widgets/core/device-constants.js";
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
  Tool,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Schema definitions for MindReset API requests
const SimpleTextSchema = z.object({
  deviceId: z.string().describe("Device serial number"),
  title: z.string().optional().describe("Text title"),
  message: z.string().describe("Text content"),
});

const ComplexTextSchema = z.object({
  deviceId: z.string().describe("Device serial number"),
  title: z.string().optional().describe("Text title"),
  message: z.string().describe("Text content"),
  signature: z.string().optional().describe("Text signature"),
});

const TextWithIconSchema = z.object({
  deviceId: z.string().describe("Device serial number"),
  title: z.string().optional().describe("Text title"),
  message: z.string().describe("Text content"),
  signature: z.string().optional().describe("Text signature"),
  icon: z.string().optional().describe("Base64 encoded PNG icon data (40px*40px)"),
  link: z.string().optional().describe("HTTP/HTTPS link or Scheme URL for tap-to-jump"),
});

const ImageSchema = z.object({
  deviceId: z.string().describe("Device serial number"),
  image: z.string().describe(`Base64 encoded PNG image data (${EINK_DEVICE_WIDTH}px*${EINK_DEVICE_HEIGHT}px)`),
  border: z.enum(["0", "1"]).optional().describe("0 for white border, 1 for black border"),
  link: z.string().optional().describe("HTTP/HTTPS link or Scheme URL for tap-to-jump"),
});

// Note: Do not strictly validate API responses; return raw payload to client.

class MindResetMcpServer {
  private server: Server;
  private baseUrl: string = "https://dot.mindreset.tech/api";

  constructor() {
    this.server = new Server(
      {
        name: "mindreset-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private getAuthHeaders(): Record<string, string> {
    const deviceId = process.env.MINDRESET_DEVICE_ID;
    const deviceSecret = process.env.MINDRESET_DEVICE_SECRET;

    if (!deviceId || !deviceSecret) {
      throw new Error(
        "Missing authentication. Please set MINDRESET_DEVICE_ID and MINDRESET_DEVICE_SECRET environment variables."
      );
    }

    return {
      "Authorization": `Bearer ${deviceSecret}`,
      "Content-Type": "application/json",
      "User-Agent": "mindreset-mcp-server/1.0.0",
      "X-Device-ID": deviceId,
      "X-Device-Secret": deviceSecret,
    };
  }

  private async makeApiRequest(endpoint: string, data: any): Promise<CallToolResult> {
    try {
      const headers = this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [
            {
              type: "text",
              text: `API request failed: ${response.status} ${response.statusText} - ${errorText}`,
            },
          ],
          isError: true,
        };
      }

      // Try to return JSON if available; fall back to text/empty
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await response.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(json, null, 2),
            },
          ],
        };
      } else {
        const text = await response.text();
        return {
          content: [
            {
              type: "text",
              text: text || "",
            },
          ],
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // JSON Schemas for tool inputs (as required by MCP ToolSchema)
      const SimpleTextJson = ToolSchema.shape.inputSchema.parse({
        type: "object",
        properties: {
          deviceId: { type: "string", description: "Device serial number" },
          title: { type: "string", description: "Text title" },
          message: { type: "string", description: "Text content" },
        },
        required: ["deviceId", "message"],
        additionalProperties: false,
      });

      const ComplexTextJson = ToolSchema.shape.inputSchema.parse({
        type: "object",
        properties: {
          deviceId: { type: "string", description: "Device serial number" },
          title: { type: "string", description: "Text title" },
          message: { type: "string", description: "Text content" },
          signature: { type: "string", description: "Text signature" },
        },
        required: ["deviceId", "message"],
        additionalProperties: false,
      });

      const TextWithIconJson = ToolSchema.shape.inputSchema.parse({
        type: "object",
        properties: {
          deviceId: { type: "string", description: "Device serial number" },
          title: { type: "string", description: "Text title" },
          message: { type: "string", description: "Text content" },
          signature: { type: "string", description: "Text signature" },
          icon: { type: "string", description: "Base64 encoded PNG icon data (40px*40px)" },
          link: { type: "string", description: "HTTP/HTTPS link or Scheme URL for tap-to-jump" },
        },
        required: ["deviceId", "message"],
        additionalProperties: false,
      });

      const ImageJson = ToolSchema.shape.inputSchema.parse({
        type: "object",
        properties: {
          deviceId: { type: "string", description: "Device serial number" },
          image: { type: "string", description: `Base64 encoded PNG image data (${EINK_DEVICE_WIDTH}px*${EINK_DEVICE_HEIGHT}px)` },
          border: { type: "string", enum: ["0", "1"], description: "0 for white border, 1 for black border" },
          link: { type: "string", description: "HTTP/HTTPS link or Scheme URL for tap-to-jump" },
        },
        required: ["deviceId", "image"],
        additionalProperties: false,
      });

      const tools: Tool[] = [
        {
          name: "mindreset_simple_text",
          description: "Send simple text content to MindReset device screen",
          inputSchema: SimpleTextJson,
        },
        {
          name: "mindreset_complex_text",
          description: "Send complex text content with signature to MindReset device screen",
          inputSchema: ComplexTextJson,
        },
        {
          name: "mindreset_text_with_icon",
          description: "Send text content with icon and optional link to MindReset device screen",
          inputSchema: TextWithIconJson,
        },
        {
          name: "mindreset_image",
          description: "Display PNG image on a MindReset device screen",
          inputSchema: ImageJson,
        },
      ];

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "mindreset_simple_text": {
            const data = SimpleTextSchema.parse(args);
            return await this.makeApiRequest("/open/text", data);
          }

          case "mindreset_complex_text": {
            const data = ComplexTextSchema.parse(args);
            return await this.makeApiRequest("/open/text", data);
          }

          case "mindreset_text_with_icon": {
            const data = TextWithIconSchema.parse(args);
            return await this.makeApiRequest("/open/text", data);
          }

          case "mindreset_image": {
            const data = ImageSchema.parse(args);
            return await this.makeApiRequest("/open/image", data);
          }

          default:
            return {
              content: [
                {
                  type: "text",
                  text: `Unknown tool: ${name}`,
                },
              ],
              isError: true,
            };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    if (process.env.DEBUG) {
      console.error("MindReset MCP server started on stdio");
    }
  }
}

// Main execution
async function main() {
  const server = new MindResetMcpServer();
  await server.run();
}

main().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});