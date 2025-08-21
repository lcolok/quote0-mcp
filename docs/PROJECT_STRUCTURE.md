# 小屏幕React系统 - 项目结构详解

## 📁 完整目录结构

```
small-screen-react/
├── 📁 packages/                    # Monorepo架构
│   ├── 📁 core/                   # 核心组件库
│   │   ├── 📁 src/
│   │   │   ├── 📁 components/     # 组件
│   │   │   │   ├── 📁 base/       # 基础组件
│   │   │   │   │   ├── Typography/
│   │   │   │   │   │   ├── Heading.tsx
│   │   │   │   │   │   ├── Text.tsx
│   │   │   │   │   │   ├── Label.tsx
│   │   │   │   │   │   └── index.ts
│   │   │   │   │   ├── Layout/
│   │   │   │   │   │   ├── Container.tsx
│   │   │   │   │   │   ├── Grid.tsx
│   │   │   │   │   │   ├── Flex.tsx
│   │   │   │   │   │   ├── Stack.tsx
│   │   │   │   │   │   └── index.ts
│   │   │   │   │   └── index.ts
│   │   │   │   ├── 📁 info/       # 信息展示组件
│   │   │   │   │   ├── Cards/
│   │   │   │   │   │   ├── InfoCard.tsx
│   │   │   │   │   │   ├── MetricCard.tsx
│   │   │   │   │   │   ├── StatusCard.tsx
│   │   │   │   │   │   └── index.ts
│   │   │   │   │   ├── Charts/
│   │   │   │   │   │   ├── MiniChart.tsx
│   │   │   │   │   │   ├── SparkLine.tsx
│   │   │   │   │   │   └── index.ts
│   │   │   │   │   └── index.ts
│   │   │   │   └── 📁 composite/  # 复合组件
│   │   │   │       ├── Dashboard/
│   │   │   │       ├── Panels/
│   │   │   │       └── index.ts
│   │   │   ├── 📁 hooks/          # 自定义Hooks
│   │   │   │   ├── useScreenSize.ts
│   │   │   │   ├── useHighContrast.ts
│   │   │   │   ├── useOptimizedRender.ts
│   │   │   │   └── index.ts
│   │   │   ├── 📁 themes/         # 主题系统
│   │   │   │   ├── base/
│   │   │   │   ├── eink/
│   │   │   │   ├── lcd/
│   │   │   │   └── index.ts
│   │   │   ├── 📁 utils/          # 工具函数
│   │   │   │   ├── contrast.ts
│   │   │   │   ├── layout.ts
│   │   │   │   ├── optimization.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts           # 主入口
│   │   ├── 📄 package.json
│   │   ├── 📄 tsconfig.json
│   │   └── 📄 README.md
│   │
│   ├── 📁 device-adapters/        # 设备适配器
│   │   ├── 📁 src/
│   │   │   ├── 📁 adapters/
│   │   │   │   ├── MindResetAdapter.ts
│   │   │   │   ├── GenericEInkAdapter.ts
│   │   │   │   ├── LCDAdapter.ts
│   │   │   │   └── index.ts
│   │   │   ├── 📁 types/
│   │   │   │   ├── device.ts
│   │   │   │   ├── adapter.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── 📄 package.json
│   │   └── 📄 README.md
│   │
│   ├── 📁 optimization/           # 性能优化包
│   │   ├── 📁 src/
│   │   │   ├── 📁 rendering/
│   │   │   │   ├── VirtualScroll.tsx
│   │   │   │   ├── LazyLoad.tsx
│   │   │   │   ├── BatchRenderer.tsx
│   │   │   │   └── index.ts
│   │   │   ├── 📁 hooks/
│   │   │   │   ├── useDebouncedValue.ts
│   │   │   │   ├── useThrottledCallback.ts
│   │   │   │   ├── useElementSize.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── 📄 package.json
│   │   └── 📄 README.md
│   │
│   └── 📁 templates/              # 模板包
│       ├── 📁 src/
│       │   ├── 📁 screens/
│       │   │   ├── DashboardScreen.tsx
│       │   │   ├── InfoScreen.tsx
│       │   │   ├── SettingsScreen.tsx
│       │   │   └── index.ts
│       │   ├── 📁 layouts/
│       │   │   ├── AppLayout.tsx
│       │   │   ├── ModalLayout.tsx
│       │   │   └── index.ts
│       │   └── index.ts
│       ├── 📄 package.json
│       └── 📄 README.md
│
├── 📁 apps/                       # 示例应用
│   ├── 📁 demo-app/              # 演示应用
│   │   ├── 📁 src/
│   │   │   ├── 📁 components/
│   │   │   ├── 📁 pages/
│   │   │   ├── 📁 hooks/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── index.html
│   │   ├── 📄 package.json
│   │   ├── 📄 vite.config.ts
│   │   └── 📄 README.md
│   │
│   └── 📁 playground/            # 开发调试应用
│       ├── 📁 src/
│       ├── 📄 package.json
│       └── 📄 vite.config.ts
│
├── 📁 tools/                     # 开发工具
│   ├── 📁 build/                # 构建工具
│   ├── 📁 storybook/            # Storybook配置
│   ├── 📁 testing/              # 测试工具
│   └── 📁 linting/              # 代码检查配置
│
├── 📁 docs/                      # 文档
│   ├── 📁 components/           # 组件文档
│   ├── 📁 guides/               # 使用指南
│   ├── 📁 examples/             # 示例代码
│   └── 📄 README.md
│
├── 📄 package.json              # 根package.json
├── 📄 pnpm-workspace.yaml       # Monorepo工作区配置
├── 📄 tsconfig.json             # TypeScript配置
├── 📄 .gitignore
└── 📄 README.md
```

