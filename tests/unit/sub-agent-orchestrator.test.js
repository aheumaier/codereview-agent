import SubAgentOrchestrator from '../../app/agents/SubAgentOrchestrator.js';
import ReviewState from '../../app/state/ReviewState.js';
import fs from 'fs/promises';

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn()
    }
  }));
});

// Mock fs for agent definition files
jest.mock('fs/promises');

describe('SubAgentOrchestrator', () => {
  let orchestrator;
  let mockState;

  beforeEach(() => {
    // Create orchestrator without config for backwards compatibility with existing tests
    orchestrator = new SubAgentOrchestrator();
    mockState = new ReviewState('PR-123', 'gitlab', 'org/repo');
    mockState.context = {
      diff: {
        files: [
          {
            new_path: 'src/app.js',
            diff: '@@ -1 +1 @@\n-old\n+new'
          }
        ],
        additions: 1,
        deletions: 1
      },
      stats: {
        filesChanged: 1,
        additions: 1,
        deletions: 1
      }
    };
  });

  describe('executeParallelAnalysis', () => {
    beforeEach(() => {
      // Mock console methods to avoid cluttering test output
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should execute all 4 agents + validator (5 total)', async () => {
      const mockResponse = {
        findings: [
          {
            file: 'test.js',
            severity: 'major',
            category: 'test',
            message: 'Test finding'
          }
        ],
        metrics: {}
      };

      const validatorResponse = {
        findings: [
          {
            file: 'test.js',
            line: 10,
            severity: 'major',
            category: 'testing',
            message: 'Missing test coverage',
            confidence: 0.9
          }
        ],
        validationStats: {
          totalInputFindings: 4,
          duplicatesRemoved: 2,
          lowConfidenceFiltered: 1,
          falsePositivesRemoved: 0,
          finalCount: 1
        }
      };

      // Mock invokeAgent to return successful responses
      orchestrator.invokeAgent = jest.fn()
        .mockImplementation((agent) => {
          if (agent === 'validator') {
            return Promise.resolve(JSON.stringify(validatorResponse));
          }
          return Promise.resolve(JSON.stringify(mockResponse));
        });

      await orchestrator.executeParallelAnalysis(mockState, {});

      // Should have been called 5 times (4 analyzers + 1 validator)
      expect(orchestrator.invokeAgent).toHaveBeenCalledTimes(5);
      expect(orchestrator.invokeAgent).toHaveBeenCalledWith('test-analyzer', expect.any(String));
      expect(orchestrator.invokeAgent).toHaveBeenCalledWith('security-analyzer', expect.any(String));
      expect(orchestrator.invokeAgent).toHaveBeenCalledWith('performance-analyzer', expect.any(String));
      expect(orchestrator.invokeAgent).toHaveBeenCalledWith('architecture-analyzer', expect.any(String));
      expect(orchestrator.invokeAgent).toHaveBeenCalledWith('validator', expect.any(String));
    });

    it('should store validated findings in state.findings array', async () => {
      const validatedFindings = [
        {
          file: 'test.spec.js',
          line: 42,
          severity: 'major',
          category: 'testing',
          message: 'Missing test coverage',
          confidence: 0.9
        }
      ];

      const validatorResponse = {
        findings: validatedFindings,
        validationStats: {
          totalInputFindings: 10,
          duplicatesRemoved: 5,
          finalCount: 1
        }
      };

      orchestrator.invokeAgent = jest.fn()
        .mockImplementation((agent) => {
          if (agent === 'validator') {
            return Promise.resolve(JSON.stringify(validatorResponse));
          }
          return Promise.resolve(JSON.stringify({ findings: [] }));
        });

      await orchestrator.executeParallelAnalysis(mockState, {});

      expect(mockState.findings).toEqual(validatedFindings);
      expect(mockState.validationStats).toEqual(validatorResponse.validationStats);
    });

    it('should deduplicate findings via validator', async () => {
      const testFindings = [
        { file: 'app.js', line: 10, severity: 'major', message: 'Missing test' }
      ];
      const securityFindings = [
        { file: 'app.js', line: 10, severity: 'critical', message: 'Missing validation' }
      ];

      // Validator consolidates duplicate (same file + line) into one
      const validatorResponse = {
        findings: [
          {
            file: 'app.js',
            line: 10,
            severity: 'critical', // Keeps highest severity
            category: 'security',
            message: 'Missing input validation (also lacks test coverage)',
            sources: ['security-analyzer', 'test-analyzer'],
            confidence: 1.0
          }
        ],
        validationStats: {
          totalInputFindings: 2,
          duplicatesRemoved: 1,
          finalCount: 1
        }
      };

      orchestrator.invokeAgent = jest.fn()
        .mockImplementation((agent) => {
          if (agent === 'test-analyzer') {
            return Promise.resolve(JSON.stringify({ findings: testFindings }));
          }
          if (agent === 'security-analyzer') {
            return Promise.resolve(JSON.stringify({ findings: securityFindings }));
          }
          if (agent === 'validator') {
            return Promise.resolve(JSON.stringify(validatorResponse));
          }
          return Promise.resolve(JSON.stringify({ findings: [] }));
        });

      await orchestrator.executeParallelAnalysis(mockState, {});

      expect(mockState.findings).toHaveLength(1);
      expect(mockState.validationStats.duplicatesRemoved).toBe(1);
    });

    it('should handle validator failure with fallback to raw findings', async () => {
      const testFindings = [
        { file: 'test.js', severity: 'major', message: 'Test issue' }
      ];
      const securityFindings = [
        { file: 'auth.js', severity: 'critical', message: 'Security issue' }
      ];

      orchestrator.invokeAgent = jest.fn()
        .mockImplementation((agent) => {
          if (agent === 'test-analyzer') {
            return Promise.resolve(JSON.stringify({ findings: testFindings }));
          }
          if (agent === 'security-analyzer') {
            return Promise.resolve(JSON.stringify({ findings: securityFindings }));
          }
          if (agent === 'validator') {
            return Promise.reject(new Error('Validator failed'));
          }
          return Promise.resolve(JSON.stringify({ findings: [] }));
        });

      await orchestrator.executeParallelAnalysis(mockState, {});

      // Should fallback to raw findings without validation
      expect(mockState.findings.length).toBe(2);
      expect(mockState.validationStats.duplicatesRemoved).toBe(0);
      expect(mockState.validationStats.finalCount).toBe(2);
    });

    it('should add errors to state when agent fails', async () => {
      const error = new Error('Agent crashed');

      orchestrator.invokeAgent = jest.fn()
        .mockImplementation((agent) => {
          if (agent === 'security-analyzer') {
            return Promise.reject(error);
          }
          return Promise.resolve(JSON.stringify({ findings: [] }));
        });

      // Mock addError method
      mockState.addError = jest.fn();

      await orchestrator.executeParallelAnalysis(mockState, {});

      expect(mockState.addError).toHaveBeenCalledWith('parallel_analysis', error);
    });

    it('should continue with other agents if one fails', async () => {
      let callCount = 0;

      orchestrator.invokeAgent = jest.fn()
        .mockImplementation((agent) => {
          callCount++;
          if (agent === 'test-analyzer') {
            return Promise.reject(new Error('Failed'));
          }
          if (agent === 'validator') {
            return Promise.resolve(JSON.stringify({
              findings: [],
              validationStats: { totalInputFindings: 0, finalCount: 0 }
            }));
          }
          return Promise.resolve(JSON.stringify({ findings: [] }));
        });

      await orchestrator.executeParallelAnalysis(mockState, {});

      // All 4 agents + validator should have been invoked despite one analyzer failing
      expect(callCount).toBe(5);
    });

    it('should transition state to synthesis after completion', async () => {
      orchestrator.invokeAgent = jest.fn()
        .mockResolvedValue(JSON.stringify({ findings: [] }));

      mockState.transitionTo = jest.fn();

      await orchestrator.executeParallelAnalysis(mockState, {});

      expect(mockState.transitionTo).toHaveBeenCalledWith('synthesis');
    });
  });

  describe('buildAgentPrompt', () => {
    it('should build prompt with diff content', () => {
      const prompt = orchestrator.buildAgentPrompt(mockState, 'test-analyzer');

      expect(prompt).toContain('## Changed Files');
      expect(prompt).toContain('src/app.js');
      expect(prompt).toContain('@@ -1 +1 @@\n-old\n+new');
    });

    it('should build prompt with stats', () => {
      const prompt = orchestrator.buildAgentPrompt(mockState, 'test-analyzer');

      expect(prompt).toContain('## Statistics');
      expect(prompt).toContain('Files changed: 1');
      expect(prompt).toContain('Additions: +1');
      expect(prompt).toContain('Deletions: -1');
    });

    it('should reference agent-specific definition', () => {
      const prompt = orchestrator.buildAgentPrompt(mockState, 'security-analyzer');

      expect(prompt).toContain('.claude/agents/security-analyzer.md');
    });
  });

  describe('parseFindings', () => {
    it('should parse JSON response from agent', () => {
      const response = JSON.stringify({
        findings: [
          { file: 'test.js', severity: 'major', category: 'test', message: 'Issue' }
        ],
        metrics: { coverage: 80 }
      });

      const parsed = orchestrator.parseFindings(response);

      expect(parsed.findings).toHaveLength(1);
      expect(parsed.findings[0].file).toBe('test.js');
      expect(parsed.metrics.coverage).toBe(80);
    });

    it('should handle malformed JSON gracefully', () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const response = 'Not valid JSON {';

      const parsed = orchestrator.parseFindings(response);

      expect(parsed.findings).toEqual([]);
      expect(parsed.metrics).toEqual({});
    });

    it('should extract JSON from markdown code blocks', () => {
      const response = `Here are the findings:
\`\`\`json
{
  "findings": [
    { "file": "test.js", "severity": "major", "category": "test", "message": "Issue" }
  ],
  "metrics": { "coverage": 80 }
}
\`\`\``;

      const parsed = orchestrator.parseFindings(response);

      expect(parsed.findings).toHaveLength(1);
      expect(parsed.findings[0].file).toBe('test.js');
      expect(parsed.metrics.coverage).toBe(80);
    });

    it('should handle object input directly', () => {
      const response = {
        findings: [
          { file: 'test.js', severity: 'minor', category: 'test', message: 'Issue' }
        ]
      };

      const parsed = orchestrator.parseFindings(response);

      expect(parsed).toEqual(response);
    });
  });

  describe('invokeAgent (production)', () => {
    let mockAnthropicClient;
    let mockConfig;

    beforeEach(() => {
      // Set up Anthropic client mock
      const Anthropic = require('@anthropic-ai/sdk');
      mockAnthropicClient = {
        messages: {
          create: jest.fn()
        }
      };
      Anthropic.mockReturnValue(mockAnthropicClient);

      // Set up config with API key
      mockConfig = {
        claude: {
          apiKey: 'test-api-key',
          maxTokens: 4096
        }
      };

      // Create orchestrator with config
      orchestrator = new SubAgentOrchestrator(mockConfig);

      // Mock file system to return agent definition
      fs.readFile = jest.fn().mockResolvedValue(`---
description: Test analyzer agent
model: sonnet
---

You are a test analysis specialist. Analyze code for test coverage.

## Output Format
Return findings as JSON with findings array and metrics object.`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should invoke agent using Claude API in production', async () => {
      const agentName = 'test-analyzer';
      const prompt = 'Analyze this code diff...';
      const expectedResponse = JSON.stringify({
        findings: [
          { file: 'test.js', severity: 'major', category: 'test', message: 'Missing test' }
        ],
        metrics: { coverage: 75 }
      });

      // Mock Anthropic API response
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{ text: expectedResponse }]
      });

      // Call invokeAgent
      const result = await orchestrator.invokeAgent(agentName, prompt);

      // Verify Anthropic client was called correctly
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        system: expect.stringContaining('You are a test analysis specialist')
      });

      // Verify it returns the response text
      expect(result).toBe(expectedResponse);
    });

    it('should handle API errors with retry', async () => {
      const agentName = 'test-analyzer';
      const prompt = 'Analyze this code...';

      // First call fails with retryable error, second succeeds
      mockAnthropicClient.messages.create
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce({
          content: [{ text: '{"findings": []}' }]
        });

      const result = await orchestrator.invokeAgent(agentName, prompt);

      // Should have retried
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledTimes(2);
      expect(result).toBe('{"findings": []}');
    });

    it('should load agent definition from file system', async () => {
      const agentName = 'security-analyzer';
      const prompt = 'Check security...';

      fs.readFile.mockResolvedValue(`---
description: Security analyzer
---
You are a security expert.`);

      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{ text: '{"findings": []}' }]
      });

      await orchestrator.invokeAgent(agentName, prompt);

      // Verify correct file was loaded
      expect(fs.readFile).toHaveBeenCalledWith(
        '.claude/agents/security-analyzer.md',
        'utf-8'
      );

      // Verify system prompt includes agent definition
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('You are a security expert')
        })
      );
    });
  });
});