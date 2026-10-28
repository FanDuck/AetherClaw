<div align="center">

# 🦅 AetherClaw (灵爪)

**A Cross-Platform (Windows & Linux) Self-Evolving Autonomous AI Agent Framework**  
*Combining OpenClaw's host execution power with Hermes Agent's hierarchical memory & skill evolution*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-success.svg)](#)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0-339933.svg)](https://nodejs.org/)

[**简体中文**](README.md) | [**English**](README.en.md)

</div>

---

## 🌟 Overview

**AetherClaw** is a lightweight, zero-bloat, cross-platform autonomous agent framework running natively on both **Windows (PowerShell)** and **Linux (Bash)**. It merges:

1. **OpenClaw-style Cross-Platform System Control**: Built-in OS adapter, PowerShell/Bash execution with UTF-8 normalization, safety guardrails, file manipulation, and web fetching.
2. **Hermes-style Memory & Skill Evolution**:
   - **Episodic Memory**: Tracks task execution trajectories.
   - **Semantic Memory**: Persists long-term facts and user preferences (`data/memory.json`).
   - **Procedural Skill Library**: Crystallizes multi-step workflows into reusable `skills/*.md` (`SKILL.md`) and `.json` files.
3. **Visual Web Console + Interactive CLI**: Configure DeepSeek, OpenAI, Qwen, or local Ollama models with zero coding, and inspect every Thought, Tool Call, and Observation in real time.

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/AetherClaw.git
cd AetherClaw

# Start the Visual Web Console (http://127.0.0.1:3721)
npm start

# Or launch the Interactive Terminal CLI
npm run cli

# Run the Cross-Platform Test Suite
npm test
```

## 📄 License

Released under the [MIT License](LICENSE).