## 🎯 核心组件示例

### 1. 基础组件 - Heading

```typescript
// packages/core/src/components/base/Typography/Heading.tsx
import React from 'react';
import { cn } from '../../../utils';

export interface HeadingProps {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: React.ReactNode;
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  color?: 'primary' | 'secondary' | 'muted';
  truncate?: boolean;
  highContrast?: boolean; // 小屏幕专用
}

const sizeMap = {
  xs: 'text-xs leading-tight',
  sm: 'text-sm leading-tight', 
  md: 'text-base leading-snug',
  lg: 'text-lg leading-snug',
  xl: 'text-xl leading-tight',
};

const weightMap = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold', 
  bold: 'font-bold',
};

export const Heading: React.FC<HeadingProps> = ({
  level,
  children,
  className,
  size = 'md',
  weight = 'semibold',
  color = 'primary',
  truncate = false,
  highContrast = false,
  ...props
}) => {
  const Component = `h${level}` as keyof JSX.IntrinsicElements;
  
  return (
    <Component
      className={cn(
        sizeMap[size],
        weightMap[weight],
        {
          'text-gray-900': color === 'primary',
          'text-gray-600': color === 'secondary', 
          'text-gray-400': color === 'muted',
          'truncate': truncate,
          'filter contrast-150': highContrast, // 小屏幕高对比度
        },
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
};
```

### 2. 信息卡片组件

```typescript
// packages/core/src/components/info/Cards/MetricCard.tsx
import React from 'react';
import { Heading, Text } from '../../base';
import { cn } from '../../../utils';

export interface MetricCardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'compact' | 'minimal';
  highContrast?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  unit,
  trend,
  trendValue,
  icon,
  size = 'md',
  variant = 'default',
  highContrast = false,
}) => {
  const isCompact = variant === 'compact' || variant === 'minimal';
  
  return (
    <div className={cn(
      'bg-white border border-gray-200 rounded-lg',
      {
        'p-2': size === 'sm' || isCompact,
        'p-3': size === 'md' && !isCompact,
        'p-4': size === 'lg' && !isCompact,
        'shadow-sm': variant === 'default',
        'border-gray-900': highContrast,
      }
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <Text 
            size={isCompact ? 'xs' : 'sm'} 
            color="secondary"
            truncate
            highContrast={highContrast}
          >
            {title}
          </Text>
          
          <div className="flex items-baseline gap-1 mt-1">
            <Heading
              level={3}
              size={size === 'lg' ? 'xl' : size === 'md' ? 'lg' : 'md'}
              weight="bold"
              highContrast={highContrast}
            >
              {value}
            </Heading>
            {unit && (
              <Text 
                size="xs" 
                color="muted"
                highContrast={highContrast}
              >
                {unit}
              </Text>
            )}
          </div>
          
          {trend && trendValue && (
            <div className={cn(
              'flex items-center gap-1 mt-1',
              {
                'text-green-600': trend === 'up',
                'text-red-600': trend === 'down',
                'text-gray-500': trend === 'neutral',
              }
            )}>
              <span className="text-xs">
                {trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→'}
              </span>
              <Text size="xs" className="inherit">
                {trendValue}
              </Text>
            </div>
          )}
        </div>
        
        {icon && !isCompact && (
          <div className="flex-shrink-0 ml-2">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
};
```

### 3. 设备适配Hook

```typescript
// packages/core/src/hooks/useScreenSize.ts
import { useEffect, useState } from 'react';

export interface ScreenSize {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  deviceType: 'micro' | 'small' | 'medium' | 'large';
  isTouch: boolean;
}

export function useScreenSize(): ScreenSize {
  const [screenSize, setScreenSize] = useState<ScreenSize>(() => {
    if (typeof window === 'undefined') {
      return {
        width: 0,
        height: 0,
        orientation: 'portrait',
        deviceType: 'medium',
        isTouch: false,
      };
    }

    return calculateScreenSize();
  });

  useEffect(() => {
    function handleResize() {
      setScreenSize(calculateScreenSize());
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return screenSize;
}

function calculateScreenSize(): ScreenSize {
  const width = window.innerWidth;
  const height = window.innerHeight;
  
  return {
    width,
    height,
    orientation: width > height ? 'landscape' : 'portrait',
    deviceType: getDeviceType(width, height),
    isTouch: 'ontouchstart' in window,
  };
}

function getDeviceType(width: number, height: number): ScreenSize['deviceType'] {
  const maxDimension = Math.max(width, height);
  
  if (maxDimension <= 200) return 'micro';    // 如您的296x152设备
  if (maxDimension <= 400) return 'small';    // 小屏幕设备
  if (maxDimension <= 768) return 'medium';   // 平板竖屏
  return 'large';                             // 大屏幕
}
```

## 📦 包管理配置

### 根目录 package.json
```json
{
  "name": "small-screen-react",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  },
  "devDependencies": {
    "@storybook/react": "^7.0.0",
    "turbo": "^1.10.0",
    "typescript": "^5.0.0"
  }
}
```

### 核心包 package.json
```json
{
  "name": "@small-screen/core",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "module": "./dist/index.esm.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.esm.js",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./themes": {
      "import": "./dist/themes.esm.js",
      "require": "./dist/themes.js",
      "types": "./dist/themes.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "rollup -c",
    "dev": "rollup -c -w",
    "test": "vitest",
    "lint": "eslint src/**/*.{ts,tsx}",
    "type-check": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": ">=18.0.0",
    "react-dom": ">=18.0.0"
  },
  "dependencies": {
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "rollup": "^3.0.0",
    "vitest": "^0.34.0"
  }
}
```

这个结构将为您提供一个完整、模块化、可扩展的小屏幕React组件生态系统！