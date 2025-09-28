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

interface DeployOptions {
  containerName: string;
  imageTag: string;
  dockerfile: string;
  contextPath: string;
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

async function buildDockerImage(docker: Docker, options: DeployOptions): Promise<void> {
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

function buildNetworkingConfig(networks: Record<string, any> | undefined) {
  if (!networks) {
    return undefined;
  }
  const endpoints: Record<string, any> = {};
  for (const [name, config] of Object.entries(networks)) {
    endpoints[name] = {
      Aliases: config.Aliases,
      Links: config.Links,
      IPAMConfig: config.IPAMConfig,
      IPv4Address: config.IPAddress,
      IPv6Address: config.GlobalIPv6Address,
    };
  }
  if (Object.keys(endpoints).length === 0) {
    return undefined;
  }
  return { EndpointsConfig: endpoints };
}

async function recreateContainer(docker: Docker, opts: DeployOptions): Promise<void> {
  const container = docker.getContainer(opts.containerName);
  try {
    const inspect = await container.inspect();
    console.log(`
🔄 Recreating container ${opts.containerName} ...`);

    const config = JSON.parse(JSON.stringify(inspect.Config));
    const hostConfig = JSON.parse(JSON.stringify(inspect.HostConfig));
    const networkingConfig = buildNetworkingConfig(inspect.NetworkSettings?.Networks);

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

    const createOptions: ContainerCreateOptions = {
      name: opts.containerName,
      Image: opts.imageTag,
      Env: config.Env,
      Cmd: config.Cmd,
      Entrypoint: config.Entrypoint,
      WorkingDir: config.WorkingDir,
      Labels: config.Labels,
      ExposedPorts: config.ExposedPorts,
      HostConfig: hostConfig,
    };

    if (networkingConfig) {
      createOptions.NetworkingConfig = networkingConfig;
    }

    console.log('📦 Creating new container instance');
    const newContainer = await docker.createContainer(createOptions);

    console.log('🚀 Starting container');
    await newContainer.start();

    console.log('✅ Container recreated successfully');
  } catch (error: any) {
    if (error?.statusCode === 404) {
      throw new Error(
        `Container ${opts.containerName} not found. Please run "docker compose up -d news-api" once before using the deployer.`,
      );
    }
    throw error;
  }
}

async function main() {
  const containerName = process.env.DEPLOY_CONTAINER_NAME || 'quote0-news-api';
  const dockerfile = process.env.DEPLOY_DOCKERFILE || 'Dockerfile.api';
  const contextPath = process.env.DEPLOY_CONTEXT || ROOT_DIR;

  const docker = new Docker();

  console.log('🔍 Detecting current container image');
  let imageTag = process.env.DEPLOY_IMAGE_TAG || 'quote0-mcp-news-api';
  try {
    const inspect = await docker.getContainer(containerName).inspect();
    if (inspect?.Config?.Image) {
      imageTag = inspect.Config.Image;
    }
  } catch (error: any) {
    if (error?.statusCode === 404) {
      console.warn(`⚠️ Container ${containerName} not found. Using default image tag ${imageTag}`);
    } else {
      throw error;
    }
  }

  const hostBuildEnabled = (process.env.DEPLOY_HOST_BUILD || 'false').toLowerCase() === 'true';

  if (hostBuildEnabled) {
    console.log('🛠️  Running TypeScript build on host');
    await runCommand('npm', ['run', 'build']);
  } else {
    console.log('⏭️  Skipping host TypeScript build (build will rely on container image)');
  }

  await buildDockerImage(docker, {
    containerName,
    imageTag,
    dockerfile,
    contextPath,
  });

  await recreateContainer(docker, {
    containerName,
    imageTag,
    dockerfile,
    contextPath,
  });

  console.log('\n🎉 Deployment complete');
}

main().catch((error) => {
  console.error('\n❌ Deployment failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
