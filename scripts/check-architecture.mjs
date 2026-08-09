import fs from 'node:fs';
import path from 'node:path';

import {
  estimateBinanceRateCost
} from '../local-daemon/src/infrastructure/binance/binanceRateCoordinator.js';

const root = process.cwd();
const sourceRoots = [
  'src/app',
  'src/domain',
  'src/features',
  'src/infrastructure',
  'src/shared',
  'local-daemon/src'
];
const extensions = new Set(['.js', '.jsx']);
const violations = [];

function walk(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) return [];

  return fs
    .readdirSync(absoluteDirectory, { withFileTypes: true })
    .flatMap(entry => {
      const relativePath = path.join(relativeDirectory, entry.name);
      return entry.isDirectory()
        ? walk(relativePath)
        : extensions.has(path.extname(entry.name))
          ? [relativePath]
          : [];
    });
}

for (const file of sourceRoots.flatMap(walk)) {
  const normalized = file.replaceAll('\\', '/');
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const importPattern = /from\s+['"]([^'"]+)['"]/g;
  const legacyRoots = [
    'src/components/',
    'src/config/constants',
    'src/core/',
    'src/hooks/',
    'src/services/',
    'src/store/'
  ];
  let match;

  while ((match = importPattern.exec(source)) !== null) {
    if (!match[1].startsWith('.')) continue;
    const resolved = path
      .normalize(path.join(path.dirname(file), match[1]))
      .replaceAll('\\', '/');

    if (legacyRoots.some(legacyRoot => resolved.startsWith(legacyRoot))) {
      violations.push(
        `${normalized}: imports through legacy path ${match[1]}`
      );
    }
  }

  if (
    normalized.startsWith('src/domain/') &&
    /from\s+['"][^'"]*(?:infrastructure|features|app)\//.test(source)
  ) {
    violations.push(
      `${normalized}: domain code depends on an outer frontend layer`
    );
  }

  if (
    normalized.startsWith('local-daemon/src/domain/') &&
    /from\s+['"][^'"]*(?:application|infrastructure|presentation)\//.test(
      source
    )
  ) {
    violations.push(
      `${normalized}: daemon domain code depends on an outer layer`
    );
  }

  const isTest = normalized.endsWith('.test.js');
  const isBinanceGateway = normalized ===
    'local-daemon/src/infrastructure/binance/binanceGateway.js';
  if (
    !isTest &&
    !isBinanceGateway &&
    /fetch\s*\(\s*[`'"]https:\/\/(?:fapi|api)\.binance\.com/s.test(source)
  ) {
    violations.push(
      `${normalized}: direct Binance fetch bypasses binanceGateway.js`
    );
  }
  if (
    !isTest &&
    !isBinanceGateway &&
    /from\s+['"]axios['"]/.test(source)
  ) {
    violations.push(
      `${normalized}: direct Axios import bypasses binanceGateway.js`
    );
  }

  if (!isTest && !normalized.includes('/infrastructure/binance/')) {
    const endpointPattern =
      /\/(?:fapi\/v\d+|futures\/data|api\/v3|sapi\/v\d+)\/[A-Za-z0-9_/-]+/gu;
    for (const endpoint of new Set(source.match(endpointPattern) || [])) {
      try {
        estimateBinanceRateCost({ endpoint });
      } catch {
        violations.push(
          `${normalized}: Binance endpoint has no fail-closed weight contract: ${endpoint}`
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Architecture boundary violations:');
  violations.forEach(violation => console.error(`- ${violation}`));
  process.exit(1);
}

console.log('Architecture boundaries are valid.');
