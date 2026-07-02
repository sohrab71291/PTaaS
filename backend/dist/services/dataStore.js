"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_DIR = path_1.default.join(__dirname, '../../data');
function readJson(filename) {
    const filepath = path_1.default.join(DATA_DIR, filename);
    try {
        const raw = fs_1.default.readFileSync(filepath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return [];
    }
}
function writeJson(filename, data) {
    const filepath = path_1.default.join(DATA_DIR, filename);
    fs_1.default.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}
exports.db = {
    testSpecs: {
        findAll: () => readJson('test-specs.json'),
        findById: (id) => readJson('test-specs.json').find((s) => s['id'] === id),
        create: (item) => {
            const all = readJson('test-specs.json');
            all.push(item);
            writeJson('test-specs.json', all);
            return item;
        },
        update: (id, updates) => {
            const all = readJson('test-specs.json');
            const idx = all.findIndex((s) => s['id'] === id);
            if (idx === -1)
                return null;
            all[idx] = { ...all[idx], ...updates };
            writeJson('test-specs.json', all);
            return all[idx];
        },
        delete: (id) => {
            const all = readJson('test-specs.json');
            const filtered = all.filter((s) => s['id'] !== id);
            writeJson('test-specs.json', filtered);
            return filtered.length < all.length;
        },
    },
    executions: {
        findAll: () => readJson('executions.json'),
        findById: (id) => readJson('executions.json').find((e) => e['id'] === id),
        findBySpecId: (specId) => readJson('executions.json').filter((e) => e['specId'] === specId),
        create: (item) => {
            const all = readJson('executions.json');
            all.unshift(item);
            writeJson('executions.json', all);
            return item;
        },
        update: (id, updates) => {
            const all = readJson('executions.json');
            const idx = all.findIndex((e) => e['id'] === id);
            if (idx === -1)
                return null;
            all[idx] = { ...all[idx], ...updates };
            writeJson('executions.json', all);
            return all[idx];
        },
    },
    environments: {
        findAll: () => readJson('environments.json'),
        findById: (id) => readJson('environments.json').find((e) => e['id'] === id),
        create: (item) => {
            const all = readJson('environments.json');
            all.push(item);
            writeJson('environments.json', all);
            return item;
        },
        update: (id, updates) => {
            const all = readJson('environments.json');
            const idx = all.findIndex((e) => e['id'] === id);
            if (idx === -1)
                return null;
            all[idx] = { ...all[idx], ...updates };
            writeJson('environments.json', all);
            return all[idx];
        },
        delete: (id) => {
            const all = readJson('environments.json');
            const filtered = all.filter((e) => e['id'] !== id);
            writeJson('environments.json', filtered);
            return filtered.length < all.length;
        },
    },
    secrets: {
        findAll: () => readJson('secrets.json'),
        findById: (id) => readJson('secrets.json').find((s) => s['id'] === id),
        create: (item) => {
            const all = readJson('secrets.json');
            all.push(item);
            writeJson('secrets.json', all);
            return item;
        },
        delete: (id) => {
            const all = readJson('secrets.json');
            const filtered = all.filter((s) => s['id'] !== id);
            writeJson('secrets.json', filtered);
            return filtered.length < all.length;
        },
    },
};
