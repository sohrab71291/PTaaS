import React, { useState } from 'react';
import { Copy, Check, Github, GitBranch, Layers, Cloud, Key, Plus, Trash2 } from 'lucide-react';
import { CodePanel } from '../components/CodePanel';

const API_BASE = 'http://localhost:3001';

const integrations = [
  {
    id: 'github-actions',
    name: 'GitHub Actions',
    icon: Github,
    color: 'bg-gray-900',
    description: 'Trigger performance tests in your GitHub Actions workflows',
    yaml: `name: Performance Tests

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      spec_id:
        description: 'Test Spec ID'
        required: false
        default: 'spec-001'

jobs:
  perf-test:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger PerfOps Test
        run: |
          curl -X POST ${API_BASE}/api/executions \\
            -H "Content-Type: application/json" \\
            -H "Authorization: Bearer \${{ secrets.PERFOPS_TOKEN }}" \\
            -d '{"specId": "\${{ github.event.inputs.spec_id || 'spec-001' }}"}'

      - name: Wait for results
        run: |
          # Poll for completion
          for i in {1..30}; do
            STATUS=$(curl -s ${API_BASE}/api/executions/\$EXEC_ID | jq -r '.status')
            if [ "\$STATUS" = "pass" ] || [ "\$STATUS" = "fail" ]; then
              echo "Test completed with status: \$STATUS"
              [ "\$STATUS" = "pass" ] && exit 0 || exit 1
            fi
            sleep 10
          done
`,
    cli: `perfops run --spec spec-001 --env QA --wait --token $PERFOPS_TOKEN`,
  },
  {
    id: 'jenkins',
    name: 'Jenkins',
    icon: Layers,
    color: 'bg-red-700',
    description: 'Integrate with Jenkins pipelines using the PerfOps CLI',
    yaml: `pipeline {
  agent any

  environment {
    PERFOPS_TOKEN = credentials('perfops-api-token')
  }

  stages {
    stage('Performance Tests') {
      steps {
        script {
          def response = httpRequest(
            httpMode: 'POST',
            url: '${API_BASE}/api/executions',
            customHeaders: [[name: 'Authorization', value: "Bearer \${PERFOPS_TOKEN}"]],
            requestBody: '{"specId": "spec-001", "environment": "QA"}',
            contentType: 'APPLICATION_JSON'
          )
          def result = readJSON text: response.content
          echo "Execution ID: \${result.id}"
          currentBuild.description = "PerfOps: \${result.id}"
        }
      }
    }
  }

  post {
    failure {
      echo 'Performance tests failed!'
    }
  }
}`,
    cli: `perfops run --spec spec-001 --env QA --format junit --output results.xml`,
  },
  {
    id: 'gitlab-ci',
    name: 'GitLab CI',
    icon: GitBranch,
    color: 'bg-orange-600',
    description: 'Add performance testing stages to your GitLab CI/CD pipelines',
    yaml: `stages:
  - test
  - performance

performance-test:
  stage: performance
  image: curlimages/curl:latest
  variables:
    SPEC_ID: "spec-001"
  script:
    - |
      EXEC_ID=$(curl -sX POST ${API_BASE}/api/executions \\
        -H "Content-Type: application/json" \\
        -H "Authorization: Bearer \${PERFOPS_TOKEN}" \\
        -d "{\\"specId\\": \\"\${SPEC_ID}\\"}" | jq -r '.id')
      echo "Execution ID: \$EXEC_ID"
  artifacts:
    reports:
      performance: perf-report.json
  only:
    - main
    - merge_requests`,
    cli: `perfops run --spec spec-001 --env QA --format gitlab-performance`,
  },
  {
    id: 'azure-devops',
    name: 'Azure DevOps',
    icon: Cloud,
    color: 'bg-blue-700',
    description: 'Integrate performance tests into Azure Pipelines',
    yaml: `trigger:
  branches:
    include:
      - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: Bash@3
    displayName: 'Run Performance Tests'
    inputs:
      targetType: 'inline'
      script: |
        EXEC=$(curl -sX POST ${API_BASE}/api/executions \\
          -H "Content-Type: application/json" \\
          -H "Authorization: Bearer \$(PERFOPS_TOKEN)" \\
          -d '{"specId": "spec-001", "environment": "QA"}')
        echo "##vso[task.setvariable variable=EXEC_ID]\$(echo \$EXEC | jq -r '.id')"

  - task: PublishTestResults@2
    inputs:
      testResultsFormat: 'JUnit'
      testResultsFiles: 'perf-results.xml'`,
    cli: `perfops run --spec spec-001 --env QA --format azuredevops`,
  },
];

interface ApiToken {
  id: string;
  name: string;
  createdAt: string;
  lastUsed: string | null;
}

