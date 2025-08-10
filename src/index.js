#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
// Schema definitions for MindReset API requests
const SimpleTextSchema = zod_1.z.object({
    deviceId: zod_1.z.string().describe("Device serial number"),
    title: zod_1.z.string().optional().describe("Text title"),
    message: zod_1.z.string().describe("Text content"),
});
const ComplexTextSchema = zod_1.z.object({
    deviceId: zod_1.z.string().describe("Device serial number"),
    title: zod_1.z.string().optional().describe("Text title"),
    message: zod_1.z.string().describe("Text content"),
    signature: zod_1.z.string().optional().describe("Text signature"),
});
const TextWithIconSchema = zod_1.z.object({
    deviceId: zod_1.z.string().describe("Device serial number"),
    title: zod_1.z.string().optional().describe("Text title"),
    message: zod_1.z.string().describe("Text content"),
    signature: zod_1.z.string().optional().describe("Text signature"),
    icon: zod_1.z.string().optional().describe("Base64 encoded PNG icon data (40px*40px)"),
    link: zod_1.z.string().optional().describe("HTTP/HTTPS link or Scheme URL for tap-to-jump"),
});
const ImageSchema = zod_1.z.object({
    deviceId: zod_1.z.string().describe("Device serial number"),
    image: zod_1.z.string().describe("Base64 encoded PNG image data (296px*152px)"),
    border: zod_1.z.enum(["0", "1"]).optional().describe("0 for white border, 1 for black border"),
    link: zod_1.z.string().optional().describe("HTTP/HTTPS link or Scheme URL for tap-to-jump"),
});
// Response schema
const ApiResponseSchema = zod_1.z.object({
    code: zod_1.z.number(),
    message: zod_1.z.string(),
    result: zod_1.z.any().optional(),
});
class MindResetMcpServer {
    server;
    baseUrl = "https://dot.mindreset.tech/api";
    constructor() {
        this.server = new index_js_1.Server({
            name: "mindreset-mcp-server",
            version: "1.0.0",
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        this.setupErrorHandling();
    }
    setupErrorHandling() {
        this.server.onerror = (error) => console.error("[MCP Error]", error);
        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    getAuthHeaders() {
        const deviceId = process.env.MINDRESET_DEVICE_ID;
        const deviceSecret = process.env.MINDRESET_DEVICE_SECRET;
        if (!deviceId || !deviceSecret) {
            throw new Error("Missing authentication. Please set MINDRESET_DEVICE_ID and MINDRESET_DEVICE_SECRET environment variables.");
        }
        return {
            "Authorization": `Bearer ${deviceSecret}`,
            "Content-Type": "application/json",
            "User-Agent": "mindreset-mcp-server/1.0.0",
            "X-Device-ID": deviceId,
            "X-Device-Secret": deviceSecret,
        };
    }
    async makeApiRequest(endpoint, data) {
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
            const result = await response.json();
            const validatedResult = ApiResponseSchema.parse(result);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(validatedResult, null, 2),
                    },
                ],
            };
        }
        catch (error) {
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
    setupToolHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
            const tools = [
                {
                    name: "mindreset_simple_text",
                    description: "Send simple text content to MindReset device screen",
                    inputSchema: types_js_1.ToolSchema.shape.inputSchema.parse(SimpleTextSchema),
                },
                {
                    name: "mindreset_complex_text",
                    description: "Send complex text content with signature to MindReset device screen",
                    inputSchema: types_js_1.ToolSchema.shape.inputSchema.parse(ComplexTextSchema),
                },
                {
                    name: "mindreset_text_with_icon",
                    description: "Send text content with icon and optional link to MindReset device screen",
                    inputSchema: types_js_1.ToolSchema.shape.inputSchema.parse(TextWithIconSchema),
                },
                {
                    name: "mindreset_image",
                    description: "Display PNG image on MindReset device screen",
                    inputSchema: types_js_1.ToolSchema.shape.inputSchema.parse(ImageSchema),
                },
            ];
            return { tools };
        });
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
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
            }
            catch (error) {
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
    async run() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error("MindReset MCP server started on stdio");
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
//# sourceMappingURL=index.js.map