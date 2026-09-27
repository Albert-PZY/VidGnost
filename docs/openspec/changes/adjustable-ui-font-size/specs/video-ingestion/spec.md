## ADDED Requirements

### Requirement: Source intake surfaces SHALL follow the interface type scale
Status: `implemented`

新建任务的来源接入界面（本地文件与远程链接两个入口）SHALL 消费 `globals.css`
里的语义字号，并随「设置 → 外观」选择的界面字号一起缩放，使来源类型、路径提示与
校验信息在最大字号下仍然完整可读。

#### Scenario: Intake form scales with the chosen size
- **WHEN** 用户把界面字号调到 26px 后打开新建任务
- **THEN** 来源类型标签、输入框与提示文字随之放大，输入框不裁切其中的文字

#### Scenario: Validation messages stay readable
- **WHEN** 在最大字号下输入无法解析的地址并提交
- **THEN** 校验提示完整显示，不被容器裁掉