const MOCK_TOKENS: ApiToken[] = [
  { id: 'tok-001', name: 'CI Pipeline Token', createdAt: '2026-01-15', lastUsed: '2026-06-01' },
  { id: 'tok-002', name: 'Local Dev Token', createdAt: '2026-02-01', lastUsed: '2026-05-28' },
];

export const Pipelines: React.FC = () => {
  const [selectedIntegration, setSelectedIntegration] = useState(integrations[0].id);
  const [copiedCli, setCopiedCli] = useState<string | null>(null);
  const [tokens, setTokens] = useState<ApiToken[]>(MOCK_TOKENS);
  const [newTokenName, setNewTokenName] = useState('');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);

  const current = integrations.find(i => i.id === selectedIntegration)!;

  const copyCli = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCli(id);
    setTimeout(() => setCopiedCli(null), 2000);
  };

  const generateToken = () => {
    if (!newTokenName.trim()) return;
    const token = `ptk_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    setGeneratedToken(token);
    setTokens(prev => [...prev, {
      id: `tok-${Date.now()}`,
      name: newTokenName,
      createdAt: new Date().toISOString().split('T')[0],
      lastUsed: null,
    }]);
    setNewTokenName('');
  };

  const revokeToken = (id: string) => {
    setTokens(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">CI/CD Pipelines</h1>
        <p className="text-gray-500 text-sm mt-0.5">Integrate performance testing into your CI/CD workflows</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        {integrations.map(integration => {
          const Icon = integration.icon;
          return (
            <button
              key={integration.id}
              onClick={() => setSelectedIntegration(integration.id)}
              className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                selectedIntegration === integration.id
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`w-9 h-9 rounded-lg ${integration.color} flex items-center justify-center flex-shrink-0`}>
                <Icon size={18} className="text-white" />
              </div>
              <div>
                <div className="font-medium text-sm text-gray-900">{integration.name}</div>
                <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{integration.description}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Integration Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">{current.name} Pipeline YAML</h3>
          </div>
          <CodePanel
            language="yaml"
            code={current.yaml}
            filename={`${current.id}.yml`}
            maxHeight="400px"
          />
        </div>

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <h3 className="font-semibold text-gray-800 mb-4">CLI Command</h3>
          <div className="relative bg-gray-900 rounded-lg p-4 font-mono text-sm text-green-400">
            <pre className="whitespace-pre-wrap break-all">{current.cli}</pre>
            <button
              onClick={() => copyCli(current.id, current.cli)}
              className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-white bg-gray-800 rounded"
            >
              {copiedCli === current.id ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            </button>
          </div>

          <div className="mt-6">
            <h4 className="font-medium text-gray-700 mb-3 text-sm">Quick Setup</h4>
            <div className="space-y-3 text-sm text-gray-600">
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 bg-brand-500 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
                <span>Install the PerfOps CLI: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">npm install -g @perfops/cli</code></span>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 bg-brand-500 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
                <span>Generate an API token in the section below</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 bg-brand-500 text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
                <span>Add <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">PERFOPS_TOKEN</code> as a secret in your CI system</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 bg-brand-500 text-white rounded-full flex items-center justify-center text-xs font-bold">4</span>
                <span>Copy the YAML snippet and add it to your pipeline</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* API Token Management */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Key size={16} className="text-gray-500" />
          <h3 className="font-semibold text-gray-800">API Token Management</h3>
        </div>

        {generatedToken && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-sm font-medium text-green-800 mb-1">Token generated — copy it now, it won't be shown again!</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs text-green-900 bg-green-100 px-3 py-2 rounded break-all">
                {generatedToken}
              </code>
              <button
                onClick={() => { navigator.clipboard.writeText(generatedToken); }}
                className="p-2 text-green-600 hover:text-green-800"
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-4">
          <input
            type="text"
            value={newTokenName}
            onChange={e => setNewTokenName(e.target.value)}
            placeholder="Token name (e.g. CI Pipeline)"
            className="flex-1 max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            onKeyDown={e => e.key === 'Enter' && generateToken()}
          />
          <button
            onClick={generateToken}
            disabled={!newTokenName.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
          >
            <Plus size={14} /> Generate Token
          </button>
        </div>

        <table className="w-full text-sm">
          <thead className="border-b border-gray-200">
            <tr>
              <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase">Created</th>
              <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase">Last Used</th>
              <th className="text-right pb-2 text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map(token => (
              <tr key={token.id} className="border-b border-gray-50">
                <td className="py-2.5 font-medium text-gray-800">{token.name}</td>
                <td className="py-2.5 text-gray-500">{token.createdAt}</td>
                <td className="py-2.5 text-gray-500">{token.lastUsed || 'Never'}</td>
                <td className="py-2.5 text-right">
                  <button
                    onClick={() => revokeToken(token.id)}
                    className="flex items-center gap-1 ml-auto text-xs text-red-600 hover:text-red-800 px-2 py-1 border border-red-200 rounded hover:bg-red-50"
                  >
                    <Trash2 size={11} /> Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
