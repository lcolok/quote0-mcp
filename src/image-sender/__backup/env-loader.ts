import fs from 'fs';
import path from 'path';

export class EnvLoader {
  static load(envPath?: string): void {
    const envFile = envPath || path.resolve(process.cwd(), '.env');
    
    if (!fs.existsSync(envFile)) {
      console.warn(`警告: .env 文件不存在: ${envFile}`);
      return;
    }

    try {
      const envContent = fs.readFileSync(envFile, 'utf-8');
      const lines = envContent.split('\n');

      for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (trimmedLine === '' || trimmedLine.startsWith('#')) {
          continue;
        }

        const equalIndex = trimmedLine.indexOf('=');
        if (equalIndex === -1) {
          continue;
        }

        const key = trimmedLine.substring(0, equalIndex).trim();
        const value = trimmedLine.substring(equalIndex + 1).trim();

        if (key && !process.env[key]) {
          process.env[key] = value;
        }
      }

      console.log(`✅ 已加载环境变量: ${envFile}`);
    } catch (error) {
      console.error(`加载.env文件失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static ensureEnvVars(): void {
    EnvLoader.load();
    
    const deviceId = process.env.MINDRESET_DEVICE_ID;
    const deviceSecret = process.env.MINDRESET_DEVICE_SECRET;

    if (!deviceId || !deviceSecret) {
      console.error('❌ 错误: 缺少必需的环境变量');
      console.error('请确保 .env 文件包含:');
      console.error('MINDRESET_DEVICE_ID=你的设备ID');
      console.error('MINDRESET_DEVICE_SECRET=你的设备密钥');
      process.exit(1);
    }

    console.log(`✅ 设备ID: ${deviceId}`);
  }
}