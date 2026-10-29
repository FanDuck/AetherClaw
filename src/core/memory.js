/**
 * AetherClaw (灵爪) - Hermes-Style Hierarchical Memory & Self-Evolving Skill Engine
 * 灵感源自 Hermes Agent 的三层自我进化架构：
 * 1. Episodic Memory (情景记忆): 记录任务交互历史与执行轨迹
 * 2. Semantic Memory (语义记忆): 提炼并长期保存用户偏好、系统环境事实与关键经验
 * 3. Procedural Skills (程序性技能库): 将成功的复杂操作沉淀为可复用的 Skill 插件（JSON + Markdown）
 */

const fs = require('fs');
const path = require('path');

const { DATA_DIR, SKILLS_DIR, ensureDir, atomicWrite } = require('./paths');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

const INITIAL_MEMORIES = [
  {
    id: 'mem_init_1',
    category: 'system',
    content: 'AetherClaw (灵爪) 具备跨平台系统控制能力，在 Windows 下使用 PowerShell，在 Linux 下使用 Bash。',
    tags: ['system', 'platform', 'openclaw'],
    createdAt: new Date().toISOString()
  },
  {
    id: 'mem_init_2',
    category: 'evolution',
    content: '当完成多步骤复杂任务时，AetherClaw 可以调用 skill_create 工具将解决步骤沉淀为可复用的技能（Hermes 自我进化机制）。',
    tags: ['hermes', 'skill', 'evolution'],
    createdAt: new Date().toISOString()
  }
];

const BUILTIN_SKILLS = [
  {
    id: 'sys_health_check',
    name: '跨平台系统健康巡检 (System Health Check)',
    description: '自动检测当前 Windows 或 Linux 系统的 CPU、内存、磁盘空间与运行环境状态，生成诊断报告。',
    triggerKeywords: ['巡检', '健康', '系统状态', '电脑状态', 'health', 'diagnostic', 'status'],
    steps: [
      '调用 system_info 工具获取操作系统、CPU 核心数、内存占用等核心指标',
      '在 Windows 下使用 PowerShell (Get-PSDrive C) 或在 Linux 下使用 (df -h /) 检查磁盘空间',
      '汇总各项指标并向用户输出结构化的健康诊断建议'
    ],
    commandTemplate: {
      win32: 'Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{Name="Used(GB)";Expression={[math]::round($_.Used/1GB,2)}}, @{Name="Free(GB)";Expression={[math]::round($_.Free/1GB,2)}} | Format-Table -AutoSize',
      linux: 'df -h --output=source,size,used,avail,pcent,target -x tmpfs -x devtmpfs'
    },
    version: '1.0.0',
    usageCount: 1,
    createdAt: new Date().toISOString(),
    author: 'AetherClaw Built-in'
  },
  {
    id: 'workspace_organizer',
    name: '项目目录结构分析与整理 (Workspace Analyzer)',
    description: '扫描指定文件夹下的文件结构、统计各类文件数量并生成清晰的目录概览。',
    triggerKeywords: ['整理', '目录', '分析文件夹', '文件列表', 'workspace', 'tree'],
    steps: [
      '调用 file_list 工具列出目标路径下的全部文件与子文件夹',
      '按文件扩展名分类统计数量与大小',
      '生成可视化的 Markdown 结构说明或整理建议'
    ],
    commandTemplate: {
      win32: 'Get-ChildItem -Force | Select-Object Mode, LastWriteTime, Length, Name | Format-Table -AutoSize',
      linux: 'ls -la'
    },
    version: '1.0.0',
    usageCount: 1,
    createdAt: new Date().toISOString(),
    author: 'AetherClaw Built-in'
  }
];

class MemoryAndSkillEngine {
  constructor() {
    this.ensureDirs();
    this.state = this.loadMemoryState();
    this.ensureBuiltinSkills();
  }

  ensureDirs() {
    ensureDir(DATA_DIR);
    ensureDir(SKILLS_DIR);
  }

