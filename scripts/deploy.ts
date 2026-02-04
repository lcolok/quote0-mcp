#!/usr/bin/env bun

import Docker from 'dockerode';
import type { ContainerCreateOptions } from 'dockerode';
import tar from 'tar-fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const ANNOTATION_DIR = path.join(ROOT_DIR, 'annotation-web');

const SERVICES: ServiceConfig[] = [
  {
    key: 'news-api',
    containerName: 'quote0-news-api',
    defaultImageTag: 'quote0-mcp-news-api',
    dockerfile: 'Dockerfile.api',
    contextPath: ROOT_DIR,
    hostBuild: true,
  },
  {
    key: 'annotation-web',
    containerName: 'quote0-annotation-web',
    defaultImageTag: 'quote0-mcp-annotation-web',
    dockerfile: 'Dockerfile',
    contextPath: ANNOTATION_DIR,
  },
];

interface ImageBuildOptions {
  containerName: string;
  imageTag: string;
  dockerfile: string;
  contextPath: string;
}

interface DeployOptions extends ImageBuildOptions {
  serviceKey: string;
}

interface ServiceConfig {
  key: string;
  containerName: string;
  defaultImageTag: string;
  dockerfile: string;
  contextPath: string;
  hostBuild?: boolean;
}

async function runCommand(command: string, args: string[], options: { cwd?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT_DIR,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

function createTarStream(contextPath: string): tar.Pack {
  const ignorePrefixes = [
    'node_modules',
    '.git',
    '.claude',
    '.vscode',
    'processed-images',
    'web-feedback-data',
    'processed-images',
    'docker/postgres/init/backups',
  ];

  return tar.pack(contextPath, {
    ignore: (name: string) => {
      const relative = path.relative(contextPath, name);
      if (!relative || relative.startsWith('..')) {
        return false;
      }
      const normalized = relative.split(path.sep).join('/');
      return ignorePrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
    },
  });
}

async function buildDockerImage(docker: Docker, options: ImageBuildOptions): Promise<void> {
  console.log(`
🚢 Building Docker image ${options.imageTag} ...`);

  const tarStream = createTarStream(options.contextPath);

  const buildStream = await docker.buildImage(tarStream, {
    t: options.imageTag,
    dockerfile: options.dockerfile,
    pull: false,
    nocache: true,
    buildargs: {
      BUILD_REVISION: Date.now().toString(),
    },
  });

  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      buildStream,
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      },
      (event) => {
        if (event?.stream) {
          process.stdout.write(event.stream);
        }
        if (event?.error) {
          process.stderr.write(event.error);
        }
      },
    );
  });

  console.log('✅ Docker image build complete');
}

async function recreateContainer(docker: Docker, opts: DeployOptions): Promise<void> {
  const container = docker.getContainer(opts.containerName);
  try {
    // 检查容器是否存在
    await container.inspect();
    
    console.log(`
🔄 Recreating container ${opts.containerName} ...`);
    console.log('⏹️  Stopping current container');
    try {
      await container.stop();
    } catch (error: any) {
      if (error?.statusCode !== 304 && error?.statusCode !== 404) {
        throw error;
      }
    }

    console.log('🧹 Removing current container');
    await container.remove({ force: true });

    // 总是使用 docker compose up 来启动，确保从 docker-compose.yml 读取最新配置
    console.log('🚀 Starting container via docker compose (to use latest docker-compose.yml config)');
    await runCommand('docker-compose', ['up', '-d', '--no-deps', '--force-recreate', opts.serviceKey]);
    console.log(`✅ Container ${opts.containerName} started with docker compose`);
    
  } catch (error: any) {
    if (error?.statusCode === 404) {
      console.warn(
        `⚠️ Container ${opts.containerName} not found. Attempting initial startup via docker compose...`,
      );
      await runCommand('docker-compose', ['up', '-d', '--no-build', opts.serviceKey]);
      console.log(`✅ Container ${opts.containerName} started with docker compose`);
      return;
    }
    throw error;
  }
}

async function main() {
  const docker = new Docker();

  const targetsEnv = (process.env.DEPLOY_TARGETS || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  let selectedServices: ServiceConfig[];

  if (targetsEnv.length > 0) {
    selectedServices = SERVICES.filter((service) =>
      targetsEnv.some((target) => target === service.key || target === service.containerName),
    );
    if (selectedServices.length === 0) {
      throw new Error(`No services matched DEPLOY_TARGETS=${targetsEnv.join(',')}`);
    }
  } else if (process.env.DEPLOY_CONTAINER_NAME) {
    const override = process.env.DEPLOY_CONTAINER_NAME;
    const matched = SERVICES.find(
      (service) => service.containerName === override || service.key === override,
    );
    if (!matched) {
      throw new Error(
        `DEPLOY_CONTAINER_NAME=${override} is not recognised. ` +
          `Use DEPLOY_TARGETS=news-api,annotation-web to deploy multiple services.`,
      );
    }
    selectedServices = [matched];
  } else {
    selectedServices = SERVICES;
  }

  const hostBuildEnabled = (process.env.DEPLOY_HOST_BUILD || 'false').toLowerCase() === 'true';
  let hostBuildExecuted = false;

  for (const service of selectedServices) {
    console.log(`\n=============================`);
    console.log(`🚀 Deploying ${service.key} (${service.containerName})`);
    console.log('=============================');

    let imageTag = service.defaultImageTag;
    const singleService = selectedServices.length === 1;

    if (singleService && process.env.DEPLOY_IMAGE_TAG) {
      imageTag = process.env.DEPLOY_IMAGE_TAG;
    } else {
      try {
        const inspect = await docker.getContainer(service.containerName).inspect();
        if (inspect?.Config?.Image) {
          imageTag = inspect.Config.Image;
        }
      } catch (error: any) {
        if (error?.statusCode === 404) {
          console.warn(
            `⚠️ Container ${service.containerName} not found. Using default image tag ${imageTag}`,
          );
        } else {
          throw error;
        }
      }
    }

    let dockerfile = service.dockerfile;
    let contextPath = service.contextPath;

    if (singleService && process.env.DEPLOY_DOCKERFILE) {
      dockerfile = process.env.DEPLOY_DOCKERFILE;
    }

    if (singleService && process.env.DEPLOY_CONTEXT) {
      contextPath = path.isAbsolute(process.env.DEPLOY_CONTEXT)
        ? process.env.DEPLOY_CONTEXT
        : path.resolve(ROOT_DIR, process.env.DEPLOY_CONTEXT);
    }

    if (hostBuildEnabled && service.hostBuild && !hostBuildExecuted) {
      console.log('🛠️  Running TypeScript build on host');
      await runCommand('npm', ['run', 'build']);
      hostBuildExecuted = true;
    } else if (service.hostBuild && !hostBuildEnabled && !hostBuildExecuted) {
      console.log('⏭️  Skipping host TypeScript build (build will rely on container image)');
      hostBuildExecuted = true;
    }

    await buildDockerImage(docker, {
      containerName: service.containerName,
      imageTag,
      dockerfile,
      contextPath,
    });

    await recreateContainer(docker, {
      containerName: service.containerName,
      imageTag,
      dockerfile,
      contextPath,
      serviceKey: service.key,
    });
  }

  console.log('\n🎉 Deployment complete');
}

main().catch((error) => {
  console.error('\n❌ Deployment failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
