#!/bin/bash
#
# 懒猫微服应用构建脚本
# 用于构建和推送 Quote0-MCP 应用到懒猫微服
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
APP_NAME="quote0-mcp"
APP_VERSION="1.0.0"
LAZYCAT_PACKAGE="me.friday.quote0-mcp"
REGISTRY="registry.lazycat.cloud"
USERNAME="friday"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Quote0-MCP 懒猫微服应用构建脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 检查命令
command -v docker >/dev/null 2>&1 || { echo -e "${RED}错误: Docker 未安装${NC}" >&2; exit 1; }

# 检查 lzc-cli（可选）
if command -v lzc-cli >/dev/null 2>&1; then
    echo -e "${GREEN}✓ lzc-cli 已安装${NC}"
    LZC_CLI=true
else
    echo -e "${YELLOW}⚠ lzc-cli 未安装，跳过 LPK 构建${NC}"
    echo -e "${YELLOW}  安装命令: npm install -g @lazycatcloud/lzc-cli${NC}"
    LZC_CLI=false
fi

# 步骤 1: 构建 API 服务镜像
echo -e "${BLUE}[步骤 1/4] 构建 API 服务镜像...${NC}"
docker build -f Dockerfile.api -t ${APP_NAME}-api:latest .

# 步骤 2: 标签镜像
echo -e "${BLUE}[步骤 2/4] 标记镜像...${NC}"
docker tag ${APP_NAME}-api:latest ${REGISTRY}/${USERNAME}/${APP_NAME}-api:${APP_VERSION}
docker tag ${APP_NAME}-api:latest ${REGISTRY}/${USERNAME}/${APP_NAME}-api:latest

echo -e "${GREEN}✓ 镜像构建完成${NC}"
echo ""
echo -e "${YELLOW}本地镜像:${NC}"
docker images ${APP_NAME}-api:latest --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
echo ""

# 步骤 3: 推送镜像到懒猫 registry（如果需要）
echo -e "${BLUE}[步骤 3/4] 推送镜像到懒猫 registry...${NC}"
echo -e "${YELLOW}注意: 需要先登录懒猫 registry${NC}"
echo -e "${YELLOW}      lzc-cli appstore login${NC}"
echo ""

if [ "$LZC_CLI" = true ]; then
    echo -e "${BLUE}使用 lzc-cli 推送镜像...${NC}"
    echo -e "${YELLOW}执行: lzc-cli appstore copy-image ${APP_NAME}-api:latest${NC}"
    echo ""
    read -p "是否继续推送? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        lzc-cli appstore copy-image ${APP_NAME}-api:latest
        echo -e "${GREEN}✓ 镜像推送完成${NC}"
    else
        echo -e "${YELLOW}跳过镜像推送${NC}"
    fi
else
    echo -e "${YELLOW}lzc-cli 未安装，请手动推送镜像:${NC}"
    echo -e "  1. 安装 lzc-cli: npm install -g @lazycatcloud/lzc-cli"
    echo -e "  2. 登录: lzc-cli appstore login"
    echo -e "  3. 推送: lzc-cli appstore copy-image ${APP_NAME}-api:latest"
fi

echo ""

# 步骤 4: 构建 LPK 包
echo -e "${BLUE}[步骤 4/4] 构建懒猫应用包 (LPK)...${NC}"

if [ "$LZC_CLI" = true ]; then
    cd lazycat
    
    # 检查图标是否存在
    if [ ! -f icon.png ]; then
        echo -e "${YELLOW}警告: 未找到图标文件，创建默认图标...${NC}"
        # 创建一个简单的默认图标（1x1 像素透明 PNG）
        printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\xfc\xcf\xc0\x50\x0f\x00\x04A\x01\xa1\x3a\xf0\xfc\xcc\x00\x00\x00\x00IEND\xaeB`\x82' > icon.png
    fi
    
    echo -e "${BLUE}构建 LPK...${NC}"
    lzc-cli project build
    
    echo -e "${GREEN}✓ LPK 构建完成${NC}"
    echo ""
    echo -e "${YELLOW}生成的文件:${NC}"
    ls -lh *.lpk 2>/dev/null || echo -e "${YELLOW}未找到 LPK 文件${NC}"
    
    cd ..
else
    echo -e "${YELLOW}lzc-cli 未安装，跳过 LPK 构建${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  构建流程完成!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}下一步操作:${NC}"
echo ""
echo -e "1. ${YELLOW}安装应用:${NC}"
echo -e "   lzc-cli app install ./lazycat/${LAZYCAT_PACKAGE}-v${APP_VERSION}.lpk"
echo ""
echo -e "2. ${YELLOW}配置环境变量 (首次安装后):${NC}"
echo -e "   在懒猫微服控制台设置以下环境变量:"
echo -e "   - MINDRESET_DEVICE_ID: 你的设备ID"
echo -e "   - MINDRESET_DEVICE_SECRET: 你的设备密钥"
echo ""
echo -e "3. ${YELLOW}访问应用:${NC}"
echo -e "   - API服务: https://quote0.<你的域名>.lazycat.cloud"
echo -e "   - 标注系统: https://annotation-quote0.<你的域名>.lazycat.cloud"
echo ""
echo -e "${BLUE}更多帮助请参考:${NC}"
echo -e "   lazycat/DEPLOY.md"
echo ""
