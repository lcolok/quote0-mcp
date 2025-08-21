# MindReset 图片 API 官方文档

**文档来源**: [https://dot.mindreset.tech/docs/server/template/api/image_api](https://dot.mindreset.tech/docs/server/template/api/image_api)  
**转录时间**: 2025-08-21  
**用途**: 项目开发参考和API更新对照

---

## API 概览

### 基本信息
- **端点**: `https://dot.mindreset.tech/api/open/image`
- **方法**: POST
- **用途**: 向 MindReset 设备发送图片内容

### 认证方式
- **Header**: `Authorization: Bearer {{API_KEY}}`
- **API Key**: 通过设备密钥获取

## 请求参数

### 必需参数
| 参数 | 类型 | 说明 |
|------|------|------|
| `deviceId` | String | 设备序列号 |
| `image` | String | Base64 编码的 PNG 图片数据 |

### 可选参数
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `refreshNow` | Boolean | false | 是否立即显示内容 |
| `link` | String | - | 点击跳转的 URL 链接 |
| `border` | Number | - | 屏幕边缘颜色编号 |
| `ditherType` | String | - | 图片抖动类型 |
| `ditherKernel` | String | - | 抖动算法 |

## 抖动处理
- **默认算法**: Floyd-Steinberg
- **可配置**: 支持禁用或更改抖动类型/算法
- **目的**: 优化在电子墨水屏上的显示效果

## 请求限制
- **频率限制**: 每秒 1 次请求
- **优势**: 无需像应用设置那样有 5 分钟最小间隔限制

## 响应格式

### 成功响应示例
```json
{
    "code": 200,
    "message": "Device image API content switched",
    "result": {
        "message": "Device ABCD1234ABCD image API content switched"
    }
}
```

### 错误响应
- **400 Bad Request**: 参数错误（如边框参数不正确）
- **401 Unauthorized**: 认证失败
- **429 Too Many Requests**: 超过频率限制

## 官方代码示例

### cURL
```bash
curl -X POST https://dot.mindreset.tech/api/open/image \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "YOUR_DEVICE_ID",
    "image": "BASE64_IMAGE_DATA"
  }'
```

### Python
```python
import requests
import base64

# 读取图片并转换为 Base64
with open("image.png", "rb") as image_file:
    encoded_string = base64.b64encode(image_file.read()).decode()

payload = {
    "deviceId": "YOUR_DEVICE_ID",
    "image": encoded_string
}

headers = {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
}

response = requests.post(
    "https://dot.mindreset.tech/api/open/image",
    json=payload,
    headers=headers
)

print(response.json())
```

### JavaScript/TypeScript
```typescript
const fs = require('fs');

// 读取图片文件
const imageBuffer = fs.readFileSync('image.png');
const base64Image = imageBuffer.toString('base64');

const payload = {
    deviceId: 'YOUR_DEVICE_ID',
    image: base64Image
};

const response = await fetch('https://dot.mindreset.tech/api/open/image', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
});

const result = await response.json();
console.log(result);
```

### Go
```go
package main

import (
    "bytes"
    "encoding/base64"
    "encoding/json"
    "fmt"
    "io/ioutil"
    "net/http"
)

type ImagePayload struct {
    DeviceID string `json:"deviceId"`
    Image    string `json:"image"`
}

func main() {
    // 读取图片文件
    imageData, err := ioutil.ReadFile("image.png")
    if err != nil {
        panic(err)
    }

    // 转换为 Base64
    base64Image := base64.StdEncoding.EncodeToString(imageData)

    payload := ImagePayload{
        DeviceID: "YOUR_DEVICE_ID",
        Image:    base64Image,
    }

    jsonData, _ := json.Marshal(payload)

    req, _ := http.NewRequest("POST", 
        "https://dot.mindreset.tech/api/open/image", 
        bytes.NewBuffer(jsonData))
    
    req.Header.Set("Authorization", "Bearer YOUR_API_KEY")
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        panic(err)
    }
    defer resp.Body.Close()

    body, _ := ioutil.ReadAll(resp.Body)
    fmt.Println(string(body))
}
```

### Rust
```rust
use reqwest;
use serde_json::json;
use std::fs;
use base64;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 读取图片文件
    let image_data = fs::read("image.png")?;
    let base64_image = base64::encode(&image_data);

    let payload = json!({
        "deviceId": "YOUR_DEVICE_ID",
        "image": base64_image
    });

    let client = reqwest::Client::new();
    let response = client
        .post("https://dot.mindreset.tech/api/open/image")
        .header("Authorization", "Bearer YOUR_API_KEY")
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await?;

    let result: serde_json::Value = response.json().await?;
    println!("{:#}", result);

    Ok(())
}
```

## 重要注意事项

1. **图片格式**: 必须是 PNG 格式并转换为 Base64
2. **设备ID**: 使用正确的设备序列号
3. **API密钥**: 确保使用有效的认证令牌
4. **频率限制**: 每秒最多 1 次请求
5. **边框参数**: 如果使用，必须是数字类型而非字符串

## 我们项目中的实现对照

| 官方参数 | 我们的实现 | 位置 |
|----------|------------|------|
| `deviceId` | `MINDRESET_DEVICE_ID` | `.env` |
| `image` | Base64 转换 | `ImageProcessor` |
| `border` | 修复为数字类型 | `MindResetDeviceClient` |
| `link` | 支持可选链接 | CLI 参数 |
| `ditherType` | 未使用（我们自行处理） | - |
| `ditherKernel` | 未使用（我们自行处理） | - |

## 更新历史
- **2025-08-21**: 初次转录官方文档
- **待更新**: 当官方API有变化时需要重新检查此文档

---

*此文档基于官方 API 文档转录，用于项目开发参考。如有 API 变更，请及时更新此文档。*