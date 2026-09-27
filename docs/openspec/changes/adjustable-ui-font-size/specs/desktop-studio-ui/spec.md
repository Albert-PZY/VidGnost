## ADDED Requirements

### Requirement: Settings SHALL let the user pick an interface font size
Status: `implemented`

「设置」的「外观」区 SHALL 提供界面字号选择器，直接列出正文像素值 12 到 26，
逐个可选并标注默认档。选定后 SHALL 立即生效，不需要刷新或重启。

#### Scenario: Choosing a size
- **WHEN** 用户在下拉里选择 18px
- **THEN** 正文变为 18px，界面其余字号按同一比例变化，选择被持久化

#### Scenario: Default is marked
- **WHEN** 打开下拉
- **THEN** 14px 标注为默认档，其余为 12px 到 26px 的整数值

#### Scenario: Out-of-range stored value
- **WHEN** 存储里的字号被改成 4 或 400
- **THEN** 夹到 12 或 26；无法解析时回到 14，不渲染出不可读的字号

### Requirement: Interface text SHALL use a shared type scale
Status: `implemented`

界面文字 SHALL 使用 `globals.css` 里定义的语义字号类，取值全部为 rem；
组件内 SHALL 不再出现写死的像素字号。承载文字的尺寸（容器与控件宽度、栅格模板、
阅读区宽度上限、文本块最小高度）SHALL 使用 rem，随字号一起缩放。
纯装饰的细线可以保持像素值。

#### Scenario: Caller-provided size wins
- **WHEN** 调用处给组件写了语义字号，而组件基类自带字号
- **THEN** 以调用处的字号渲染，不出现「写了令牌却仍是默认字号」的元素

#### Scenario: Scaling works
- **WHEN** 用户把字号从 14px 调到 26px
- **THEN** 语义字号与基于 rem 的尺寸一起变化，默认档下的像素值与调整前一致

#### Scenario: No clipped text after scaling
- **WHEN** 在最大字号下浏览资产库、模型与设置页
- **THEN** 不出现被容器裁掉的文字，导航栏等固定宽度的容器随字号一起变宽

#### Scenario: Studio stays within the window at the largest size
- **WHEN** 在最大字号下打开工作台
- **THEN** 三栏宽度合计不超过窗口宽度，页签与「视频 + 章节卡」在放不下时换行，
  而不是横向溢出

### Requirement: Font size preference SHALL apply before first paint
Status: `implemented`

主题与字号 SHALL 由同一个外观偏好模块管理，并在首屏脚本里于绘制前应用到根元素，
避免主题闪烁与字号跳动。没有 DOM 时 SHALL 返回默认值，使模块可以在渲染进程之外被引用。

#### Scenario: Restart keeps the choice
- **WHEN** 用户选定字号后重新打开应用
- **THEN** 首屏即为选定字号，不会先按默认字号绘制再跳变

#### Scenario: Corrupted storage
- **WHEN** 存储键缺失或内容不可解析
- **THEN** 回到默认的 14px，其余设置不受影响
