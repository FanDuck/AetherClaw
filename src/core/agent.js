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
   * 支持 onStep（步骤回调）与 options.onToken（大模型原生 Token 级流式输出回调）
   */
  async run(userPrompt, onStep, options = {}) {
    const onToken = typeof options.onToken === 'function' ? options.onToken : null;
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
    const isLocalLLM = /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(cfg.baseUrl);
    if (cfg.hasApiKey || isLocalLLM) {
      try {
        const finalAnswer = await this.runWithLLM(userPrompt, emit, onToken);
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
   * 解析 OpenAI / DeepSeek / Qwen / Ollama 兼容的 SSE 流式响应，
   * 实时触发 onToken(delta) 并自动拼接分段流式下发的 tool_calls。
   */
  async consumeLLMStream(response, onToken) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCallsByIndex = new Map();

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch (_) {
          continue;
        }
        const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
        if (!delta) continue;

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          content += delta.content;
          if (onToken) onToken(delta.content);
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = typeof tc.index === 'number' ? tc.index : 0;
            if (!toolCallsByIndex.has(idx)) {
              toolCallsByIndex.set(idx, {
                id: tc.id || `call_${idx}_${Date.now()}`,
                type: 'function',
                function: { name: '', arguments: '' }
              });
            }
            const entry = toolCallsByIndex.get(idx);
            if (tc.id) entry.id = tc.id;
            if (tc.function) {
              if (tc.function.name) entry.function.name += tc.function.name;
              if (tc.function.arguments) entry.function.arguments += tc.function.arguments;
            }
          }
        }
      }
    }

    const tool_calls = [...toolCallsByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v)
      .filter(tc => tc.function.name);

    return {
      role: 'assistant',
      content: content || null,
      ...(tool_calls.length > 0 ? { tool_calls } : {})
    };
  }

  /**
   * 使用 OpenAI / DeepSeek / Qwen / Ollama 兼容接口执行 ReAct 循环（支持多轮上下文 + 原生 Token 流式输出）
   */
  async runWithLLM(userPrompt, emit, onToken = null) {
    const cfg = config.get();
    const recentHistory = memory.getRecentConversation(6);
    const messages = [
      { role: 'system', content: this.buildSystemPrompt(userPrompt) },
      ...recentHistory,
      { role: 'user', content: userPrompt }
    ];
    const tools = getToolSpecsForLLM({ autoEvolveSkills: cfg.autoEvolveSkills });
    const maxSteps = cfg.maxSteps || 8;
    const useStream = Boolean(onToken);

    for (let stepIdx = 1; stepIdx <= maxSteps; stepIdx++) {
      emit({
        type: 'thought',
        title: `Step ${stepIdx}: 正在请求大模型 (${cfg.model}) 规划行动...`,
        detail: `Endpoint: ${cfg.baseUrl}/chat/completions (${recentHistory.length / 2} 轮历史上下文)`
      });

      let response;
      try {
        response = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
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
            temperature: 0.3,
            ...(useStream ? { stream: true } : {})
          }),
          // 避免上游无响应时请求永久挂起
          signal: AbortSignal.timeout(cfg.llmTimeoutMs || 60000)
        });
      } catch (err) {
        const reason = err && (err.name === 'TimeoutError' || err.name === 'AbortError')
          ? `请求超时 (${(cfg.llmTimeoutMs || 60000) / 1000}s)`
          : (err.cause && err.cause.code) || err.message;
        throw new Error(`无法连接大模型接口 ${cfg.baseUrl}: ${reason}`);
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText.slice(0, 300)}`);
      }

      let msg;
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (useStream && contentType.includes('text/event-stream') && response.body) {
        msg = await this.consumeLLMStream(response, onToken);
      } else {
        const data = await response.json();
        const choice = data.choices && data.choices[0];
        if (!choice || !choice.message) {
          throw new Error('Invalid response from LLM provider');
        }
        msg = choice.message;
        if (onToken && msg.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
          onToken(msg.content);
        }
      }

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

    // 0. 多轮对话追问意图: "把刚才的结果保存为 xxx.md" / "保存刚才的报告" / "save last result"
    if (
      (text.includes('刚才') || text.includes('上一条') || text.includes('上次') || lower.includes('last result') || lower.includes('previous')) &&
      (text.includes('保存') || text.includes('写入') || text.includes('导出') || lower.includes('save') || lower.includes('write'))
    ) {
      const lastEp = memory.getLastEpisode();
      if (!lastEp || !lastEp.finalAnswer) {
        return `ℹ️ 当前会话还没有上一轮执行结果可供保存。请先运行一次巡检或分析指令，再追问「把刚才的结果保存为 report.md」！`;
      }
      const fileMatch = text.match(/((?:[a-zA-Z]:[\\/])?[^\s"'`:：,，]+\.(?:md|txt|json|log|csv|html))/i);
      const targetFile = fileMatch ? fileMatch[1] : 'report.md';
      emit({
        type: 'thought',
        title: `多轮上下文追问识别：提取上一轮「${lastEp.userPrompt}」的输出并保存`,
        detail: `目标文件: ${targetFile}`
      });
      emit({
        type: 'tool_call',
        tool: 'file_write',
        title: `调用工具: file_write (保存上一轮结果至 ${targetFile})`,
        args: { filePath: targetFile }
      });
      const res = await runTool('file_write', {
        filePath: targetFile,
        content: `# AetherClaw 任务报告\n\n- **原始指令**: ${lastEp.userPrompt}\n- **生成时间**: ${lastEp.timestamp}\n\n---\n\n${lastEp.finalAnswer}\n`
      });
      emit({ type: 'observation', tool: 'file_write', title: '文件保存结果', result: res });
      if (res.error) return `❌ 保存失败：${res.error}`;
      return `💾 **已根据多轮上下文将上一轮结果保存为文件！**\n\n- **文件路径**: \`${res.filePath}\`\n- **写入大小**: ${res.bytesWritten} bytes\n- **关联的上一轮指令**: 「${lastEp.userPrompt}」`;
    }

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
        description: `由用户指令「${text}」生成的技能模板（免 Key 模式下使用通用的"高 CPU 进程排查"命令作为起点，可在 skills/ 目录中直接编辑；接入大模型后会根据任务自动生成针对性的步骤与命令）。`,
        triggerKeywords: [skillName],
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
      return `🧬 **Hermes 自我进化完成！新技能已沉淀到本地技能库：**\n\n- **技能名称**: **${res.skill.name}** (\`${res.skill.id}\`)\n- **生成文件**: \n  - \`skills/${res.skill.id}.json\` (结构化配置)\n  - \`skills/${res.skill.id}.md\` (开源标准 SKILL.md 文档)\n\n💡 免 Key 模式下生成的是**通用模板**（默认命令为高 CPU 进程排查），你可以直接编辑上述文件；接入大模型后，Agent 会按任务自动编写针对性的技能。\n\n在右侧 **「技能库」** 面板点击「运行」即可真实执行该技能的命令。`;
    }

    // 2.5 执行已有技能: "执行技能: <名称>" / "运行技能: <名称>" —— 真正运行该技能在当前系统上的命令模板
    const skillRun = text.match(/^(?:执行技能|运行技能|run skill)[:：\s]+(.+)$/i);
    if (skillRun) {
      const wanted = skillRun[1].trim().toLowerCase();
      const skill = memory.listSkills().find(s =>
        s.id.toLowerCase() === wanted || s.name.toLowerCase() === wanted
      ) || memory.listSkills().find(s => s.name.toLowerCase().includes(wanted) || wanted.includes(s.name.toLowerCase()));
      if (!skill) {
        return `❌ 没有找到名为「${skillRun[1].trim()}」的技能。可以在右侧「技能库」面板查看现有技能。`;
      }
      const command = platform.isWindows ? skill.commandTemplate?.win32 : skill.commandTemplate?.linux;
      if (!command) {
        return `⚠️ 技能「${skill.name}」没有适用于当前系统（${platform.isWindows ? 'Windows' : 'Linux'}）的命令模板。\n\n执行步骤参考：\n${(skill.steps || []).map(s => `- ${s}`).join('\n')}`;
      }
      emit({
        type: 'tool_call',
        tool: 'shell_exec',
        title: `执行技能「${skill.name}」的 ${platform.isWindows ? 'PowerShell' : 'Bash'} 命令模板`,
        args: { command }
      });
      const res = await runTool('shell_exec', { command });
      emit({ type: 'observation', tool: 'shell_exec', title: '技能执行结果', result: res });
      memory.recordSkillUse(skill.id); // 累计调用次数（不改变版本号）
      return [
        `🧬 **技能已执行：${skill.name}** (\`${skill.id}\`)`,
        `- **状态**: ${res.success ? '✅ 成功' : `⚠️ 退出码 ${res.exitCode}`}${res.timedOut ? '（超时）' : ''}`,
        `- **命令**: \`${command}\``,
        ``,
        '```text',
        res.stdout || res.stderr || res.error || '(无输出)',
        '```'
      ].join('\n');
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
