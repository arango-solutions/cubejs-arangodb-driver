import { execFileSync } from 'child_process';
import { renameSync } from 'fs';
import { join, resolve } from 'path';
import { Database } from 'arangojs';
import jwt from 'jsonwebtoken';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';

const ROOT_DIR = resolve(__dirname, '..', '..');
const E2E_DIR = __dirname;
const API_SECRET = 'e2e-secret';
const ROOT_PASSWORD = 'dev';

/**
 * Builds the driver and packs it into `test/e2e/driver.tgz` so the Cube image
 * installs the local code (not the published package).
 */
function packDriver(): void {
  execFileSync('npm', ['run', 'build'], { cwd: ROOT_DIR, stdio: 'inherit' });
  const output = execFileSync('npm', ['pack', '--json'], { cwd: ROOT_DIR }).toString();
  const tarball = JSON.parse(output)[0].filename as string;
  const packed = join(ROOT_DIR, tarball.replace(/^.*\//, ''));
  renameSync(packed, join(E2E_DIR, 'driver.tgz'));
}

async function seedArango(url: string): Promise<void> {
  const db = new Database({
    url,
    databaseName: '_system',
    auth: { username: 'root', password: ROOT_PASSWORD },
  });

  const customer = await db.createCollection('Customer');
  await customer.saveAll([
    { code: 'C1', name: 'Alice', countryOfDestination: 'US' },
    { code: 'C2', name: 'Bob', countryOfDestination: 'US' },
    { code: 'C3', name: 'Carol', countryOfDestination: 'UK' },
  ]);

  db.close();
}

describe('Cube + ArangoDB driver (e2e)', () => {
  let environment: StartedDockerComposeEnvironment;
  let cubeUrl: string;
  let token: string;

  beforeAll(async () => {
    packDriver();

    environment = await new DockerComposeEnvironment(ROOT_DIR, 'docker-compose.e2e.yml')
      .withBuild()
      .withStartupTimeout(300000)
      .withWaitStrategy('cube-1', Wait.forHttp('/readyz', 4000).forStatusCode(200))
      .up();

    const arango = environment.getContainer('arangodb-1');
    const arangoUrl = `http://${arango.getHost()}:${arango.getMappedPort(8529)}`;
    await seedArango(arangoUrl);

    const cube = environment.getContainer('cube-1');
    cubeUrl = `http://${cube.getHost()}:${cube.getMappedPort(4000)}`;
    token = jwt.sign({}, API_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
    if (environment) {
      await environment.down();
    }
  });

  it('exposes the arangodb-backed cube via the meta API', async () => {
    const res = await fetch(`${cubeUrl}/cubejs-api/v1/meta`, {
      headers: { Authorization: token },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const cubeNames = body.cubes.map((c: any) => c.name);
    expect(cubeNames).toContain('customers');
  });

  it('answers an aggregated load query transpiled to AQL', async () => {
    const query = {
      measures: ['customers.count'],
      dimensions: ['customers.country'],
      order: { 'customers.count': 'desc' },
    };

    const load = async () => fetch(
      `${cubeUrl}/cubejs-api/v1/load?query=${encodeURIComponent(JSON.stringify(query))}`,
      { headers: { Authorization: token } }
    );

    // Cube may respond with "Continue wait" while the query is computed.
    let body: any;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const res = await load();
      body = await res.json();

      if (res.status === 200 && body.data) {
        break;
      }

      if (body.error && body.error !== 'Continue wait') {
        throw new Error(`Cube load failed: ${JSON.stringify(body)}`);
      }

      await new Promise((r) => { setTimeout(r, 1000); });
    }

    expect(body.data).toBeDefined();

    const byCountry: Record<string, number> = {};
    for (const row of body.data) {
      byCountry[row['customers.country']] = Number(row['customers.count']);
    }

    expect(byCountry.US).toBe(2);
    expect(byCountry.UK).toBe(1);
  });
});
