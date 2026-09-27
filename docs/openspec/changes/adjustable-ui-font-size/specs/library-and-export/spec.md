## ADDED Requirements

### Requirement: Library surfaces SHALL follow the interface type scale
Status: `implemented`

资产库列表、任务卡片与新建任务对话框 SHALL 消费 `globals.css` 里的语义字号，
并随「设置 → 外观」选择的界面字号一起缩放；承载文字的尺寸（卡片宽度上限、
对话框上限、两行摘要的最小高度）SHALL 用 rem 表达。默认档下的像素值 SHALL 与
字号可调之前一致，摘要仍按两行截断。

#### Scenario: Scaling the library
- **WHEN** 用户把界面字号调到 26px 后浏览资产库
- **THEN** 卡片标题、摘要与元信息随之放大，卡片宽度按比例变宽，不出现横向溢出或裁切

#### Scenario: Default size is unchanged
- **WHEN** 界面字号为默认档
- **THEN** 卡片与列表的尺寸与字号可调之前一致，摘要仍截断为两行

#### Scenario: New task dialog stays inside the window
- **WHEN** 在最大字号下打开新建任务对话框
- **THEN** 对话框宽度按 rem 缩放且不超过窗口，选项与按钮不被裁切
