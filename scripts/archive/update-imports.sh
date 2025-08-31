#!/bin/bash

echo "🔄 更新import路径..."

cd "$(dirname "$(dirname "$(realpath "$0")")")/src/image-sender"

# 更新orchestrators中的导入
echo "🎯 更新编排器导入..."
sed -i '' 's|from '\''./image-processor.js'\''|from '\''../processors/image/base-processor.js'\''|g' orchestrators/image-sender.ts
sed -i '' 's|from '\''./device-client.js'\''|from '\''../services/api/device-client.js'\''|g' orchestrators/image-sender.ts
sed -i '' 's|from '\''./types.js'\''|from '\''../core/types/index.js'\''|g' orchestrators/image-sender.ts

# 更新services中的导入
echo "📡 更新API服务导入..."
sed -i '' 's|from '\''./types.js'\''|from '\''../../core/types/index.js'\''|g' services/api/device-client.ts

# 更新processors中的导入
echo "🖼️  更新处理器导入..."
sed -i '' 's|from '\''./types.js'\''|from '\''../../core/types/index.js'\''|g' processors/image/base-processor.ts
sed -i '' 's|from '\''./types.js'\''|from '\''../../core/types/index.js'\''|g' processors/optimization/monochrome-optimizer.ts
sed -i '' 's|from '\''./types.js'\''|from '\''../../core/types/index.js'\''|g' processors/optimization/dithering-optimizer.ts
sed -i '' 's|from '\''./types.js'\''|from '\''../../core/types/index.js'\''|g' processors/media/gif-processor.ts

# 更新adapters中的导入
echo "🔧 更新适配器导入..."
# env-loader可能没有类型导入，如果有的话更新

# 更新CLI导入
echo "💻 更新CLI导入..."
sed -i '' 's|from '\''./index.js'\''|from '\''../../index.js'\''|g' interfaces/cli/cli-main.ts

echo "✅ 导入路径更新完成！"