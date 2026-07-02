import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, '../../data');

function readJson<T>(filename: string): T[] {
  const filepath = path.join(DATA_DIR, filename);
  try {
    const raw = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

function writeJson<T>(filename: string, data: T[]): void {
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

export const db = {
  testSpecs: {
    findAll: () => readJson<Record<string, unknown>>('test-specs.json'),
    findById: (id: string) => readJson<Record<string, unknown>>('test-specs.json').find((s) => s['id'] === id),
    create: (item: Record<string, unknown>) => {
      const all = readJson<Record<string, unknown>>('test-specs.json');
      all.push(item);
      writeJson('test-specs.json', all);
      return item;
    },
    update: (id: string, updates: Record<string, unknown>) => {
      const all = readJson<Record<string, unknown>>('test-specs.json');
      const idx = all.findIndex((s) => s['id'] === id);
      if (idx === -1) return null;
      all[idx] = { ...all[idx], ...updates };
      writeJson('test-specs.json', all);
      return all[idx];
    },
    delete: (id: string) => {
      const all = readJson<Record<string, unknown>>('test-specs.json');
      const filtered = all.filter((s) => s['id'] !== id);
      writeJson('test-specs.json', filtered);
      return filtered.length < all.length;
    },
  },
  executions: {
    findAll: () => readJson<Record<string, unknown>>('executions.json'),
    findById: (id: string) => readJson<Record<string, unknown>>('executions.json').find((e) => e['id'] === id),
    findBySpecId: (specId: string) => readJson<Record<string, unknown>>('executions.json').filter((e) => e['specId'] === specId),
    create: (item: Record<string, unknown>) => {
      const all = readJson<Record<string, unknown>>('executions.json');
      all.unshift(item);
      writeJson('executions.json', all);
      return item;
    },
    update: (id: string, updates: Record<string, unknown>) => {
      const all = readJson<Record<string, unknown>>('executions.json');
      const idx = all.findIndex((e) => e['id'] === id);
      if (idx === -1) return null;
      all[idx] = { ...all[idx], ...updates };
      writeJson('executions.json', all);
      return all[idx];
    },
  },
  environments: {
    findAll: () => readJson<Record<string, unknown>>('environments.json'),
    findById: (id: string) => readJson<Record<string, unknown>>('environments.json').find((e) => e['id'] === id),
    create: (item: Record<string, unknown>) => {
      const all = readJson<Record<string, unknown>>('environments.json');
      all.push(item);
      writeJson('environments.json', all);
      return item;
    },
    update: (id: string, updates: Record<string, unknown>) => {
      const all = readJson<Record<string, unknown>>('environments.json');
      const idx = all.findIndex((e) => e['id'] === id);
      if (idx === -1) return null;
      all[idx] = { ...all[idx], ...updates };
      writeJson('environments.json', all);
      return all[idx];
    },
    delete: (id: string) => {
      const all = readJson<Record<string, unknown>>('environments.json');
      const filtered = all.filter((e) => e['id'] !== id);
      writeJson('environments.json', filtered);
      return filtered.length < all.length;
    },
  },
  secrets: {
    findAll: () => readJson<Record<string, unknown>>('secrets.json'),
    findById: (id: string) => readJson<Record<string, unknown>>('secrets.json').find((s) => s['id'] === id),
    create: (item: Record<string, unknown>) => {
      const all = readJson<Record<string, unknown>>('secrets.json');
      all.push(item);
      writeJson('secrets.json', all);
      return item;
    },
    delete: (id: string) => {
      const all = readJson<Record<string, unknown>>('secrets.json');
      const filtered = all.filter((s) => s['id'] !== id);
      writeJson('secrets.json', filtered);
      return filtered.length < all.length;
    },
  },
};
