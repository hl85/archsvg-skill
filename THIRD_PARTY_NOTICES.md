# 第三方代码声明（Third-Party Notices）

本 skill 在 `lib/` 下 vendored（内嵌）了开源项目 **archify** 的两个零依赖内核模块。
其余全部代码均为 archsvg 自研，未包含任何第三方代码。

## 被 vendored 的第三方代码

| 项目 | 许可证 | 作者 / 上游 | 来源版本 | 原始路径 |
|:---|:---|:---|:---|:---|
| archify | MIT | tt-a1i | v2.17.0-dev.1 | `renderers/shared/geometry.mjs` |
| archify | MIT | tt-a1i | v2.17.0-dev.1 | `renderers/shared/diagnostics.mjs` |

- 仓库地址：https://github.com/tt-a1i/archify
- archify 自身基于 **Cocoon-AI/architecture-diagram-generator**（MIT, v1.0）的方法论。

## vendored 的具体文件与处理方式

- `archsvg/lib/geometry.mjs` ← `renderers/shared/geometry.mjs`
- `archsvg/lib/diagnostics.mjs` ← `renderers/shared/diagnostics.mjs`

处理方式：

1. **逻辑未修改**：除在两个文件最顶部追加了一段归属注释头（attribution header）外，
   代码内容、导出名、相对 import 路径（`./diagnostics.mjs`）均保持原样。
2. `geometry.mjs` 通过 `./diagnostics.mjs` 相对引用 `diagnostics.mjs`，两者同处 `lib/`，
   相对路径天然成立，无需改动。
3. 归属注释头示例：

   ```
   /*
    * Vendored from archify (MIT) — https://github.com/tt-a1i/archify
    * Source: renderers/shared/<name>.mjs @ v2.17.0-dev.1
    * Upstream: tt-a1i; based on Cocoon-AI/architecture-diagram-generator (MIT, v1.0)
    * Vendored: 2026-09-10. Logic unmodified; do not reformat.
    */
   ```

## archify 的其余依赖

archify 项目（除被 vendored 的两个零依赖内核模块外）可能还依赖其他第三方代码库。
相关依赖的许可证与声明以 archify 上游仓库为准，本 skill 不复制、不使用 archify 的其余部分。

---

archsvg 自研代码版权归本项目所有，见 `LICENSE`。
