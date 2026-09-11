# bbbbb

[English](README.md) | [简体中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md)

<p align="center"><img src="assets/readme/bbbbb-logo.svg" width="128" alt="bbbbb 标志"></p>

需要你处理时，及时收到通知。

bbbbb（读作 B-five）是 iPhone 上的私密收件箱，用来接收编程助手和服务的更新。构建完成、助手有问题要问，或部署需要批准时，你可以在手机上查看。

![演示：curl 请求和 CLI 命令将更新发送到 iPhone 收件箱](assets/readme/bbbbb-demo.svg)

<p align="center"><a href="https://apps.apple.com/us/app/bbbbb-coding-agent-alerts/id6791204016"><img src="assets/readme/download-on-the-app-store.svg" height="60" alt="在 App Store 下载"></a></p>

[访问 bbbbb.app](https://bbbbb.app/?lang=zh-Hans)

通知消失后，更新仍保留在应用里：

- “待处理”保留问题、失败、审批和待办事项，直到你将其标记为已处理。
- “动态”用于查看其他更新。
- 来源只能发送，不能读取收件箱或运行命令。

通过临时二维码或六位连接码完成连接后，即可用 HTTP 发送消息。也可以安装 CLI，在命令执行结束后发送结果。

## 即将推出：v1.5

网站现已支持英语、简体中文、西班牙语、日语、德语、法语和巴西葡萄牙语。1.5 版本将为 iPhone 应用加入这七种语言，改进本地历史记录的保存方式，并更安全地处理 CSV 导出中可能被识别为公式的文本。Plus 的价格和权益保持不变。应用更新尚未在 App Store 上架。

## 快速开始

### HTTP，无需 CLI

告诉编程助手：`Set up bbbbb at bbbbb.app/setup`。它会准备 HTTP 来源，请你在 iPhone 上扫描二维码或输入连接码并批准连接，将链接私密保存，并发送测试消息。应用和自动化请在 iPhone 中选择“连接应用或自动化”。

设置后，通过已保存的环境变量发送：

```sh
curl -X POST "$BBBBB_SOURCE_URL"
```

发送者决定类别：需要回应的更新可设为 Attention，其他为 Activity。不要将来源链接写入助手对话或日志。

### 可选 CLI

```sh
npm install --global @bbbbbapp/cli
bbbbb setup --name "My Mac"
bbbbb run -- npm test
```

npm 不可用时，请使用经验证的 [GitHub 发行版](https://github.com/xxsang/bbbbb/releases)。详见 [CLI 安装指南](docs/guides/CLI_SOURCES.md)（英文）。

### 编程助手技能

安装：

```sh
sh scripts/install-bbbbb-notify-skill.sh
```

可以这样告诉助手：

> 这项任务使用 bbbbb。完成时通知我。只有需要我操作时才发送待处理通知，不要发送进度更新。

## 指南

网站指南可切换语言；仓库中的技术文档目前为英文。

| 用途 | 指南 |
| --- | --- |
| 选择设置方式 | [安装](docs/guides/INSTALLING.md) |
| 编程助手、Webhook 或脚本 | [HTTP 来源](docs/guides/HTTP_SOURCES.md) |
| 安装 CLI | [CLI 来源](docs/guides/CLI_SOURCES.md) |
| macOS、Linux 或 Windows | [平台指南](https://bbbbb.app/docs/?lang=zh-Hans) |
| 自托管和运维 | [运维](docs/launch/OPERATIONS.md) |

## 方案与限制

免费版包含所有核心功能：任意连续 30 天内可接收 1,000 条更新，最近 100 条会加密保存最多 7 天，供重新联网后同步。

Plus 的首发价为 US$4.99，适用于上线后的前 60 天。只需购买一次，包含后续新增功能，无需订阅，核心功能持续免费。自 2026 年 10 月 26 日起，一次性购买价格调整为 US$6.99。

Plus 将最近 30 天的接收额度提高至 10,000 条，最近 500 条加密更新保留最多 30 天，并支持在本机导出 JSON/CSV。

没有每日接收额度限制。每个收件箱的所有来源共用每分钟最多 20 次提交的安全限制，添加来源不会增加额度。

## 隐私

CLI 事件在离开发送端前已加密，HTTP 事件在存储前加密。免费版保留最近 100 条加密事件、最长 7 天；Plus 保留最近 500 条、最长 30 天。来源无法读取历史记录。错过通知时，可以回到应用查看更新。

面向开发者的核心组件采用 [Apache License 2.0](LICENSE)，iPhone 应用独立提供。

<sub>Apple、Apple 标志和 App Store 是 Apple Inc. 在美国及其他国家和地区注册的商标。</sub>
