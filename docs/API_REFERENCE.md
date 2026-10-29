# 🔌 AetherClaw (灵爪) HTTP REST API 二次开发手册

AetherClaw 启动 Web 服务后（默认地址 `http://127.0.0.1:3721`），不仅提供可视化网页控制台，还对外暴露了一套标准的 JSON REST API。你可以用任何编程语言（Python、Node.js、Go、C#）或者自动化工具（n8n、Dify、飞书机器人、Telegram 机器人）直接调用它。

---

## 1. 获取系统、记忆与技能全景状态

- **请求路径**: `GET /api/status`
- **功能描述**: 返回当前操作系统环境、脱敏后的配置信息、长期语义记忆列表、已掌握的技能列表以及可用工具清单。

### 调用示例 (cURL)
```bash
curl http://127.0.0.1:3721/api/status
```

### 返回示例
```json
{
  "system": {
    "osType": "Windows",
    "platform": "win32",
    "shell": "powershell.exe",
    "cpuCores": 20,
    "memory": "23.50 GB free / 31.47 GB total"
  },
  "config": {
    "baseUrl": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "hasApiKey": false
  },
  "memories": [...],
  "skills": [...],
  "tools": [...]
}
```

---

## 2. 发送智能体任务指令 (核心接口)

- **请求路径**: `POST /api/chat`
- **功能描述**: 向 AetherClaw 发送自然语言指令，触发 ReAct 循环（或本地自主执行引擎），返回每一步思考/工具执行轨迹 (`steps`) 与最终报告 (`finalAnswer`)。

### 调用示例 (cURL)
```bash
curl -X POST http://127.0.0.1:3721/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "请对当前系统进行全面健康巡检"}'
```

### 调用示例 (Python)
```python
import requests

resp = requests.post(
    "http://127.0.0.1:3721/api/chat",
    json={"prompt": "请对当前系统进行全面健康巡检"}
)
data = resp.json()
print("执行模式:", data["mode"])
for step in data["steps"]:
    print(f"[{step['type']}] {step['title']}")
print("\n最终回复:\n", data["finalAnswer"])
```

---

## 3. 动态更新大模型 API 配置与密钥库管理

### 3.1 更新当前配置
- **请求路径**: `POST /api/config`
- **请求体参数**:
  - `baseUrl` (string): 模型接口地址（如 `https://api.deepseek.com/v1`）
  - `model` (string): 模型名称（如 `deepseek-chat`）
  - `apiKey` (string): API 密钥
  - `saveToVault` (boolean, 可选): 是否同步存入多密钥库 (`apiProfiles`)
  - `allowShellExec` / `allowFileWrite` / `autoEvolveSkills` (boolean, 可选): 安全护栏开关
  - `maxSteps` (number, 可选): 单次任务最大推理步数 (`1 ~ 20`)

### 3.2 一键测试 API 连通性与延迟诊断
- **请求路径**: `POST /api/config/test`
- **请求体参数**: `{ "baseUrl": "...", "model": "...", "apiKey": "..." }` 或 `{ "profileId": "prof_xxxx" }`
- **返回字段**: `{ "ok": true, "status": 200, "latencyMs": 312, "model": "deepseek-chat", "reply": "OK", "diagnosis": "✅ 连通成功！..." }`

### 3.3 从接口拉取可用模型列表
- **请求路径**: `POST /api/config/models`
- **返回字段**: `{ "success": true, "models": ["deepseek-chat", "deepseek-reasoner"] }`

### 3.4 多 API Key 密钥库（添加 / 切换 / 删除 / 清除当前 Key）
- **添加或更新密钥档案**: `POST /api/config/profiles`（参数：`name`, `baseUrl`, `model`, `apiKey`）
- **一键切换激活某个密钥档案**: `POST /api/config/profiles/:id/activate`
- **删除某个已存密钥档案**: `DELETE /api/config/profiles/:id`
- **清除当前激活的 API Key（切回免 Key 本地模式）**: `DELETE /api/config/apikey`

---

## 4. 长期语义记忆管理接口

### 4.1 新增记忆
- **请求路径**: `POST /api/memory`
- **请求体示例**:
```json
{
  "content": "每日备份脚本存放在 D:/backup 目录",
  "category": "ops_rule",
  "tags": ["backup", "ops"]
}
```

### 4.2 删除记忆
- **请求路径**: `DELETE /api/memory/:id`

---

## 5. 注册或进化新技能接口 (`SKILL.md`)

- **请求路径**: `POST /api/skills`
- **请求体示例**:
```json
{
  "id": "port_scanner",
  "name": "本地端口占用排查",
  "description": "快速排查当前 Windows 或 Linux 主机上正在监听的端口与进程",
  "triggerKeywords": ["端口", "监听", "port"],
  "steps": [
    "检测当前操作系统类型",
    "执行端口查看命令并输出前 15 条监听记录"
  ],
  "win32Command": "Get-NetTCPConnection -State Listen | Select-Object -First 15 LocalAddress, LocalPort, OwningProcess",
  "linuxCommand": "ss -tulnp | head -n 15"
}
```
