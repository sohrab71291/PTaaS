"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchScriptCredentials = fetchScriptCredentials;
const prisma_1 = __importDefault(require("../lib/prisma"));
// Looks up a previously-uploaded credentials CSV batch (see
// POST /api/executor/credentials) and returns it in the shape injectCredentials()
// expects. Shared by /api/ai-generate and /api/har-generate so the real CSV rows
// get baked into the script at generation time, instead of only at execution time.
async function fetchScriptCredentials(batchId) {
    const rows = await prisma_1.default.executionCredential.findMany({
        where: { batchId: batchId.trim() },
        orderBy: { rowIndex: 'asc' },
    });
    return rows.map(r => ({
        loginUrl: r.loginUrl, username: r.username, password: r.password, instanceName: r.instanceName ?? '',
    }));
}
