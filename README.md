# MindReset MCP Server

A Model Context Protocol (MCP) server that provides tools for interacting with MindReset devices. This server implements the official MindReset API endpoints for displaying text and images on MindReset device screens.

## Features

- **Simple Text API**: Display basic text content on MindReset devices
- **Complex Text API**: Display text with signatures and formatting
- **Text with Icons**: Display text content with custom icons and tap-to-jump links
- **Image API**: Display PNG images with customizable borders

## Prerequisites

- Node.js >= 18
- A MindReset device with API access
- Device ID and Secret from MindReset App

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

## Configuration

Set the required environment variables:

```bash
export MINDRESET_DEVICE_ID="your_device_serial_number"
export MINDRESET_DEVICE_SECRET="your_device_secret"
```

You can obtain these credentials from the MindReset App by following the official MindReset API documentation.

## Usage

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

## Available Tools

### mindreset_simple_text

Send simple text content to a MindReset device screen.

**Parameters:**
- `deviceId` (required): Device serial number
- `title` (optional): Text title
- `message` (required): Text content to display

**Example:**
```json
{
  "deviceId": "ABCD1234ABCD",
  "title": "Hello World",
  "message": "I can swallow glass without harming myself"
}
```

### mindreset_complex_text

Send complex text content with signature to a MindReset device screen.

**Parameters:**
- `deviceId` (required): Device serial number
- `title` (optional): Text title
- `message` (required): Text content to display
- `signature` (optional): Text signature/footer

**Example:**
```json
{
  "deviceId": "ABCD1234ABCD",
  "title": "Verification Code Helper",
  "message": "A verification code from 'Shao Pai'\n205112",
  "signature": "August 4, 2025 19:58"
}
```

### mindreset_text_with_icon

Send text content with icon and optional link to a MindReset device screen.

**Parameters:**
- `deviceId` (required): Device serial number
- `title` (optional): Text title
- `message` (required): Text content to display
- `signature` (optional): Text signature/footer
- `icon` (optional): Base64 encoded PNG icon data (40px*40px)
- `link` (optional): HTTP/HTTPS link or Scheme URL for tap-to-jump

**Example:**
```json
{
  "deviceId": "ABCD1234ABCD",
  "title": "Daily Health",
  "message": "Calories burned: 702 kcal\nSteps today: 4183\nStanding time: 62 minutes",
  "signature": "August 4, 2025 20:16",
  "icon": "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAA...",
  "link": "x-apple-health://"
}
```

### mindreset_image

Display PNG image on a MindReset device screen.

**Parameters:**
- `deviceId` (required): Device serial number
- `image` (required): Base64 encoded PNG image data (296px*152px)
- `border` (optional): "0" for white border, "1" for black border
- `link` (optional): HTTP/HTTPS link or Scheme URL for tap-to-jump

**Example:**
```json
{
  "deviceId": "ABCD1234ABCD",
  "image": "iVBORw0KGgoAAAANSUhEUgAAASgAAACYCAYAAABXunTYAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAA...",
  "border": "0",
  "link": "https://dot.mindreset.tech"
}
```

## Integration with Claude Desktop

To use this MCP server with Claude Desktop, add the following configuration to your Claude Desktop settings:

```json
{
  "mcpServers": {
    "mindreset": {
      "command": "node",
      "args": ["/path/to/your/project/dist/index.js"],
      "env": {
        "MINDRESET_DEVICE_ID": "your_device_id",
        "MINDRESET_DEVICE_SECRET": "your_device_secret"
      }
    }
  }
}
```

## Error Handling

The server provides comprehensive error handling for:
- Missing or invalid authentication credentials
- Network connectivity issues
- API response errors
- Input validation errors

## API Documentation

For detailed information about the MindReset API, refer to the official documentation:
- [Text API Documentation](https://dot.mindreset.tech/docs/server/template/api/text_api)
- [Image API Documentation](https://dot.mindreset.tech/docs/server/template/api/image_api)

## License

ISC