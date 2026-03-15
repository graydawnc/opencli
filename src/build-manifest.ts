#!/usr/bin/env node
/**
 * Build-time CLI manifest compiler.
 *
 * Scans all YAML/TS CLI definitions and pre-compiles them into a single
 * manifest.json for instant cold-start registration (no runtime YAML parsing).
 *
 * Usage: npx tsx src/build-manifest.ts
 * Output: dist/cli-manifest.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIS_DIR = path.resolve(__dirname, 'clis');
const OUTPUT = path.resolve(__dirname, '..', 'dist', 'cli-manifest.json');

interface ManifestEntry {
  site: string;
  name: string;
  description: string;
  domain?: string;
  strategy: string;
  browser: boolean;
  args: Array<{
    name: string;
    type?: string;
    default?: any;
    required?: boolean;
    help?: string;
    choices?: string[];
  }>;
  columns?: string[];
  pipeline?: any[];
  timeout?: number;
  /** 'yaml' or 'ts' — determines how executeCommand loads the handler */
  type: 'yaml' | 'ts';
  /** Relative path from clis/ dir, e.g. 'bilibili/hot.yaml' or 'bilibili/search.js' */
  modulePath?: string;
}

function scanYaml(filePath: string, site: string): ManifestEntry | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const def = yaml.load(raw) as any;
    if (!def || typeof def !== 'object') return null;

    const strategyStr = def.strategy ?? (def.browser === false ? 'public' : 'cookie');
    const strategy = strategyStr.toUpperCase();
    const browser = def.browser ?? (strategy !== 'PUBLIC');

    const args: ManifestEntry['args'] = [];
    if (def.args && typeof def.args === 'object') {
      for (const [argName, argDef] of Object.entries(def.args as Record<string, any>)) {
        args.push({
          name: argName,
          type: argDef?.type ?? 'str',
          default: argDef?.default,
          required: argDef?.required ?? false,
          help: argDef?.description ?? argDef?.help ?? '',
          choices: argDef?.choices,
        });
      }
    }

    return {
      site: def.site ?? site,
      name: def.name ?? path.basename(filePath, path.extname(filePath)),
      description: def.description ?? '',
      domain: def.domain,
      strategy: strategy.toLowerCase(),
      browser,
      args,
      columns: def.columns,
      pipeline: def.pipeline,
      timeout: def.timeout,
      type: 'yaml',
    };
  } catch (err: any) {
    process.stderr.write(`Warning: failed to parse ${filePath}: ${err.message}\n`);
    return null;
  }
}

function scanTs(filePath: string, site: string): ManifestEntry {
  // TS adapters self-register via cli() at import time.
  // We record their module path for lazy dynamic import.
  const baseName = path.basename(filePath, path.extname(filePath));
  const relativePath = `${site}/${baseName}.js`;
  return {
    site,
    name: baseName,
    description: '',
    strategy: 'cookie',
    browser: true,
    args: [],
    type: 'ts',
    modulePath: relativePath,
  };
}

// Main
const manifest: ManifestEntry[] = [];

if (fs.existsSync(CLIS_DIR)) {
  for (const site of fs.readdirSync(CLIS_DIR)) {
    const siteDir = path.join(CLIS_DIR, site);
    if (!fs.statSync(siteDir).isDirectory()) continue;
    for (const file of fs.readdirSync(siteDir)) {
      const filePath = path.join(siteDir, file);
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const entry = scanYaml(filePath, site);
        if (entry) manifest.push(entry);
      } else if (file.endsWith('.ts') && file !== 'index.ts') {
        manifest.push(scanTs(filePath, site));
      }
    }
  }
}

// Ensure output directory exists
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(manifest, null, 2));

const yamlCount = manifest.filter(e => e.type === 'yaml').length;
const tsCount = manifest.filter(e => e.type === 'ts').length;
console.log(`✅ Manifest compiled: ${manifest.length} entries (${yamlCount} YAML, ${tsCount} TS) → ${OUTPUT}`);
