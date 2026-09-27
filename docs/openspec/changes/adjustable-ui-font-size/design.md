# 设计：字号阶梯、缩放开关与覆盖顺序

## 1. 语义字号阶梯

`globals.css` 的 `:root` 里定义十级字号，全部用 rem，并在 `@theme inline` 注册，
Tailwind 会为每个类同时生成字号与行高：

| 语义类 | 默认像素 | 原值 | 用途 |
| --- | --- | --- | --- |
| `text-micro` | 11px | 10px | 角标、单位、chip |
| `text-meta` | 12px | 11px | 元信息、说明文字 |
| `text-note` | 13px | 12px | 卡片正文 |
| `text-body` | 14px | 13px | 正文基准 |
| `text-lead` | 15px | 14px | 阅读区正文 |
| `text-subhead` | 16px | 15px | 小节标题 |
| `text-head` | 17px | 16px | 区块标题 |
| `text-title` | 18px | 17px | 弹窗标题 |
| `text-page` | 22px | 20px | 页面标题 |
| `text-hero` | 30px | 28px | 品牌字 |

## 2. 缩放开关只放一个地方

```css
html { font-size: calc(100% * var(--font-scale)); }
```

`--font-scale` 默认值为 1，写在 `:root` 作为无 JS 时的兜底；用户选定字号后由 store
写成 `html` 的内联样式。**必须写在内联样式上**：`:root` 的默认值是无层样式，
把档位规则写在 `@layer base` 里会被它压住，档位就永远不生效。

比例按「选定值 / 14」计算：正文是 `0.875rem`、根字号是 `16px × 比例`，
因此选定 18px 时根字号 20.57px、正文正好 18px，用户拿到的是确定值而不是约等于。

## 3. 让字号覆盖真正生效

迁移时踩到两个「写了不生效」的坑，都是顺序问题，这里记录清楚：

1. **排版辅助类与工具类同层**：`.timecode` / `.reading` 原本写在 `@layer utilities` 里，
   与 Tailwind 工具类同层，同层内按出现顺序决定胜负，于是 `.timecode` 的默认字号
   压过了调用处写的 `text-micro`。改为放在 `@layer components`：辅助类给默认值，
   调用处写了工具类就以调用处为准。
2. **组件基类压过调用处**：`Button` / `Label` 基类自带 `text-sm`，而 `cn()` 用的
   tailwind-merge 不认识自定义的 `text-note` 这类类名（会当成颜色类丢掉），
   于是基类的 `text-sm` 留了下来——字号回到 14px，`text-sm` 自带的 `leading-none`
   还会把中文字形裁掉 2px。在 `lib/utils.ts` 里把这些类名注册进 font-size 组即可。
   同一原因，`Input` / `Textarea` 基类里的 `text-base md:text-sm` 也删掉：
   桌面应用不需要响应式字号，字号应由调用处决定。

## 4. 尺寸也跟着缩放

字号放大后，写死的像素宽度会把文字挤窄甚至裁掉。以下改成 rem：

- 容器与控件宽度：侧栏 52px、章节轨 228px、Copilot 栏 356px、搜索框 220px、弹窗上限等；
- 栅格模板：`grid-cols-[52px_...]`、`grid-cols-[228px_..._356px]` 等，必须与栏宽同时换算，
  否则栏宽放大而栅格列宽不变，整页会横向溢出；
- 阅读区宽度上限：760px、720px、640px；
- 承载文字的固定尺寸：两行摘要的最小高度、导航图标、章节卡与视频行的对齐缩进。

纯装饰的细线（进度条 3px、播放进度 5px、模糊半径、焦点描边）保持像素值：
它们表达的是「一条细线」，跟着放大反而不成比例。

字号放大后中间栏会变窄，因此页签行与「视频 + 章节卡」两行允许换行（`flex-wrap`），
视频宽度加 `max-w-full`，长路径允许 `break-all`。

## 5. 外观偏好与首屏

主题与字号都是「界面长什么样」的偏好，都写 localStorage、都要在首屏前生效，
因此合并为 `appearance-store`：键为 `vidgnost.theme` 与 `vidgnost.fontSize`。
首屏脚本同时写 `data-theme` 与 `--font-scale`，避免主题闪烁与字号跳动；
越界值夹到 12-26，无法解析时回到 14。