  loadMemoryState() {
    if (fs.existsSync(MEMORY_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
        return {
          semanticMemories: Array.isArray(parsed.semanticMemories) ? parsed.semanticMemories : INITIAL_MEMORIES,
          episodicHistory: Array.isArray(parsed.episodicHistory) ? parsed.episodicHistory : []
        };
      } catch (e) {
        // Fallback if corrupted
      }
    }
    const initial = {
      semanticMemories: INITIAL_MEMORIES,
      episodicHistory: []
    };
    atomicWrite(MEMORY_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }

  saveMemoryState() {
    this.ensureDirs();
    atomicWrite(MEMORY_FILE, JSON.stringify(this.state, null, 2));
  }

  ensureBuiltinSkills() {
    for (const skill of BUILTIN_SKILLS) {
      const skillPath = path.join(SKILLS_DIR, `${skill.id}.json`);
      if (!fs.existsSync(skillPath)) {
        this.saveSkillToDisk(skill);
      }
    }
  }

  saveSkillToDisk(skill) {
    this.ensureDirs();
    const jsonPath = path.join(SKILLS_DIR, `${skill.id}.json`);
    const mdPath = path.join(SKILLS_DIR, `${skill.id}.md`);
    atomicWrite(jsonPath, JSON.stringify(skill, null, 2));

    // Simultaneously generate a human-readable SKILL.md (Hermes / OpenClaw compatible standard)
    const mdContent = [
      `---`,
      `id: ${skill.id}`,
      `name: ${skill.name}`,
      `version: ${skill.version || '1.0.0'}`,
      `created_at: ${skill.createdAt}`,
      `---`,
      ``,
      `# ${skill.name}`,
      ``,
      `> ${skill.description}`,
      ``,
      `## Trigger Keywords (触发关键词)`,
      (skill.triggerKeywords || []).map(k => `- \`${k}\``).join('\n') || '- general',
      ``,
      `## Execution Steps (执行步骤)`,
      (skill.steps || []).map((s, idx) => `${idx + 1}. ${s}`).join('\n'),
      ``,
      `## Cross-Platform Command Templates (跨平台命令模板)`,
      `- **Windows (PowerShell)**: \`${(skill.commandTemplate && skill.commandTemplate.win32) || 'N/A'}\``,
      `- **Linux (Bash)**: \`${(skill.commandTemplate && skill.commandTemplate.linux) || 'N/A'}\``,
      ``
    ].join('\n');
    atomicWrite(mdPath, mdContent);
  }

  /**
   * 添加一条长期语义记忆（Semantic Memory）
   */
  addMemory({ content, category = 'knowledge', tags = [] }) {
    if (!content || typeof content !== 'string') {
      throw new Error('Memory content is required');
    }
    const item = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      category,
      content: content.trim(),
      tags: Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean),
      createdAt: new Date().toISOString()
    };
    this.state.semanticMemories.unshift(item);
    // Keep top 200 semantic memories
    if (this.state.semanticMemories.length > 200) {
      this.state.semanticMemories = this.state.semanticMemories.slice(0, 200);
    }
    this.saveMemoryState();
    return item;
  }

  /**
   * 删除指定长期记忆
   */
  deleteMemory(id) {
    const before = this.state.semanticMemories.length;
    this.state.semanticMemories = this.state.semanticMemories.filter(m => m.id !== id);
    this.saveMemoryState();
    return this.state.semanticMemories.length < before;
  }

  /**
   * 检索相关长期记忆
   */
  searchMemories(query = '', limit = 8) {
    if (!query || !query.trim()) {
      return this.state.semanticMemories.slice(0, limit);
    }
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = this.state.semanticMemories.map(mem => {
      const hay = `${mem.content} ${mem.category} ${(mem.tags || []).join(' ')}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (hay.includes(term)) score += 2;
      }
      return { mem, score };
    });
    const matched = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).map(s => s.mem);
    return matched.length > 0 ? matched.slice(0, limit) : this.state.semanticMemories.slice(0, limit);
  }

  /**
   * 记录任务执行轨迹（Episodic Memory）
   */
  recordEpisode(episode) {
    const entry = {
      id: `ep_${Date.now()}`,
      userPrompt: episode.userPrompt,
      finalAnswer: episode.finalAnswer,
      stepsCount: episode.steps ? episode.steps.length : 0,
      toolsUsed: (episode.steps || []).filter(s => s.type === 'tool_call').map(s => s.tool),
      timestamp: new Date().toISOString()
    };
    this.state.episodicHistory.unshift(entry);
    if (this.state.episodicHistory.length > 50) {
      this.state.episodicHistory = this.state.episodicHistory.slice(0, 50);
    }
    this.saveMemoryState();
    return entry;
  }

  /**
   * 获取所有已掌握的技能（Skills）
   */
  listSkills() {
    this.ensureDirs();
    const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.json'));
    const skills = [];
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, file), 'utf8'));
        skills.push(data);
      } catch (e) {
        // Ignore invalid json
      }
    }
    return skills.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
  }

  /**
   * 创建或进化新技能（Hermes 自我进化核心接口）
   */
  createOrUpdateSkill({ id, name, description, triggerKeywords = [], steps = [], commandTemplate = {} }) {
    const safeId = (id || name || `skill_${Date.now()}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || `skill_${Date.now()}`;

    const existingPath = path.join(SKILLS_DIR, `${safeId}.json`);
    let existing = null;
    if (fs.existsSync(existingPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
      } catch (e) {
        existing = null;
      }
    }

    const skillObj = {
      id: safeId,
      name: name || safeId,
      description: description || 'Self-evolved skill generated by AetherClaw.',
      triggerKeywords: Array.isArray(triggerKeywords)
        ? triggerKeywords
        : String(triggerKeywords).split(',').map(s => s.trim()).filter(Boolean),
      steps: Array.isArray(steps)
        ? steps
        : String(steps).split('\n').map(s => s.trim()).filter(Boolean),
      commandTemplate: {
        win32: commandTemplate.win32 || (existing && existing.commandTemplate ? existing.commandTemplate.win32 : ''),
        linux: commandTemplate.linux || (existing && existing.commandTemplate ? existing.commandTemplate.linux : '')
      },
      version: existing ? `${ parseInt(existing.version || '1', 10) + 1 }.0.0` : '1.0.0',
      usageCount: existing ? (existing.usageCount || 1) + 1 : 1,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: 'AetherClaw Self-Evolution'
    };

    this.saveSkillToDisk(skillObj);
    return skillObj;
  }

  /**
   * 根据用户输入匹配最相关的技能
   */
  matchSkills(userPrompt = '') {
    const lower = userPrompt.toLowerCase();
    const all = this.listSkills();
    return all.filter(skill => {
      if (lower.includes(skill.id.toLowerCase()) || lower.includes(skill.name.toLowerCase())) {
        return true;
      }
      return (skill.triggerKeywords || []).some(kw => lower.includes(kw.toLowerCase()));
    });
  }
}

module.exports = new MemoryAndSkillEngine();
