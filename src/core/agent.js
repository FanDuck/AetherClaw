/**
 * AetherClaw (灵爪) - Autonomous ReAct & Self-Evolving Agent Core
 * 结合 OpenClaw 的跨平台工具执行能力与 Hermes 的记忆检索/技能自动进化闭环。
 * 支持：
 * 1. 任意 OpenAI 兼容大模型 API（DeepSeek / OpenAI / 通义千问 Qwen / Moonshot / Ollama 本地模型）
 * 2. 零配置智能本地执行引擎（当未填写 API Key 时，仍可直接调用本地真实工具完成系统巡检、目录分析、文件操作、记忆存取与技能进化！）
 */

const platform = require('./platform');
const config = require('./config');
const memory = require('./memory');
const { getToolSpecsForLLM, runTool } = require('../tools');

/** 工具结果回灌给模型前做长度裁剪，避免上下文被超长输出撑爆。 */
function clipForModel(result, limit = 8000) {
  let s = JSON.stringify(result);
  if (s.length > limit) s = s.slice(0, limit) + '...[truncated]';
  return s;
}

class AetherClawAgent {
  /**
   * 构建注入了操作系统环境、长期记忆与匹配技能的 System Prompt
   */
  buildSystemPrompt(userPrompt) {
    const sys = platform.getSystemSummary();
    const relevantMemories = memory.searchMemories(userPrompt, 5);
    const matchedSkills = memory.matchSkills(userPrompt);
    const allSkills = memory.listSkills();

    return [
      `You are **AetherClaw (灵爪)**, an open-source Cross-Platform (Windows & Linux) Self-Evolving Autonomous AI Agent inspired by OpenClaw and Hermes Agent.`,
      ``,
      `## Host Runtime Environment (当前系统环境)`,
      `- OS: ${sys.osType} (${sys.platform} / ${sys.release} / ${sys.arch})`,
      `- Default Shell: ${sys.shell}`,
      `- CPU & Memory: ${sys.cpuModel} (${sys.cpuCores} cores), ${sys.memory}`,
      `- Working Directory: ${sys.cwd}`,
      ``,
      `## Relevant Long-Term Memories (Hermes 长期记忆)`,
      relevantMemories.length > 0
        ? relevantMemories.map(m => `- [${m.category}] ${m.content}`).join('\n')
        : `- No prior specific memories matched.`,
      ``,
      `## Matched Reusable Skills (已匹配的技能模板)`,
      matchedSkills.length > 0
        ? matchedSkills.map(s => `- **${s.name}** (\`${s.id}\`): ${s.description}\n  Steps: ${(s.steps || []).join(' -> ')}\n  Recommended Command: ${sys.isWindows ? (s.commandTemplate?.win32 || 'N/A') : (s.commandTemplate?.linux || 'N/A')}`).join('\n')
        : `- Available Skills in Library: ${allSkills.map(s => s.name).join(', ')}`,
      ``,
      `## Behavioral Guidelines`,
      `1. Always adapt shell commands to the current OS (${sys.osType} -> ${sys.shell}).`,
      `2. When discovering important user preferences or environment facts, call \`memory_store\` to remember them.`,
      `3. When you solve a novel multi-step task or the user asks you to learn/save a skill, call \`skill_create\` to crystallize the workflow into a reusable skill.`,
      `4. Respond clearly in the language used by the user (default to Chinese if the user writes in Chinese).`
    ].join('\n');
  }

  /**
   * 主执行入口：处理用户指令，返回完整的思考轨迹（Steps）与最终回复
   */
  async run(userPrompt, onStep) {
    const steps = [];
    const emit = (step) => {
      const enriched = { ...step, timestamp: new Date().toISOString() };
      steps.push(enriched);
      if (typeof onStep === 'function') onStep(enriched);
    };

    const cfg = config.getSafeConfig();
    const matchedSkills = memory.matchSkills(userPrompt);

    if (matchedSkills.length > 0) {
      emit({
        type: 'skill_match',
        title: `触发已掌握技能: ${matchedSkills.map(s => s.name).join(', ')}`,
        detail: matchedSkills.map(s => `${s.name} (${s.id})`).join('; ')
      });
    }

    // Check if an LLM API Key is configured (or if local Ollama is used)
    const isOllama = cfg.baseUrl.includes('11434') || cfg.baseUrl.includes('localhost');
    if (cfg.hasApiKey || isOllama) {
      try {
        const finalAnswer = await this.runWithLLM(userPrompt, emit);
        memory.recordEpisode({ userPrompt, finalAnswer, steps });
        return { mode: 'llm', finalAnswer, steps };
      } catch (err) {
        emit({
          type: 'warning',
          title: '大模型 API 调用异常，自动切换至本地自主执行引擎',
          detail: err.message
        });
      }
    }

    // Built-in Local Autonomous Engine (Zero-API-Key Sandbox Mode that executes real local tools!)
    const finalAnswer = await this.runLocalAutonomousEngine(userPrompt, emit);
    memory.recordEpisode({ userPrompt, finalAnswer, steps });
    return { mode: 'local_autonomous', finalAnswer, steps };
  }

