import Anthropic from '@anthropic-ai/sdk';
import { retryWithBackoff, isRetryableError } from '../utils/retry.js';
import fs from 'fs/promises';

/**
 * Orchestrates parallel execution of sub-agents
 * Uses Claude API for agent invocation in production
 */
export default class SubAgentOrchestrator {
  /**
   * Constructor
   * @param {Object} config - Configuration with Claude API settings
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Execute all sub-agents in parallel
   * @param {ReviewState} state - Review state
   * @param {Object} config - Configuration
   * @returns {Promise<ReviewState>} Updated state
   */
  async executeParallelAnalysis(state, config) {
    console.log('  🔄 Executing sub-agents in parallel...');

    const agentTasks = [
      { agent: 'test-analyzer', category: 'test' },
      { agent: 'security-analyzer', category: 'security' },
      { agent: 'performance-analyzer', category: 'performance' },
      { agent: 'architecture-analyzer', category: 'architecture' }
    ];

    // Build prompts for each agent
    const prompts = agentTasks.map(task => ({
      agent: task.agent,
      category: task.category,
      prompt: this.buildAgentPrompt(state, task.agent)
    }));

    // Execute in parallel with error boundaries
    const results = await Promise.allSettled(
      prompts.map(p => this.invokeAgent(p.agent, p.prompt))
    );

    // Process results
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const task = agentTasks[i];

      if (result.status === 'fulfilled') {
        const findings = this.parseFindings(result.value);
        state.findings[task.category] = findings.findings || [];

        console.log(`    ✓ ${task.agent}: ${findings.findings?.length || 0} findings`);
      } else {
        console.error(`    ✗ ${task.agent} failed: ${result.reason.message}`);
        state.addError('parallel_analysis', result.reason);
      }
    }

    // Transition to synthesis phase
    state.transitionTo('synthesis');
    return state;
  }

  /**
   * Invoke a specific sub-agent using Claude API
   * @param {string} agentName - Name of the agent
   * @param {string} prompt - Prompt for the agent
   * @returns {Promise<string>} Agent response
   */
  async invokeAgent(agentName, prompt) {
    // Load agent definition for system prompt
    const agentPath = `.claude/agents/${agentName}.md`;
    const agentDefinition = await fs.readFile(agentPath, 'utf-8');

    // Extract system prompt from agent definition (skip YAML frontmatter)
    const systemPrompt = agentDefinition.split('---').slice(2).join('---').trim();

    // Initialize Anthropic client with API key
    const anthropic = new Anthropic({
      apiKey: this.config?.claude?.apiKey || process.env.ANTHROPIC_API_KEY
    });

    // Use retryWithBackoff for resilience
    const response = await retryWithBackoff(
      async () => {
        return await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: this.config?.claude?.maxTokens || 4096,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          system: systemPrompt
        });
      },
      {
        maxRetries: 3,
        shouldRetry: isRetryableError
      }
    );

    // Extract text from response
    return response.content[0].text;
  }

  /**
   * Build prompt for specific agent
   * @param {ReviewState} state - Review state
   * @param {string} agentName - Agent name
   * @returns {string} Prompt text
   */
  buildAgentPrompt(state, agentName) {
    const context = state.context;

    let prompt = `Analyze the following code changes:\n\n`;

    // Include diff
    if (context.diff && context.diff.files) {
      prompt += `## Changed Files\n\n`;
      for (const file of context.diff.files) {
        prompt += `### ${file.new_path || file.path}\n`;
        prompt += `\`\`\`diff\n${file.diff || 'No diff available'}\n\`\`\`\n\n`;
      }
    }

    // Include stats
    if (context.stats) {
      prompt += `## Statistics\n`;
      prompt += `- Files changed: ${context.stats.filesChanged || 0}\n`;
      prompt += `- Additions: +${context.diff?.additions || 0}\n`;
      prompt += `- Deletions: -${context.diff?.deletions || 0}\n\n`;
    }

    prompt += `Provide findings in the specified JSON format as defined in .claude/agents/${agentName}.md`;

    return prompt;
  }

  /**
   * Parse findings from agent response
   * @param {string|Object} response - Agent response
   * @returns {Object} Parsed findings
   */
  parseFindings(response) {
    try {
      // Handle case where response might contain markdown code blocks
      let jsonString = response;
      if (typeof response === 'string') {
        // Extract JSON from markdown code block if present
        const jsonMatch = response.match(/```json\n?([\s\S]*?)```/);
        if (jsonMatch) {
          jsonString = jsonMatch[1];
        }
      }
      const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
      return parsed;
    } catch (error) {
      console.error('Failed to parse agent response:', error.message);
      // Log first 50 chars for debugging
      if (typeof response === 'string') {
        console.error('Response preview:', response.substring(0, 50) + '...');
      }
      return { findings: [], metrics: {} };
    }
  }
}