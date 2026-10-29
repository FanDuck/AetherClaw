/**
 * AetherClaw (灵爪) - Cross-Platform Tool Registry (OpenClaw + Hermes Toolset)
 * 提供跨平台终端执行、文件读写、目录扫描、网页抓取、长期记忆存取与技能自我进化工具。
 */

const fs = require('fs');
const path = require('path');
const platform = require('../core/platform');
const memory = require('../core/memory');
const config = require('../core/config');

const MAX_FILE_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_FETCH_BYTES = 512 * 1024;

/**
 * 敏感文件保护：Agent（尤其是被提示词注入诱导时）不得读写 API 密钥所在的文件。
 * 注意：这只是文件工具层的防线，不是沙箱——shell_exec 仍然拥有当前用户的权限。
 */
function isProtectedPath(target) {
  const base = path.basename(target).toLowerCase();
  return base === '.env' || (base.startsWith('.env.') && base !== '.env.example') || base === 'config.local.json';
}

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
      if (typeof command !== 'string' || !command.trim()) {
        return { error: 'command must be a non-empty string' };
      }
      const workDir = cwd ? path.resolve(process.cwd(), String(cwd)) : process.cwd();
      if (!fs.existsSync(workDir) || !fs.statSync(workDir).isDirectory()) {
        return { error: `Working directory not found: ${workDir}` };
      }
      return await platform.executeCommand(command, {
        cwd: workDir,
        timeoutMs: cfg.shellTimeoutMs || 15000,
        sandboxMode: cfg.sandboxMode || 'host',
        sandboxImage: cfg.sandboxImage || 'alpine:3.20',
        sandboxMemoryMB: cfg.sandboxMemoryMB || 256,
        sandboxNetwork: cfg.sandboxNetwork || 'none',
        allowFileWrite: cfg.allowFileWrite !== false
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
      if (!fs.statSync(target).isDirectory()) {
        return { error: `Not a directory: ${target}` };
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
        truncated: entries.length > items.length,
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
          description: 'Maximum characters to return (default 6000, max 100000).'
        }
      },
      required: ['filePath']
    },
    async execute({ filePath, maxChars = 6000 }) {
      if (typeof filePath !== 'string' || !filePath.trim()) {
        return { error: 'filePath must be a non-empty string' };
      }
      const target = path.resolve(process.cwd(), filePath);
      if (isProtectedPath(target)) {
        return { error: `Access denied: ${path.basename(target)} may contain secrets and is protected.` };
      }
      if (!fs.existsSync(target)) {
        return { error: `File does not exist: ${target}` };
      }
      const stat = fs.statSync(target);
      if (!stat.isFile()) {
        return { error: `Not a regular file: ${target}` };
      }
      const limit = Math.max(1, Math.min(100000, Math.floor(Number(maxChars)) || 6000));
      // 只读取前 limit*4 字节（UTF-8 最长 4 字节/字符），避免把巨型文件整个载入内存
      const bytesToRead = Math.min(stat.size, limit * 4);
      const buf = Buffer.alloc(bytesToRead);
      const fd = fs.openSync(target, 'r');
      try {
        fs.readSync(fd, buf, 0, bytesToRead, 0);
      } finally {
        fs.closeSync(fd);
      }
      if (buf.includes(0)) {
        return { error: `Binary file detected, refusing to read as text: ${target}`, sizeBytes: stat.size };
      }
      const text = buf.toString('utf8');
      return {
        filePath: target,
        sizeBytes: stat.size,
        truncated: stat.size > bytesToRead || text.length > limit,
        content: text.slice(0, limit)
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
      if (!config.get().allowFileWrite) {
        return { error: 'File writing is currently disabled in AetherClaw settings.' };
      }
      if (typeof filePath !== 'string' || !filePath.trim()) {
        return { error: 'filePath must be a non-empty string' };
      }
      const text = String(content ?? '');
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > MAX_FILE_WRITE_BYTES) {
        return { error: `Content too large (${bytes} bytes, max ${MAX_FILE_WRITE_BYTES}).` };
      }
      const target = path.resolve(process.cwd(), filePath);
      if (isProtectedPath(target)) {
        return { error: `Access denied: ${path.basename(target)} is protected.` };
      }
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        return { error: `Target is a directory: ${target}` };
      }
      const parent = path.dirname(target);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
      fs.writeFileSync(target, text, 'utf8');
      return {
        success: true,
        filePath: target,
        bytesWritten: bytes
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
      let parsed;
      try {
        parsed = new URL(String(url));
      } catch (_) {
        return { error: `Invalid URL: ${url}` };
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { error: 'Only http:// and https:// URLs are supported.' };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(parsed, {
          signal: controller.signal,
          headers: { 'User-Agent': 'AetherClaw-Agent/1.1' }
        });
        // 流式读取并限制大小，避免超大响应撑爆内存
        let received = 0;
        const chunks = [];
        let truncated = false;
        if (res.body) {
          for await (const chunk of res.body) {
            received += chunk.length;
            chunks.push(Buffer.from(chunk));
            if (received >= MAX_FETCH_BYTES) { truncated = true; controller.abort(); break; }
          }
        }
        const rawText = Buffer.concat(chunks).toString('utf8');
        // Strip heavy HTML tags for cleaner LLM reading
        const cleanText = rawText
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 5000);
        return {
          url: parsed.href,
          status: res.status,
          truncated,
          preview: cleanText
        };
      } catch (err) {
        return { error: `Failed to fetch ${parsed.href}: ${err.name === 'AbortError' ? 'timeout or size limit reached' : err.message}` };
      } finally {
        clearTimeout(timer);
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
        matches: memory.searchMemories(query, 8, { strict: true })
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

/**
 * 生成给大模型的工具声明。关闭「自动进化」时不暴露 skill_create，
 * 这样配置项 autoEvolveSkills 才真正生效。
 */
function getToolSpecsForLLM({ autoEvolveSkills = true } = {}) {
  return Object.values(TOOLS)
    .filter(t => autoEvolveSkills || t.name !== 'skill_create')
    .map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
}

async function runTool(name, args = {}) {
  if (!Object.prototype.hasOwnProperty.call(TOOLS, name)) {
    return { error: `Unknown tool: ${name}` };
  }
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  try {
    return await TOOLS[name].execute(safeArgs);
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

module.exports = {
  TOOLS,
  getToolSpecsForLLM,
  runTool,
  isProtectedPath
};