  /**
   * 使用 OpenAI / DeepSeek / Qwen / Ollama 兼容接口执行 ReAct 循环
   */
  async runWithLLM(userPrompt, emit) {
    const cfg = config.get();
    const messages = [
      { role: 'system', content: this.buildSystemPrompt(userPrompt) },
      { role: 'user', content: userPrompt }
    ];
    const tools = getToolSpecsForLLM();
    const maxSteps = cfg.maxSteps || 8;

    for (let stepIdx = 1; stepIdx <= maxSteps; stepIdx++) {
      emit({
        type: 'thought',
        title: `Step ${stepIdx}: 正在请求大模型 (${cfg.model}) 规划行动...`,
        detail: `Endpoint: ${cfg.baseUrl}/chat/completions`
      });

      const response = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          tools,
          tool_choice: 'auto',
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText.slice(0, 300)}`);
      }

      const data = await response.json();
      const choice = data.choices && data.choices[0];
      if (!choice || !choice.message) {
        throw new Error('Invalid response from LLM provider');
      }

      const msg = choice.message;
      messages.push(msg);

      if (msg.content && msg.content.trim()) {
        emit({
          type: 'thought',
          title: 'Agent 思考 (Reasoning)',
          detail: msg.content.trim()
        });
      }

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return msg.content || '任务已完成。';
      }

      for (const toolCall of msg.tool_calls) {
        const fnName = toolCall.function.name;
        let fnArgs = {};
        try {
          fnArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch (e) {
          fnArgs = {};
        }

        emit({
          type: 'tool_call',
          tool: fnName,
          title: `调用工具: ${fnName}`,
          args: fnArgs
        });

        const result = await runTool(fnName, fnArgs);

        emit({
          type: 'observation',
          tool: fnName,
          title: `工具返回: ${fnName}`,
          result
        });

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: fnName,
          content: clipForModel(result)
        });
      }
    }

    return '已达到最大执行步数，请查看上方工具执行结果。';
  }

  /**
   * 零配置本地自主执行引擎（无需 API Key 即可真实体验 OpenClaw 系统操控 + Hermes 记忆与技能进化）
   */
  async runLocalAutonomousEngine(userPrompt, emit) {
    const text = userPrompt.trim();
    const lower = text.toLowerCase();

    emit({
      type: 'thought',
      title: '本地智能体引擎规划 (Local Autonomous Planner)',
      detail: `当前处于「免 Key 本地实操模式」（可在右上角【API 设置】中接入 DeepSeek / OpenAI / Ollama 解锁完整自由对话）。正在分析指令意图并匹配本地跨平台工具...`
    });

    // 1. 记忆存储意图: "记住..." / "remember..."
    if (text.startsWith('记住') || lower.startsWith('remember ') || text.includes('请记住')) {
      const contentToRemember = text.replace(/^(请?记住[:：]?|remember\s+)/i, '').trim() || text;
      emit({
        type: 'tool_call',
        tool: 'memory_store',
        title: '调用工具: memory_store (写入 Hermes 长期语义记忆)',
        args: { content: contentToRemember, category: 'user_preference', tags: ['user', 'custom'] }
      });
      const res = await runTool('memory_store', {
        content: contentToRemember,
        category: 'user_preference',
        tags: ['user', 'custom']
      });
      emit({ type: 'observation', tool: 'memory_store', title: '记忆写入成功', result: res });
      return `✅ **已写入 Hermes 长期语义记忆库！**\n\n- **记忆ID**: \`${res.memory.id}\`\n- **内容**: ${res.memory.content}\n- **存储位置**: \`data/memory.json\`\n\n今后每次执行相关任务时，我都会自动检索并遵循这条记忆。`;
    }

    // 2. 技能创建/进化意图: "学习技能..." / "创建技能..." / "evolve skill"
    if (text.includes('创建技能') || text.includes('学习技能') || text.includes('沉淀技能') || lower.includes('create skill')) {
      const skillName = text.replace(/.*(创建技能|学习技能|沉淀技能|create skill)[:：\s]*/i, '').trim() || '自定义自动化巡检技能';
      const skillId = `custom_${Date.now().toString().slice(-5)}`;
      const args = {
        id: skillId,
        name: skillName,
        description: `由用户指令「${text}」自动进化生成的跨平台可复用技能。`,
        triggerKeywords: [skillName, '自动化', 'custom'],
        steps: [
          '1. 自动检测当前操作系统环境 (Windows PowerShell / Linux Bash)',
          '2. 执行对应的系统状态检查与目录扫描',
          '3. 输出结构化执行报告并更新技能调用计数'
        ],
        win32Command: 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 Name, Id, CPU',
        linuxCommand: 'ps aux --sort=-%cpu | head -n 6'
      };
      emit({
        type: 'tool_call',
        tool: 'skill_create',
        title: '调用工具: skill_create (Hermes 技能自我进化)',
        args
      });
      const res = await runTool('skill_create', args);
      emit({ type: 'observation', tool: 'skill_create', title: '技能文件已生成', result: res });
      return `🧬 **Hermes 自我进化完成！新技能已沉淀到本地技能库：**\n\n- **技能名称**: **${res.skill.name}** (\`${res.skill.id}\`)\n- **生成文件**: \n  - \`skills/${res.skill.id}.json\` (结构化配置)\n  - \`skills/${res.skill.id}.md\` (开源标准 SKILL.md 文档)\n\n你可以在右侧 **「技能进化库 (Skills)」** 面板中随时查看或一键触发它！`;
    }

