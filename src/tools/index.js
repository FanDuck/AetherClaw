/**
 * AetherClaw (灵爪) - Cross-Platform Tool Registry (OpenClaw + Hermes Toolset)
 * 提供跨平台终端执行、文件读写、目录扫描、网页抓取、长期记忆存取与技能自我进化工具。
 */

const fs = require('fs');
const path = require('path');
const platform = require('../core/platform');
const memory = require('../core/memory');
const config = require('../core/config');

const TOOLS = {
  system_info: {
    name: 'system_info',
    description: 'Get current operating system (Windows/Linux), CPU, RAM, hostname, and shell environment details.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    async execute() {
      return platform.getSystemSummary();
    }
  },

  shell_exec: {
    name: 'shell_exec',
    description: 'Execute a shell command on the host system (PowerShell on Windows, Bash on Linux) with safety guardrails.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute (e.g., Get-ChildItem on Windows or ls -la on Linux).'
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory.'
        }
      },
      required: ['command']
    },
    async execute({ command, cwd }) {
      const cfg = config.get();
      if (!cfg.allowShellExec) {
        return { error: 'Shell execution is currently disabled in AetherClaw settings.' };
      }
      return await platform.executeCommand(command, {
        cwd: cwd || process.cwd(),
        timeoutMs: cfg.shellTimeoutMs || 15000
      });
    }
  },

  file_list: {
    name: 'file_list',
    description: 'List files and directories inside a given folder path (works identically on Windows and Linux).',
    parameters: {
      type: 'object',
      properties: {
        dirPath: {
          type: 'string',
          description: 'Target directory path (defaults to current working directory ".").'
        }
      },
      required: []
    },
    async execute({ dirPath = '.' }) {
      const target = path.resolve(process.cwd(), dirPath || '.');
      if (!fs.existsSync(target)) {
        return { error: `Directory not found: ${target}` };
      }
      const entries = fs.readdirSync(target, { withFileTypes: true });
      const items = entries.slice(0, 100).map(entry => {
        const full = path.join(target, entry.name);
        let size = 0;
        try {
          if (entry.isFile()) size = fs.statSync(full).size;
        } catch (e) {}
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          sizeBytes: size
        };
      });
      return {
        directory: target,
        totalCount: entries.length,
        items
      };
    }
  },

  file_read: {
    name: 'file_read',
    description: 'Read UTF-8 text content from a local file on Windows or Linux.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file to read.'
        },
        maxChars: {
          type: 'number',
          description: 'Maximum characters to return (default 6000).'
        }
      },
      required: ['filePath']
    },
    async execute({ filePath, maxChars = 6000 }) {
      const target = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(target)) {
        return { error: `File does not exist: ${target}` };
      }
      const content = fs.readFileSync(target, 'utf8');
      return {
        filePath: target,
        length: content.length,
        truncated: content.length > maxChars,
        content: content.slice(0, maxChars)
      };
    }
  },

  file_write: {
    name: 'file_write',
    description: 'Create or overwrite a local text file on Windows or Linux.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Relative or absolute path of the file to write.'
        },
        content: {
          type: 'string',
          description: 'Full text content to write into the file.'
        }
      },
      required: ['filePath', 'content']
    },
    async execute({ filePath, content }) {
      const target = path.resolve(process.cwd(), filePath);
      const parent = path.dirname(target);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
      fs.writeFileSync(target, String(content ?? ''), 'utf8');
      return {
        success: true,
        filePath: target,
        bytesWritten: Buffer.byteLength(String(content ?? ''), 'utf8')
      };
    }
  },

  web_fetch: {
    name: 'web_fetch',
    description: 'Fetch webpage content or JSON API response from an HTTP/HTTPS URL.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The HTTP/HTTPS URL to fetch.'
        }
      },
      required: ['url']
    },
    async execute({ url }) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'AetherClaw-Agent/1.0' }
        });
        clearTimeout(timer);
        const rawText = await res.text();
        // Strip heavy HTML tags for cleaner LLM reading
        const cleanText = rawText
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 5000);
        return {
          url,
          status: res.status,
          preview: cleanText
        };
      } catch (err) {
        return { error: `Failed to fetch ${url}: ${err.message}` };
      }
    }
  },

  memory_store: {
    name: 'memory_store',
    description: 'Store an important fact, user preference, or environment insight into Hermes long-term semantic memory.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The fact, preference, or experience to remember long-term.'
        },
        category: {
          type: 'string',
          description: 'Category label such as user_preference, system_fact, or solution.'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords for retrieving this memory later.'
        }
      },
      required: ['content']
    },
    async execute({ content, category = 'knowledge', tags = [] }) {
      const saved = memory.addMemory({ content, category, tags });
      return { success: true, memory: saved };
    }
  },

  memory_recall: {
    name: 'memory_recall',
    description: 'Search Hermes long-term semantic memory for relevant past knowledge or user preferences.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keywords.'
        }
      },
      required: ['query']
    },
    async execute({ query }) {
      return {
        query,
        matches: memory.searchMemories(query, 8)
      };
    }
  },

  skill_create: {
    name: 'skill_create',
    description: 'Self-evolve by saving a reusable workflow or task solution as a persistent Skill (JSON + SKILL.md).',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Unique identifier in snake_case (e.g. log_cleaner).'
        },
        name: {
          type: 'string',
          description: 'Human-readable skill title.'
        },
        description: {
          type: 'string',
          description: 'What this skill accomplishes and when to use it.'
        },
        triggerKeywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords that trigger this skill.'
        },
        steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Step-by-step execution instructions.'
        },
        win32Command: {
          type: 'string',
          description: 'Recommended PowerShell command template for Windows.'
        },
        linuxCommand: {
          type: 'string',
          description: 'Recommended Bash command template for Linux.'
        }
      },
      required: ['id', 'name', 'description', 'steps']
    },
    async execute({ id, name, description, triggerKeywords = [], steps = [], win32Command = '', linuxCommand = '' }) {
      const created = memory.createOrUpdateSkill({
        id,
        name,
        description,
        triggerKeywords,
        steps,
        commandTemplate: {
          win32: win32Command,
          linux: linuxCommand
        }
      });
      return {
        success: true,
        message: `Skill "${created.name}" (${created.id}) saved to skills/${created.id}.json & skills/${created.id}.md`,
        skill: created
      };
    }
  }
};

function getToolSpecsForLLM() {
  return Object.values(TOOLS).map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));
}

async function runTool(name, args = {}) {
  const tool = TOOLS[name];
  if (!tool) {
    return { error: `Unknown tool: ${name}` };
  }
  try {
    return await tool.execute(args || {});
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

module.exports = {
  TOOLS,
  getToolSpecsForLLM,
  runTool
};
