import {createHash} from 'node:crypto';
import {createServer, type Server} from 'node:http';
import {gzipSync} from 'node:zlib';
import * as tar from 'tar-stream';

export type RegistryPackageVersion = {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export type RegistryPackage = {
  name: string;
  versions: Array<RegistryPackageVersion>;
};

type TarballRecord = {
  bytes: Buffer;
  shasum: string;
  integrity: string;
};

function sha1(data: Buffer) {
  return createHash(`sha1`).update(data).digest(`hex`);
}

function sha512(data: Buffer) {
  return createHash(`sha512`).update(data).digest(`base64`);
}

async function createTarball(name: string, version: RegistryPackageVersion) {
  const pack = tar.pack();
  const chunks: Array<Buffer> = [];

  const completed = new Promise<Buffer>((resolve, reject) => {
    pack.on(`data`, (chunk: Buffer) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    pack.on(`end`, () => {
      resolve(Buffer.concat(chunks));
    });
    pack.on(`error`, reject);
  });

  const manifest = JSON.stringify({
    name,
    version: version.version,
    main: `index.js`,
    dependencies: version.dependencies ?? {},
    peerDependencies: version.peerDependencies ?? {},
  }, null, 2);

  pack.entry({name: `package/package.json`}, manifest);
  pack.entry({name: `package/index.js`}, `module.exports = ${JSON.stringify(`${name}@${version.version}`)};\n`);
  pack.finalize();

  const tarball = gzipSync(await completed);
  return {
    bytes: tarball,
    shasum: sha1(tarball),
    integrity: `sha512-${sha512(tarball)}`,
  } satisfies TarballRecord;
}

export class MockRegistry {
  private readonly packages: Array<RegistryPackage>;
  private readonly tarballs = new Map<string, TarballRecord>();
  private server: Server | null = null;
  private port = 0;

  constructor(packages: Array<RegistryPackage>) {
    this.packages = packages;
  }

  get url() {
    if (this.server === null)
      throw new Error(`The mock registry has not been started`);

    return `http://127.0.0.1:${this.port}`;
  }

  async start() {
    for (const pkg of this.packages) {
      for (const version of pkg.versions) {
        const tarball = await createTarball(pkg.name, version);
        this.tarballs.set(`${pkg.name}@${version.version}`, tarball);
      }
    }

    this.server = createServer((request, response) => {
      if (request.method !== `GET`) {
        response.statusCode = 405;
        response.end(`Method not allowed`);
        return;
      }

      const requestUrl = new URL(request.url ?? `/`, this.url);
      const pathname = decodeURIComponent(requestUrl.pathname);

      const tarballMatch = pathname.match(/^\/tarballs\/(?<name>[^/]+)-(?<version>\d+\.\d+\.\d+)\.tgz$/);
      if (tarballMatch?.groups) {
        const tarball = this.tarballs.get(`${tarballMatch.groups.name}@${tarballMatch.groups.version}`);
        if (!tarball) {
          response.statusCode = 404;
          response.end(`Not found`);
          return;
        }

        response.setHeader(`content-type`, `application/octet-stream`);
        response.end(tarball.bytes);
        return;
      }

      const packageName = pathname.replace(/^\/+/, ``);
      const pkg = this.packages.find(candidate => candidate.name === packageName);
      if (!pkg) {
        response.statusCode = 404;
        response.end(`Not found`);
        return;
      }

      const versions = Object.fromEntries(pkg.versions.map(version => {
        const tarball = this.tarballs.get(`${pkg.name}@${version.version}`);
        if (!tarball)
          throw new Error(`Missing tarball for ${pkg.name}@${version.version}`);

        return [version.version, {
          name: pkg.name,
          version: version.version,
          main: `index.js`,
          dependencies: version.dependencies ?? {},
          peerDependencies: version.peerDependencies ?? {},
          dist: {
            tarball: `${this.url}/tarballs/${pkg.name}-${version.version}.tgz`,
            shasum: tarball.shasum,
            integrity: tarball.integrity,
          },
        }];
      }));

      const sortedVersions = [...pkg.versions].sort((left, right) => {
        return left.version.localeCompare(right.version, undefined, {numeric: true});
      });
      const latest = sortedVersions[sortedVersions.length - 1];

      response.setHeader(`content-type`, `application/json`);
      response.end(JSON.stringify({
        name: pkg.name,
        'dist-tags': latest ? {latest: latest.version} : {},
        versions,
        time: Object.fromEntries(pkg.versions.map(version => [version.version, new Date(`2024-01-01T00:00:00.000Z`).toISOString()])),
      }));
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once(`error`, reject);
      this.server?.listen(0, `127.0.0.1`, () => {
        const address = this.server?.address();
        if (!address || typeof address === `string`) {
          reject(new Error(`Failed to start the mock registry`));
          return;
        }

        this.port = address.port;
        resolve();
      });
    });
  }

  async stop() {
    if (this.server === null)
      return;

    await new Promise<void>((resolve, reject) => {
      this.server?.close(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    this.server = null;
  }
}
