import BaseAgent from '../../app/agents/BaseAgent.js';

describe('BaseAgent', () => {
  let agent;

  beforeEach(() => {
    agent = new BaseAgent('TestAgent', 'A test agent for unit testing');
  });

  describe('constructor', () => {
    it('should create agent with name and description', () => {
      expect(agent.name).toBe('TestAgent');
      expect(agent.description).toBe('A test agent for unit testing');
    });
  });

  describe('analyze()', () => {
    it('should throw error if analyze() not implemented', async () => {
      await expect(agent.analyze({}, {})).rejects.toThrow('analyze() must be implemented by TestAgent');
    });
  });

  describe('validateFinding()', () => {
    it('should validate finding with required fields', () => {
      const validFinding = {
        file: 'test.js',
        severity: 'major',
        category: 'test',
        message: 'Test message'
      };

      expect(agent.validateFinding(validFinding)).toBe(true);
    });

    it('should reject finding missing file', () => {
      const invalidFinding = {
        severity: 'major',
        category: 'test',
        message: 'Test message'
      };

      expect(() => agent.validateFinding(invalidFinding)).toThrow('Finding missing required field: file');
    });

    it('should reject finding missing severity', () => {
      const invalidFinding = {
        file: 'test.js',
        category: 'test',
        message: 'Test message'
      };

      expect(() => agent.validateFinding(invalidFinding)).toThrow('Finding missing required field: severity');
    });

    it('should reject finding with invalid severity', () => {
      const invalidFinding = {
        file: 'test.js',
        severity: 'unknown',
        category: 'test',
        message: 'Test message'
      };

      expect(() => agent.validateFinding(invalidFinding)).toThrow('Invalid severity: unknown. Must be one of: critical, major, minor');
    });

    it('should accept valid severities: critical, major, minor', () => {
      const severities = ['critical', 'major', 'minor'];

      severities.forEach(severity => {
        const finding = {
          file: 'test.js',
          severity,
          category: 'test',
          message: 'Test message'
        };

        expect(agent.validateFinding(finding)).toBe(true);
      });
    });
  });

  describe('formatOutput()', () => {
    it('should format output with agent name and findings', () => {
      const findings = [
        {
          file: 'test.js',
          severity: 'major',
          category: 'test',
          message: 'Test message'
        }
      ];

      const output = agent.formatOutput(findings);

      expect(output.agent).toBe('TestAgent');
      expect(output.findings).toEqual(findings);
    });

    it('should include timestamp in output', () => {
      const findings = [];
      const beforeTime = Date.now();

      const output = agent.formatOutput(findings);

      const afterTime = Date.now();
      expect(output.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(output.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should validate all findings before formatting', () => {
      const findings = [
        {
          file: 'test1.js',
          severity: 'major',
          category: 'test',
          message: 'Valid finding'
        },
        {
          file: 'test2.js',
          severity: 'invalid',
          category: 'test',
          message: 'Invalid finding'
        }
      ];

      expect(() => agent.formatOutput(findings)).toThrow('Invalid severity: invalid');
    });

    it('should include metrics in output', () => {
      const findings = [];
      const metrics = {
        coverage: 85,
        tests: 10
      };

      const output = agent.formatOutput(findings, metrics);

      expect(output.metrics).toEqual(metrics);
    });
  });
});