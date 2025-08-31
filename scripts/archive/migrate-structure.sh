#!/bin/bash

# 模块重构迁移脚本

echo "🚀 开始迁移 image-sender 模块结构..."

cd "$(dirname "$(dirname "$(realpath "$0")")")/src/image-sender"

# 备份原文件
echo "📁 备份原文件..."
mkdir -p __backup
cp *.ts __backup/ 2>/dev/null || true

# 迁移环境加载器
echo "🔧 迁移环境适配器..."
mv env-loader.ts adapters/environments/env-loader.ts

# 迁移设备客户端
echo "📡 迁移API服务..."
mv device-client.ts services/api/device-client.ts

# 迁移图片处理器
echo "🖼️  迁移图片处理器..."
mv image-processor.ts processors/image/base-processor.ts

# 迁移优化器
echo "⚡ 迁移优化处理器..."
mv monochrome-optimizer.ts processors/optimization/monochrome-optimizer.ts
mv eink-optimizer.ts processors/optimization/dithering-optimizer.ts

# 迁移媒体处理器
echo "📹 迁移媒体处理器..."
mv gif-processor.ts processors/media/gif-processor.ts

# 迁移主要编排器
echo "🎯 迁移编排器..."
mv image-sender.ts orchestrators/image-sender.ts

# 处理CLI模块
echo "💻 迁移CLI接口..."
# CLI文件需要拆分，先移动到临时位置
mv cli.ts interfaces/cli/cli-main.ts

# 迁移类型声明
echo "📝 迁移类型声明..."
mv epdoptimize.d.ts core/types/epdoptimize.d.ts

# 清理已迁移的文件
echo "🧹 清理原文件..."
rm -f types.ts device-profiles.ts 2>/dev/null || true

echo "✅ 文件迁移完成！"

# 显示新结构
echo "📊 新的目录结构："
tree . -I "__backup|node_modules" || find . -type d | sort