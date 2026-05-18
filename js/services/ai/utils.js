/**
 * ai/utils.js
 * AIService mixin helper
 *
 * 把一个 mixin class 的所有实例方法 + 静态成员合并到 AIService 上。
 * 用 Object.defineProperty 拷贝 PropertyDescriptor，保留 async / getter / setter 语义。
 *
 * 用法（在每个 ai/<phase>.js 末尾调用）：
 *     class _AIServiceXMixin { static get X(){...}  foo(){...}  async bar(){...} }
 *     _applyAIServiceMixin(_AIServiceXMixin);
 *
 * 加载顺序：必须在 aiService.js 之前加载（function 在 utils.js 加载时定义；调用
 * 发生在 ai/<phase>.js 中，那时 AIService 已存在）。
 */
function _applyAIServiceMixin(source) {
  for (const name of Object.getOwnPropertyNames(source.prototype)) {
    if (name === 'constructor') continue;
    Object.defineProperty(
      AIService.prototype,
      name,
      Object.getOwnPropertyDescriptor(source.prototype, name)
    );
  }
  for (const name of Object.getOwnPropertyNames(source)) {
    if (['length', 'name', 'prototype', 'arguments', 'caller'].includes(name)) continue;
    Object.defineProperty(
      AIService,
      name,
      Object.getOwnPropertyDescriptor(source, name)
    );
  }
}
