// ============================================
// mapService prompt bootstrap — extracted from mapService.js
// ============================================
// 注册 mapNaming.sites / mapNaming.locations 通道（system prompt + user trigger）
//
// 设计要点：与 mixin 解耦，三个消费者（浏览器 / build-prompt-index / promptviewer）
// 都直接 load 本文件，不再需要手动 mirror。
//
// 加载顺序：必须在 promptRegistry.js 之后。不依赖 mapService 实例本身——只是 register。
// ============================================

(function bootstrapMapNamingPrompts() {
  if (!window.promptRegistry) {
    console.warn('[promptRegistry] mapService bootstrap 失败：promptRegistry 未加载');
    return;
  }
  const reg = window.promptRegistry;

  reg.register('mapNaming.sites.prompt', {
    channel: 'mapNaming.sites',
    category: 'core',
    source: 'static-file',
    cacheable: false,
    description: 'SITE 命名 LLM 的完整 system prompt（角色定义 + 区域背景 + JSON 格式契约）',
    origin: { file: 'js/services/mapService.js', symbol: 'nameSitesViaAI' },
    builder: ctx => {
      const countryName = ctx?.countryName || '';
      const descTruncated = ctx?.descTruncated || '';
      const sitesCount = Number(ctx?.sitesCount) || 0;
      return [
        '你是一个奇幻/科幻世界的地点命名师。',
        `当前区域（country）：${countryName}`,
        '',
        '区域背景：',
        descTruncated,
        '',
        `请为这个区域内的 ${sitesCount} 个重要地点（SITE）生成名称和简短描述。`,
        '地点可以是：城池、宗门、集镇、要塞、险地、秘境、遗迹等。',
        '名称和描述应符合区域背景的整体氛围和世界观。',
        '',
        '严格按以下 JSON 格式输出，不要输出其他内容：',
        `[{"name":"地点名称","description":"一句话描述"},...]`,
        `数组长度必须正好是 ${sitesCount}。`,
      ].join('\n');
    },
  });

  reg.register('mapNaming.sites.triggerMessage', {
    channel: 'mapNaming.sites',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    excludeFromAssembly: true, // user 触发消息，不进 system prompt
    description: 'SITE 命名 LLM 的 user 触发消息',
    origin: { file: 'js/services/mapService.js', symbol: 'nameSitesViaAI user trigger' },
    builder: ctx => {
      const countryName = ctx?.countryName || '<countryName>';
      const sitesCount = ctx?.sitesCount ?? '<N>';
      return `请为「${countryName}」内的 ${sitesCount} 个重要地点命名。`;
    },
  });

  reg.register('mapNaming.locations.triggerMessage', {
    channel: 'mapNaming.locations',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    excludeFromAssembly: true, // user 触发消息，不进 system prompt
    description: 'LOCATION 命名 LLM 的 user 触发消息',
    origin: { file: 'js/services/mapService.js', symbol: 'nameLocationsViaAI user trigger' },
    builder: ctx => {
      const siteName = ctx?.siteName || '<siteName>';
      const locationsCount = ctx?.locationsCount ?? '<N>';
      return `请为「${siteName}」内部的 ${locationsCount} 个子地点命名。`;
    },
  });

  reg.register('mapNaming.locations.prompt', {
    channel: 'mapNaming.locations',
    category: 'core',
    source: 'static-file',
    cacheable: false,
    description: 'LOCATION 命名 LLM 的完整 system prompt（SITE 内部子地点命名）',
    origin: { file: 'js/services/mapService.js', symbol: 'nameLocationsViaAI' },
    builder: ctx => {
      const worldName = ctx?.worldName || '';
      const siteName = ctx?.siteName || '';
      const locationsCount = Number(ctx?.locationsCount) || 0;
      return [
        '你是一个奇幻/科幻世界的地点命名师。',
        `当前世界：${worldName}`,
        `当前地点（SITE）：${siteName}`,
        '',
        `请为这个地点内部的 ${locationsCount} 个子地点（LOCATION）生成名称和简短描述。`,
        '子地点可以是：建筑（酒馆、铁匠铺、王宫）、自然地标（瀑布、古树）、功能区域（贫民窟、市场）等。',
        '名称和描述应符合世界观和 SITE 的整体氛围。',
        '',
        '严格按以下 JSON 格式输出，不要输出其他内容：',
        `[{"name":"地点名称","description":"一句话描述"},...]`,
        `数组长度必须正好是 ${locationsCount}。`,
      ].join('\n');
    },
  });

  console.log('[promptRegistry] 已注册 mapNaming.sites / mapNaming.locations prompts');
})();