    // 3. 显式终端命令执行: "执行命令: ..." / "run: ..."
    const cmdMatch = text.match(/^(?:执行命令|运行命令|run|exec|shell)[:：\s]+(.+)$/i);
    if (cmdMatch) {
      const command = cmdMatch[1].trim();
      emit({
        type: 'tool_call',
        tool: 'shell_exec',
        title: `调用工具: shell_exec (跨平台终端执行)`,
        args: { command }
      });
      const res = await runTool('shell_exec', { command });
      emit({ type: 'observation', tool: 'shell_exec', title: '终端执行结果', result: res });
      return [
        `🖥️ **跨平台终端命令执行完毕** (\`${res.platform}\`)`,
        `- **命令**: \`${command}\``,
        `- **状态**: ${res.success ? '✅ 成功 (Exit Code 0)' : `⚠️ 退出码 ${res.exitCode}`}`,
        ``,
        '```text',
        res.stdout || res.stderr || '(无输出)',
        '```'
      ].join('\n');
    }

    // 4. 目录/文件查看意图
    if (text.includes('目录') || text.includes('文件') || lower.includes('list') || lower.includes('files') || text.includes('整理')) {
      emit({
        type: 'tool_call',
        tool: 'file_list',
        title: '调用工具: file_list (扫描当前工作区目录)',
        args: { dirPath: '.' }
      });
      const res = await runTool('file_list', { dirPath: '.' });
      emit({ type: 'observation', tool: 'file_list', title: '目录扫描结果', result: res });

      const formattedList = (res.items || [])
        .map(item => `- ${item.type === 'directory' ? '📁' : '📄'} **${item.name}** ${item.type === 'file' ? `(${item.sizeBytes} bytes)` : ''}`)
        .join('\n');

      return [
        `📂 **当前项目目录分析报告** (\`${res.directory}\`)`,
        `共检测到 **${res.totalCount}** 个文件/文件夹：`,
        ``,
        formattedList
      ].join('\n');
    }

    // 5. 默认/系统健康巡检与环境诊断（展示 OpenClaw 跨平台能力 + Hermes 记忆检索）
    emit({
      type: 'tool_call',
      tool: 'system_info',
      title: '调用工具: system_info (读取当前操作系统与硬件指标)',
      args: {}
    });
    const sysInfo = await runTool('system_info', {});
    emit({ type: 'observation', tool: 'system_info', title: '系统指标读取完成', result: sysInfo });

    const diskCmd = platform.isWindows
      ? 'Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{Name="Used(GB)";Expression={[math]::round($_.Used/1GB,2)}}, @{Name="Free(GB)";Expression={[math]::round($_.Free/1GB,2)}} | Format-Table -AutoSize'
      : 'df -h /';

    emit({
      type: 'tool_call',
      tool: 'shell_exec',
      title: `调用工具: shell_exec (自适应 ${sysInfo.osType} 磁盘巡检命令)`,
      args: { command: diskCmd }
    });
    const diskRes = await runTool('shell_exec', { command: diskCmd });
    emit({ type: 'observation', tool: 'shell_exec', title: '磁盘巡检输出', result: diskRes });

    return [
      `🦅 **AetherClaw (灵爪) 跨平台自主巡检报告**`,
      ``,
      `### 1. 主机运行环境 (OpenClaw 跨平台引擎)`,
      `- **操作系统**: ${sysInfo.osType} (\`${sysInfo.platform}\` / \`${sysInfo.release}\` / \`${sysInfo.arch}\`)`,
      `- **默认终端**: \`${sysInfo.shell}\``,
      `- **处理器**: ${sysInfo.cpuModel} (${sysInfo.cpuCores} 逻辑核心)`,
      `- **内存状态**: ${sysInfo.memory}`,
      `- **工作目录**: \`${sysInfo.cwd}\``,
      ``,
      `### 2. 磁盘空间实时检测`,
      '```text',
      diskRes.stdout || diskRes.stderr || '已完成检测',
      '```',
      ``,
      `### 3. 你可以直接尝试以下指令：`,
      `- 🔍 **查看项目文件**: 发送 \`分析当前目录的文件结构\``,
      `- 💻 **执行系统命令**: 发送 \`执行命令: Get-Date\` (Windows) 或 \`执行命令: uname -a\` (Linux)`,
      `- 🧠 **写入长期记忆**: 发送 \`记住：我喜欢简洁的中文技术报告\``,
      `- 🧬 **自我进化新技能**: 发送 \`创建技能：高占用进程排查\``,
      `- ⚙️ **接入大模型**: 点击右上角 **「API 设置」** 填入 DeepSeek / OpenAI / Ollama 地址，即可解锁无限自由对话与自动工具编排！`
    ].join('\n');
  }
}

module.exports = new AetherClawAgent();
